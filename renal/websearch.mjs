import { isFiniteNonNegative, normalizeFoodName, plausibleMatch } from './data.mjs';
import { generateJsonWithFallback } from './gemini.mjs';

// Per serving, inclusive. A grounded answer outside these is treated as a misread, never spoken.
export const WEB_BOUNDS = { sodiumMg: 5000, potassiumMg: 5000, phosphorusMg: 3000 };
export const SERVING_BOUNDS = { min: 1, max: 2000 };

// Time budget: the USDA fetch (2400 ms) plus this lookup (5500 ms) plus file I/O must stay under the
// agent's 12000 ms guard for check_food and look_at_camera, where up to 6 checks run in parallel.
export const WEB_TOTAL_MS = 5500;
export const WEB_HEDGE_MS = 3000;
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

const NUTRIENT_KEYS = ['sodiumMg', 'potassiumMg', 'phosphorusMg'];

const PROMPT_HEAD = `Use Google Search to find the nutrition facts for ONE typical serving of this food or product: "`;
const PROMPT_TAIL = `".
Prefer the manufacturer's own website or an official nutrition database.
Report only numbers that are stated in the search results. Write unknown for anything that is not stated. Never estimate, convert or calculate a value.
PHOSPHATE_ADDITIVE is yes only if the ingredient list includes a phosphate or phosphoric acid, no if the ingredient list was found and has none, otherwise unknown.
Answer with one short sentence naming where you found the facts, then exactly these seven lines and nothing after them:
PRODUCT: <the product or food name as the source writes it>
SERVING: <the serving as the source writes it, for example 1 cup (240 ml)>
SERVING_AMOUNT: <the serving size in grams or milliliters, for example 240 ml, or unknown>
SODIUM_MG: <number or unknown>
POTASSIUM_MG: <number or unknown>
PHOSPHORUS_MG: <number or unknown>
PHOSPHATE_ADDITIVE: <yes, no or unknown>`;

export function buildPrompt(query) {
  return `${PROMPT_HEAD}${query}${PROMPT_TAIL}`;
}

function lineValue(text, key) {
  const pattern = new RegExp(`^[ \\t]*(?:[-*][ \\t]+)?\\**[ \\t]*${key}[ \\t]*\\**[ \\t]*:[ \\t]*\\**[ \\t]*(.*?)[ \\t]*$`, 'gim');
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) return null;
  return matches[0][1].replace(/^\*+|\*+$/g, '').trim();
}

function parseMg(value) {
  if (/^unknown$/i.test(value)) return { ok: true, value: null };
  const match = /^(\d{1,5}(?:\.\d{1,2})?)\s*(?:mg)?$/i.exec(value);
  if (!match) return { ok: false };
  return { ok: true, value: Number(match[1]) };
}

// Strict line parser. Anything that is not exactly the requested format rejects the whole answer.
export function parseNutritionAnswer(text) {
  if (typeof text !== 'string') return null;
  const raw = {};
  for (const key of ['PRODUCT', 'SERVING', 'SERVING_AMOUNT', 'SODIUM_MG', 'POTASSIUM_MG', 'PHOSPHORUS_MG', 'PHOSPHATE_ADDITIVE']) {
    const value = lineValue(text, key);
    if (value === null) return null;
    raw[key] = value;
  }
  if (raw.PRODUCT.length < 1 || raw.PRODUCT.length > 120) return null;
  if (raw.SERVING.length < 1 || raw.SERVING.length > 80) return null;

  let servingAmount = null;
  let servingUnit = null;
  if (!/^unknown$/i.test(raw.SERVING_AMOUNT)) {
    const match = /^(\d{1,4}(?:\.\d{1,2})?)\s*(g|ml)$/i.exec(raw.SERVING_AMOUNT);
    if (!match) return null;
    servingAmount = Number(match[1]);
    servingUnit = match[2].toLowerCase();
  }

  const nutrients = {};
  for (const [field, key] of [['sodiumMg', 'SODIUM_MG'], ['potassiumMg', 'POTASSIUM_MG'], ['phosphorusMg', 'PHOSPHORUS_MG']]) {
    const parsed = parseMg(raw[key]);
    if (!parsed.ok) return null;
    nutrients[field] = parsed.value;
  }

  let phosphateAdditive;
  if (/^yes$/i.test(raw.PHOSPHATE_ADDITIVE)) phosphateAdditive = true;
  else if (/^no$/i.test(raw.PHOSPHATE_ADDITIVE)) phosphateAdditive = false;
  else if (/^unknown$/i.test(raw.PHOSPHATE_ADDITIVE)) phosphateAdditive = null;
  else return null;

  return {
    name: raw.PRODUCT,
    servingText: raw.SERVING,
    servingAmount,
    servingUnit,
    nutrients,
    phosphateAdditive,
  };
}

