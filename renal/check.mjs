import { isFiniteNonNegative, normalizeFoodName, readData } from './data.mjs';
import { lookupFood } from './nutrients.mjs';

// Said when no specific swap is known. It names no food, so list and recipe code must not treat it as one.
export const GENERIC_SWAP = 'an unseasoned fresh alternative';

const NUTRIENTS = [
  ['sodiumMg', 'sodium'],
  ['potassiumMg', 'potassium'],
  ['phosphorusMg', 'phosphorus'],
];
// Optional daily limits in grams. Judged only for a profile that has them; everyone else sees exactly the three minerals.
const MACROS = [
  ['proteinG', 'protein'],
  ['carbsG', 'carbohydrates'],
];
const MACRO_KEYS = MACROS.map(([key]) => key);
const isMacro = (key) => MACRO_KEYS.includes(key);
// Protein and carbohydrate are eaten at every meal, so they are judged against a third (avoid) and a fifth (limit)
// of the day instead of the minerals' 25% and 10% per item.
const AVOID_SHARE = (key) => (isMacro(key) ? 1 / 3 : 0.25);
const LIMIT_SHARE = (key) => (isMacro(key) ? 0.2 : 0.1);
const unitOf = (key) => (isMacro(key) ? 'g' : 'mg');
const activeNutrients = (profile) => [
  ...NUTRIENTS,
  ...MACROS.filter(([key]) => Number.isFinite(profile.limits[key]) && profile.limits[key] > 0),
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

// Whole-phrase match: the rule name equals the name or appears in it on word boundaries.
function phraseMatches(ruleName, name) {
  const rule = normalizeFoodName(ruleName);
  if (!rule || !name) return false;
  return ` ${name} `.includes(` ${rule} `);
}

function sentenceCase(text) {
  const trimmed = String(text).trim();
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}` : '';
}

function profileIsValid(profile) {
  return profile?.limits && NUTRIENTS.every(([key]) => isFiniteNonNegative(profile.limits[key]));
}

function buildReasons(nutrients, profile, ruleReasons, countsAsFluid, active) {
  const reasons = [...ruleReasons];
  for (const [key, label] of active) {
    const amount = nutrients[key];
    if (amount === null || amount === undefined) continue;
    const limit = profile.limits[key];
    const share = Math.round((amount / limit) * 100);
    reasons.push(`${label} ${Math.round(amount)} ${unitOf(key)} is ${share}% of the ${limit} ${unitOf(key)} daily limit`);
  }
  if (countsAsFluid) reasons.push('counts toward the fluid limit');
  return reasons;
}

function spokenVerdict(verdict) {
  return { ok: 'Okay', limit: 'Limit', avoid: 'Avoid' }[verdict];
}

const WEB_PROVENANCE = "That is from what I found online, not from your care team's list.";

export async function checkFood(input = {}, { ai } = {}) {
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
    const active = activeNutrients(profile);
    const name = food.name.trim();
    const normalizedName = normalizeFoodName(name);
    const profileAvoid = (profile.avoid ?? []).map(normalizeFoodName);
    const hardRules = await readData('hard-rules.json');
    const avoidFor = (names) => {
      const hardRule = hardRules.alwaysAvoid.find((entry) => names.some((n) => phraseMatches(entry.name, n)));
      const personalAvoid = names.some((n) => profileAvoid.includes(n));
      if (!hardRule && !personalAvoid) return null;
      const reason = hardRule?.reason ?? `${name} is on this patient's care-team avoid list`;
      return {
        ok: true,
        food: name,
        verdict: 'avoid',
        say: `Avoid ${name}. It is on the kidney care team's avoid list.`,
        reasons: [reason],
        nutrients: null,
        portion: food.grams == null ? 'not estimated' : `${food.grams} g`,
        swap: SWAPS[names[names.length - 1]] ?? SWAPS[names[0]] ?? GENERIC_SWAP,
        source: 'rule',
      };
    };
    const earlyAvoid = avoidFor([normalizedName]);
    if (earlyAvoid) return earlyAvoid;
    const isLabel = food.label !== undefined && food.label !== null;

    let nutrients;
    let portion;
    let source;
    let per100 = false;
    let canonical = null;
    let countsAsFluid = /\b(soup|broth|drink|juice|cola|coffee|water|tea|ice)\b/i.test(name);
    let labelHasNumbers = false;
    let fromWeb = false;
    let webMultiplier = null;
    let webHost = null;
    let phosphateAdditiveOnline = false;
    const ruleReasons = [];
    if (isLabel) {
      const label = food.label;
      if (!label || typeof label !== 'object') return { ok: false, error: 'food label is invalid' };
      for (const [key] of active) {
        if (label[key] !== null && label[key] !== undefined && !isFiniteNonNegative(label[key])) {
          return { ok: false, error: `label ${key} must be a non-negative number or null` };
        }
      }
      labelHasNumbers = active.some(([key]) => isFiniteNonNegative(label[key]));
    }

    const noNutrients = () => Object.fromEntries(active.map(([key]) => [key, null]));
    if (isLabel && labelHasNumbers) {
      const label = food.label;
      nutrients = Object.fromEntries(active.map(([key]) => [key, label[key] ?? null]));
      portion = label.servingSize || 'one labeled serving';
      source = 'label';
    } else {
      // No label numbers (or not a label): judge by name, seed first, then guarded USDA.
      const lookupName = name; // food.name is validated non-empty; a label's product is only a fallback if that ever changes
      const lookup = await lookupFood({ ...food, name: lookupName }, { ai });
      if (!isLabel && !lookup.ok) return lookup;
      if (!lookup.ok || !lookup.found) {
        if (isLabel) {
          // Ingredient rules and name rules below may still decide.
          nutrients = noNutrients();
          portion = food.label.servingSize || 'one labeled serving';
          source = 'none';
        } else {
          const limitRule = hardRules.alwaysLimit.find((entry) => phraseMatches(entry.name, normalizedName));
          if (limitRule) {
            return {
              ok: true,
              food: name,
              verdict: 'limit',
              say: `Limit ${name}. ${sentenceCase(limitRule.reason)}.`,
              reasons: [limitRule.reason],
              nutrients: null,
              portion: food.grams == null ? 'unknown' : `${food.grams} g`,
              swap: null,
              source: 'rule',
            };
          }
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
      } else {
        if (lookup.matched === 'seed' && typeof lookup.name === 'string') {
          canonical = normalizeFoodName(lookup.name);
          const lateAvoid = avoidFor([normalizedName, canonical]);
          if (lateAvoid) return lateAvoid;
        }
        fromWeb = lookup.source === 'web';
        if (fromWeb) {
          // Per found serving: the online numbers are never rescaled by guesswork.
          const canScale = food.grams != null && Number.isFinite(lookup.servingAmount) && lookup.servingAmount > 0;
          webMultiplier = canScale ? food.grams / lookup.servingAmount : 1;
          portion = canScale
            ? `${food.grams} g (online serving: ${lookup.servingText})`
            : food.grams == null
              ? lookup.servingText
              : `${lookup.servingText} (online serving; your amount was not converted)`;
          nutrients = Object.fromEntries(active.map(([key]) => {
            const value = lookup.nutrients?.[key];
            if (typeof value !== 'number') return [key, null];
            const scaled = Math.round(value * webMultiplier);
            return [key, isFiniteNonNegative(scaled) ? scaled : null];
          }));
          countsAsFluid ||= lookup.servingUnit === 'ml';
          source = 'web';
          webHost = typeof lookup.host === 'string' ? lookup.host : null;
          phosphateAdditiveOnline = lookup.phosphateAdditive === true;
        } else {
        if (lookup.genericFrom) ruleReasons.push(`judged as ${lookup.name}`);
        const knownServing = Number.isFinite(lookup.servingGrams) && lookup.servingGrams > 0;
        const grams = food.grams ?? (knownServing ? lookup.servingGrams : 100);
        per100 = food.grams == null && !knownServing;
        const multiplier = grams / 100;
        nutrients = Object.fromEntries(active.map(([key]) => {
          const value = lookup.nutrients?.[key];
          if (typeof value !== 'number') return [key, null];
          const scaled = Math.round(value * multiplier);
          return [key, isFiniteNonNegative(scaled) ? scaled : null];
        }));
        countsAsFluid ||= lookup.fluid === true;
        portion = per100
          ? '100 g (no typical serving size known)'
          : food.grams == null
            ? `${lookup.portion}${lookup.servingEstimated ? ' (estimated typical serving)' : ''}`
            : `${food.grams} g${lookup.portion ? ` (${lookup.portion} typical serving)` : ''}`;
        source = lookup.source;
        if (lookup.genericFrom) portion = `${portion} (judged as ${lookup.name})`;
        }
      }
    }

    let verdict = 'ok';
    let worst = null;
    for (const [key, label] of active) {
      const amount = nutrients[key];
      if (amount === null || amount === undefined) continue;
      const share = amount / profile.limits[key];
      // Severity is the share relative to its own avoid line; for the minerals this orders exactly as the raw share does.
      const severity = share / AVOID_SHARE(key);
      if (!worst || severity > worst.severity) worst = { key, label, amount, share, severity };
      if (share > AVOID_SHARE(key)) verdict = 'avoid';
      else if (share >= LIMIT_SHARE(key) && verdict === 'ok') verdict = 'limit';
    }

    const ruleNames = canonical && canonical !== normalizedName ? [normalizedName, canonical] : [normalizedName];
    const alwaysLimit = hardRules.alwaysLimit.find((entry) => ruleNames.some((n) => phraseMatches(entry.name, n)));
    let ruleEscalated = false;
    if (alwaysLimit) {
      if (verdict === 'ok') {
        verdict = 'limit';
        ruleEscalated = true;
      }
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

    if (fromWeb) {
      if (phosphateAdditiveOnline) {
        if (verdict === 'ok') verdict = 'limit';
        ruleReasons.push('the ingredients found online list a phosphate additive, which can add phosphorus');
      }
      // Provenance beats rule attribution: online numbers are always announced as online.
      source = 'web';
    }

    const reasons = buildReasons(nutrients, profile, ruleReasons, countsAsFluid, active);
    if (fromWeb) reasons.push(`nutrition found online${webHost ? ` (${webHost})` : ''}, per ${portion}`);
    const swap = verdict === 'avoid' ? ((canonical && SWAPS[canonical]) ?? SWAPS[normalizedName] ?? GENERIC_SWAP) : null;
    let say;
    if (!worst) {
      if (verdict === 'limit') {
        say = `Limit ${name}. ${ruleReasons[0] ?? 'The ingredient list needs a closer review.'}`;
      } else if (verdict === 'avoid') {
        say = `Avoid ${name}. ${ruleReasons[0] ?? 'It is too high for the daily limits.'}`;
      } else {
        say = 'I cannot judge this food because its label does not show enough nutrition information.';
        verdict = 'unknown';
        nutrients = null;
        source = 'none';
      }
    } else {
      const amount = numberWords(worst.amount);
      const unitWord = isMacro(worst.key) ? 'grams' : 'milligrams';
      if (fromWeb) {
        say = `${spokenVerdict(verdict)}, ${name} has about ${amount} ${unitWord} of ${worst.label}${webMultiplier === 1 ? ' per serving' : ''}`;
        if (swap) say += `; try ${swap} instead`;
        else if (phosphateAdditiveOnline) say += ', and it has a phosphate additive';
        else if (nutrients.phosphorusMg === null) say += ', and I could not find its phosphorus';
        else if (verdict === 'limit') say += ', so a smaller portion may fit better';
        say += `. ${WEB_PROVENANCE}`;
      } else {
      say = `${spokenVerdict(verdict)}, ${name} has about ${amount} ${unitWord} of ${worst.label}${per100 ? ' in 100 grams' : ''}.`;
      if (swap) say += ` Try ${swap} instead.`;
      else if (ruleEscalated && alwaysLimit) say += ` ${sentenceCase(alwaysLimit.reason)}.`;
      else if (verdict === 'limit') say += ' A smaller portion may fit better.';
      }
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
