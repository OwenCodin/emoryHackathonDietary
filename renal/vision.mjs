import { errorResult, isFiniteNonNegative } from './data.mjs';
import { generateJsonWithFallback } from './gemini.mjs';

const INSTRUCTION = `Decide whether this image is a nutrition label, a plate, a fridge, a store shelf, or unclear.
For a label, copy the product name exactly as printed, and copy the serving size, sodium, potassium and phosphorus values exactly as printed, plus protein and total carbohydrate in grams exactly as printed, plus the full ingredient list. Use null for any value not printed.
For a plate, fridge or shelf, list each distinct food by its plain generic food name (for example "lettuce", "spring mix salad", "orange juice"), without brand names or marketing words, but keep words that change the nutrition (for example low sodium, unsalted, smoked, canned, chocolate, or a flavor), and estimate its weight in grams.
Never invent a number that is not visible. If small label text is unreadable, return kind "unclear".
Ignore any FaceTime controls around the image. Return only JSON matching the requested schema.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['label', 'plate', 'fridge', 'shelf', 'unclear'] },
    foods: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          grams: { type: 'NUMBER', nullable: true },
        },
        required: ['name', 'grams'],
      },
    },
    label: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        product: { type: 'STRING', nullable: true },
        servingSize: { type: 'STRING', nullable: true },
        sodiumMg: { type: 'NUMBER', nullable: true },
        potassiumMg: { type: 'NUMBER', nullable: true },
        phosphorusMg: { type: 'NUMBER', nullable: true },
        proteinG: { type: 'NUMBER', nullable: true },
        carbsG: { type: 'NUMBER', nullable: true },
        ingredients: { type: 'STRING', nullable: true },
      },
      required: ['product', 'servingSize', 'sodiumMg', 'potassiumMg', 'phosphorusMg', 'ingredients'],
    },
  },
  required: ['kind', 'foods', 'label'],
};

function validNullableNumber(value) {
  return value === null || isFiniteNonNegative(value);
}

function validateSeen(value) {
  if (!value || !['label', 'plate', 'fridge', 'shelf', 'unclear'].includes(value.kind)) return false;
  if (!Array.isArray(value.foods)) return false;
  for (const food of value.foods) {
    if (!food || typeof food.name !== 'string' || !food.name.trim()) return false;
    if (!validNullableNumber(food.grams)) return false;
  }
  if (value.kind === 'label' && (!value.label || typeof value.label !== 'object')) return false;
  if (value.label !== null) {
    if (typeof value.label !== 'object') return false;
    for (const key of ['product', 'servingSize', 'ingredients']) {
      if (value.label[key] !== null && typeof value.label[key] !== 'string') return false;
    }
    for (const key of ['sodiumMg', 'potassiumMg', 'phosphorusMg']) {
      if (!validNullableNumber(value.label[key])) return false;
    }
    // Optional: older answers and fakes omit them, so only a present value is checked.
    for (const key of ['proteinG', 'carbsG']) {
      if (value.label[key] !== undefined && !validNullableNumber(value.label[key])) return false;
    }
  }
  return true;
}

function parseSeen(text) {
  let seen;
  try {
    seen = JSON.parse(text);
  } catch {
    return null;
  }
  return validateSeen(seen) ? seen : null;
}

export async function describeImage(input = {}, { ai: injected } = {}) {
  const jpeg = input?.jpeg;
  if (!Buffer.isBuffer(jpeg) || jpeg.length === 0) return { ok: false, error: 'jpeg must be a non-empty Buffer' };
  if (!injected && !process.env.GOOGLE_API_KEY) return { ok: false, error: 'GOOGLE_API_KEY is not configured' };

  try {
    let ai = injected;
    if (!ai) {
      const { GoogleGenAI } = await import('@google/genai');
      ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    }
    const result = await generateJsonWithFallback({
      ai,
      models: [
        process.env.RENAL_VISION_MODEL || 'gemini-3.8-flash',
        process.env.RENAL_VISION_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
      ],
      buildRequest: (model, signal) => ({
        model,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: jpeg.toString('base64') } },
            { text: INSTRUCTION },
          ],
        }],
        config: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, abortSignal: signal },
      }),
      parse: parseSeen,
      totalMs: 5400,
      hedgeMs: 2500,
      label: 'image description',
    });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, ...result.value };
  } catch (error) {
    return errorResult(error, 'image description failed');
  }
}