const HOST_PATTERN = /^[a-z0-9.-]{1,80}\.[a-z]{2,}$/;
const REDIRECT_HOST = /(^|\.)(vertexaisearch\.cloud\.google\.com|google\.com|googleusercontent\.com|gstatic\.com)$/;

function cleanHost(value) {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase().replace(/^www\./, '');
  return HOST_PATTERN.test(host) && !REDIRECT_HOST.test(host) ? host : null;
}

// Grounding evidence: at least one web search query AND at least one chunk with a web URI.
// Returns { queries, host } (host may be null) or null when the answer was not actually grounded.
export function groundingSource(response) {
  const metadata = response?.candidates?.[0]?.groundingMetadata;
  const queries = Array.isArray(metadata?.webSearchQueries)
    ? metadata.webSearchQueries.filter((query) => typeof query === 'string' && query.trim())
    : [];
  if (queries.length === 0) return null;
  const chunks = Array.isArray(metadata?.groundingChunks) ? metadata.groundingChunks : [];
  const webChunks = chunks.filter((chunk) => typeof chunk?.web?.uri === 'string' && /^https?:\/\//i.test(chunk.web.uri));
  if (webChunks.length === 0) return null;
  let host = null;
  for (const chunk of webChunks) {
    host = cleanHost(chunk.web.domain) ?? cleanHost(chunk.web.title);
    if (!host) {
      try {
        host = cleanHost(new URL(chunk.web.uri).hostname);
      } catch {
        host = null;
      }
    }
    if (host) break;
  }
  return { queries: queries.length, host };
}

// Used on fresh answers and on every cache read.
export function acceptWebEntry(query, entry) {
  if (!entry || entry.kind !== 'web') return false;
  if (!plausibleMatch(query, entry.name)) return false;
  if (typeof entry.servingText !== 'string' || !entry.servingText.trim()) return false;
  if (!entry.nutrients || typeof entry.nutrients !== 'object') return false;
  let any = false;
  for (const key of NUTRIENT_KEYS) {
    const value = entry.nutrients[key];
    if (value === null) continue;
    if (!isFiniteNonNegative(value) || value > WEB_BOUNDS[key]) return false;
    any = true;
  }
  if (!any) return false;
  if (entry.servingAmount !== null && entry.servingAmount !== undefined) {
    if (!Number.isFinite(entry.servingAmount) || entry.servingAmount < SERVING_BOUNDS.min || entry.servingAmount > SERVING_BOUNDS.max) return false;
    if (entry.servingUnit !== 'g' && entry.servingUnit !== 'ml') return false;
  }
  return entry.phosphateAdditive === true || entry.phosphateAdditive === false || entry.phosphateAdditive === null;
}

export async function lookupWeb(name, { ai: injected, totalMs = WEB_TOTAL_MS } = {}) {
  try {
    const query = normalizeFoodName(name).slice(0, 80);
    if (!query) return { ok: true, found: false };
    if (!injected && !process.env.GOOGLE_API_KEY) return { ok: true, found: false };

    let ai = injected;
    if (!ai) {
      const { GoogleGenAI } = await import('@google/genai');
      ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    }
    const prompt = buildPrompt(query);
    const result = await generateJsonWithFallback({
      ai,
      models: [
        process.env.RENAL_LOOKUP_MODEL || DEFAULT_MODEL,
        process.env.RENAL_LOOKUP_FALLBACK_MODEL || '',
      ],
      buildRequest: (model, signal) => ({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        // No responseMimeType or responseSchema: JSON mode lost grounding in live tests.
        config: { tools: [{ googleSearch: {} }], temperature: 0, abortSignal: signal },
      }),
      parse: (text, response) => {
        const source = groundingSource(response);
        if (!source) return null;
        const parsed = parseNutritionAnswer(text);
        if (!parsed) return null;
        const entry = {
          kind: 'web',
          name: parsed.name,
          query,
          servingText: parsed.servingText,
          servingAmount: parsed.servingAmount,
          servingUnit: parsed.servingUnit,
          nutrients: parsed.nutrients,
          phosphateAdditive: parsed.phosphateAdditive,
          host: source.host,
          waterMl: null,
        };
        return acceptWebEntry(query, entry) ? entry : null;
      },
      totalMs,
      hedgeMs: WEB_HEDGE_MS,
      label: 'web lookup',
    });
    if (result.ok) return { ok: true, found: true, entry: result.value };
    if (result.error === 'bad model output') return { ok: true, found: false, rejected: true };
    return { ok: true, found: false };
  } catch {
    return { ok: true, found: false };
  }
}
