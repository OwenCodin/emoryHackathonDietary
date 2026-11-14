import { isFiniteNonNegative, normalizeFoodName, readData } from './data.mjs';
import { lookupFood } from './nutrients.mjs';

const NUTRIENTS = [
  ['sodiumMg', 'sodium'],
  ['potassiumMg', 'potassium'],
  ['phosphorusMg', 'phosphorus'],
];

const SWAPS = {
  banana: 'grapes',
  potato: 'white rice',
  potatoes: 'white rice',
  tomato: 'cabbage',
  tomatoes: 'cabbage',
  orange: 'apple',
  oranges: 'apple',
  avocado: 'grapes',
  'kidney beans': 'white rice',
  'black beans': 'white rice',
  'processed cheese': 'a small portion of fresh mozzarella',
  'deli turkey': 'fresh unsalted chicken',
  ham: 'fresh unsalted chicken',
  bacon: 'fresh unsalted chicken',
  cola: 'lemon-lime soda',
};

const SMALL_NUMBERS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

export function numberWords(number) {
  if (typeof number !== 'number' || !Number.isFinite(number)) return null;
  const value = Math.max(0, Math.round(number));
  if (value >= 1_000_000) return value.toLocaleString('fullwide', { useGrouping: false });
  if (value < 20) return SMALL_NUMBERS[value];
  if (value < 100) return `${TENS[Math.floor(value / 10)]}${value % 10 ? ` ${SMALL_NUMBERS[value % 10]}` : ''}`;
  if (value < 1000) {
    const remainder = value % 100;
    return `${SMALL_NUMBERS[Math.floor(value / 100)]} hundred${remainder ? ` ${numberWords(remainder)}` : ''}`;
  }
  const thousands = Math.floor(value / 1000);
  const remainder = value % 1000;
  return `${numberWords(thousands)} thousand${remainder ? ` ${numberWords(remainder)}` : ''}`;
}

function profileIsValid(profile) {
  return profile?.limits && NUTRIENTS.every(([key]) => isFiniteNonNegative(profile.limits[key]));
}

function buildReasons(nutrients, profile, ruleReasons, countsAsFluid) {
  const reasons = [...ruleReasons];
  for (const [key, label] of NUTRIENTS) {
    const amount = nutrients[key];
    if (amount === null || amount === undefined) continue;
    const limit = profile.limits[key];
    const share = Math.round((amount / limit) * 100);
    reasons.push(`${label} ${Math.round(amount)} mg is ${share}% of the ${limit} mg daily limit`);
  }
  if (countsAsFluid) reasons.push('counts toward the fluid limit');
  return reasons;
}

function spokenVerdict(verdict) {
  return { ok: 'Okay', limit: 'Limit', avoid: 'Avoid' }[verdict];
}

export async function checkFood(input = {}) {
  const food = input?.food;
  const profile = input?.profile;
  if (!food || typeof food.name !== 'string' || !food.name.trim()) {
    return { ok: false, error: 'food name is required' };
  }
  if (!profileIsValid(profile)) return { ok: false, error: 'a valid patient profile is required' };
  if (food.grams !== undefined && food.grams !== null && !isFiniteNonNegative(food.grams)) {
    return { ok: false, error: 'food grams must be a non-negative number' };
  }

  try {
    const name = food.name.trim();
    const normalizedName = normalizeFoodName(name);
    const profileAvoid = (profile.avoid ?? []).map(normalizeFoodName);
    const hardRules = await readData('hard-rules.json');
    const hardRule = hardRules.alwaysAvoid.find((entry) => normalizeFoodName(entry.name) === normalizedName);
    const personalAvoid = profileAvoid.includes(normalizedName);
    if (hardRule || personalAvoid) {
      const reason = hardRule?.reason ?? `${name} is on this patient's care-team avoid list`;
      return {
        ok: true,
        food: name,
        verdict: 'avoid',
        say: `Avoid ${name}. It is on the kidney care team's avoid list.`,
        reasons: [reason],
        nutrients: null,
        portion: food.grams == null ? 'not estimated' : `${food.grams} g`,
        swap: SWAPS[normalizedName] ?? 'an unseasoned fresh alternative',
        source: 'rule',
      };
    }
    const isLabel = food.label !== undefined && food.label !== null;

    let nutrients;
    let portion;
    let source;
    let per100 = false;
    let countsAsFluid = /\b(soup|broth|drink|juice|cola|coffee|water|tea|ice)\b/i.test(name);
    if (isLabel) {
      const label = food.label;
      if (!label || typeof label !== 'object') return { ok: false, error: 'food label is invalid' };
      for (const [key] of NUTRIENTS) {
        if (label[key] !== null && label[key] !== undefined && !isFiniteNonNegative(label[key])) {
          return { ok: false, error: `label ${key} must be a non-negative number or null` };
        }
      }
      nutrients = Object.fromEntries(NUTRIENTS.map(([key]) => [key, label[key] ?? null]));
      portion = label.servingSize || 'one labeled serving';
      source = 'label';
    } else {
      const lookup = await lookupFood(food);
      if (!lookup.ok) return lookup;
      if (!lookup.found) {
        return {
          ok: true,
          food: name,
          verdict: 'unknown',
          say: `I do not have reliable nutrition numbers for ${name}, so I cannot judge it yet.`,
          reasons: ['no label, seeded food data, or USDA result was available'],
          nutrients: null,
          portion: food.grams == null ? 'unknown' : `${food.grams} g`,
          swap: null,
          source: 'none',
        };
      }
      const knownServing = Number.isFinite(lookup.servingGrams) && lookup.servingGrams > 0;
      const grams = food.grams ?? (knownServing ? lookup.servingGrams : 100);
      per100 = food.grams == null && !knownServing;
      const multiplier = grams / 100;
      nutrients = Object.fromEntries(NUTRIENTS.map(([key]) => {
        const value = lookup.nutrients?.[key];
        if (typeof value !== 'number') return [key, null];
        const scaled = Math.round(value * multiplier);
        return [key, isFiniteNonNegative(scaled) ? scaled : null];
      }));
      countsAsFluid ||= lookup.fluid === true;
      portion = per100
        ? '100 g (no typical serving size known)'
        : food.grams == null
          ? lookup.portion
          : `${food.grams} g${lookup.portion ? ` (${lookup.portion} typical serving)` : ''}`;
      source = lookup.source;
    }

    const ruleReasons = [];
    let verdict = 'ok';
    let worst = null;
    for (const [key, label] of NUTRIENTS) {
      const amount = nutrients[key];
      if (amount === null || amount === undefined) continue;
      const share = amount / profile.limits[key];
      if (!worst || share > worst.share) worst = { key, label, amount, share };
      if (share > 0.25) verdict = 'avoid';
      else if (share >= 0.1 && verdict === 'ok') verdict = 'limit';
    }

    if (hardRule || personalAvoid) {
      verdict = 'avoid';
      source = 'rule';
      ruleReasons.push(hardRule?.reason ?? `${name} is on this patient's care-team avoid list`);
    }
    const alwaysLimit = hardRules.alwaysLimit.find((entry) => normalizeFoodName(entry.name) === normalizedName);
    if (alwaysLimit && verdict === 'ok') {
      verdict = 'limit';
      source = 'rule';
      ruleReasons.push(alwaysLimit.reason);
    }

    if (isLabel && typeof food.label.ingredients === 'string') {
      if (/phos/i.test(food.label.ingredients)) {
        if (verdict === 'ok') verdict = 'limit';
        source = 'rule';
        ruleReasons.push('phosphate additive in the ingredients can add phosphorus not shown on the label');
      }
      if (/potassium\s+chloride/i.test(food.label.ingredients)) {
        if (verdict === 'ok') verdict = 'limit';
        source = 'rule';
        ruleReasons.push('potassium chloride in the ingredients is a potassium salt substitute');
      }
    }

    const reasons = buildReasons(nutrients, profile, ruleReasons, countsAsFluid);
    const swap = verdict === 'avoid' ? (SWAPS[normalizedName] ?? 'an unseasoned fresh alternative') : null;
    let say;
    if (!worst) {
      if (verdict === 'limit') {
        say = `Limit ${name}. ${ruleReasons[0] ?? 'The ingredient list needs a closer review.'}`;
      } else if (verdict === 'avoid') {
        say = `Avoid ${name}. ${ruleReasons[0] ?? 'It is too high for the daily limits.'}`;
      } else {
        say = 'I cannot judge this food because its label does not show enough nutrition information.';
        verdict = 'unknown';
      }
    } else {
      const amount = numberWords(worst.amount);
      say = `${spokenVerdict(verdict)}, ${name} has about ${amount} milligrams of ${worst.label}${per100 ? ' in 100 grams' : ''}.`;
      if (swap) say += ` Try ${swap} instead.`;
      else if (verdict === 'limit') say += ' A smaller portion may fit better.';
    }

    return {
      ok: true,
      food: name,
      verdict,
      say,
      reasons,
      nutrients,
      portion,
      swap,
      source,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'could not check food';
    return { ok: false, error: message.slice(0, 120) || 'could not check food' };
  }
}
