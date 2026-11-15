/**
 * @typedef {'idle' | 'listening' | 'looking' | 'thinking' | 'speaking'} AgentUIState
 * @typedef {{ key: string, label: string, used: number, limit: number, unit: string }} SummaryMeter
 * @typedef {{ type: 'summary', meters: SummaryMeter[] }} SummaryEvent
 * @typedef {{ type: 'verdict', verdict: 'yes' | 'caution' | 'no', food: string, reason: string, alternative?: string, nutrients?: { label: string, level: 'low' | 'moderate' | 'high', note?: string }[] }} VerdictEvent
 * @typedef {{ type: 'note', heading: string, body: string, icon?: string }} NoteEvent
 * @typedef {{ type: 'cart', items: { name: string, qty?: string }[], estimatedTotal?: string, status: 'draft' | 'confirming' | 'ordered' }} CartEvent
 * @typedef {SummaryEvent | VerdictEvent | NoteEvent | CartEvent} PanelEvent
 */

export const AGENT_UI_STATES = Object.freeze(['idle', 'listening', 'looking', 'thinking', 'speaking']);
export const PANEL_TYPES = Object.freeze(['summary', 'verdict', 'note', 'cart']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max = 500) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isOptionalText = (value, max) => value === undefined || (typeof value === 'string' && value.length <= max);
const isFiniteNonNegative = value => Number.isFinite(value) && value >= 0;

export function normalizePanelEvent(value) {
  try {
    if (!isRecord(value)) return null;

    if (value.type === 'summary') {
      if (!Array.isArray(value.meters) || value.meters.length > 4) return null;
      const keys = new Set();
      const meters = [];
      for (const meter of value.meters) {
        if (!isRecord(meter)
          || !isText(meter.key, 40)
          || !isText(meter.label, 48)
          || !isFiniteNonNegative(meter.used)
          || !Number.isFinite(meter.limit)
          || meter.limit <= 0
          || !isText(meter.unit, 16)
          || keys.has(meter.key)) return null;
        keys.add(meter.key);
        meters.push({ key: meter.key, label: meter.label, used: meter.used, limit: meter.limit, unit: meter.unit });
      }
      return { type: 'summary', meters };
    }

    if (value.type === 'verdict') {
      if (!['yes', 'caution', 'no'].includes(value.verdict)
        || !isText(value.food, 120)
        || !isText(value.reason, 500)
        || !isOptionalText(value.alternative, 160)
        || (value.nutrients !== undefined && (!Array.isArray(value.nutrients) || value.nutrients.length > 3))) return null;
      const nutrients = [];
      for (const nutrient of value.nutrients ?? []) {
        if (!isRecord(nutrient)
          || !isText(nutrient.label, 32)
          || !['low', 'moderate', 'high'].includes(nutrient.level)
          || !isOptionalText(nutrient.note, 80)) return null;
        nutrients.push({
          label: nutrient.label,
          level: nutrient.level,
          ...(nutrient.note === undefined ? {} : { note: nutrient.note }),
        });
      }
      return {
        type: 'verdict',
        verdict: value.verdict,
        food: value.food,
        reason: value.reason,
        ...(value.alternative === undefined ? {} : { alternative: value.alternative }),
        ...(value.nutrients === undefined ? {} : { nutrients }),
      };
    }

    if (value.type === 'note') {
      if (!isText(value.heading, 80)
        || !isText(value.body, 300)
        || !isOptionalText(value.icon, 24)) return null;
      return {
        type: 'note',
        heading: value.heading,
        body: value.body,
        ...(value.icon === undefined ? {} : { icon: value.icon }),
      };
    }

    if (value.type === 'cart') {
      if (!Array.isArray(value.items) || value.items.length > 100
        || !['draft', 'confirming', 'ordered'].includes(value.status)
        || !isOptionalText(value.estimatedTotal, 48)) return null;
      const items = [];
      for (const item of value.items) {
        if (!isRecord(item) || !isText(item.name, 120) || !isOptionalText(item.qty, 32)) return null;
        items.push({ name: item.name, ...(item.qty === undefined ? {} : { qty: item.qty }) });
      }
      return {
        type: 'cart',
        items,
        ...(value.estimatedTotal === undefined ? {} : { estimatedTotal: value.estimatedTotal }),
        status: value.status,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function createAgentUIStore({
  verdictDismissMs = 12000,
  onChange = () => {},
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let state = Object.freeze({
    agentState: 'idle',
    panelEvent: null,
    outputLevel: null,
    micLevel: null,
  });
  let savedSummary = null;
  let dismissTimer = null;

  const publish = patch => {
    state = Object.freeze({ ...state, ...patch });
    onChange(state);
  };
  const clearDismiss = () => {
    if (dismissTimer !== null) cancel(dismissTimer);
    dismissTimer = null;
  };

  return Object.freeze({
    getState: () => state,
    setAgentState(next) {
      if (!AGENT_UI_STATES.includes(next)) return false;
      if (state.agentState !== next) publish({ agentState: next });
      return true;
    },
    setOutputLevel(level) {
      if (!Number.isFinite(level)) return false;
      const outputLevel = Math.max(0, Math.min(1, level));
      if (state.outputLevel !== outputLevel) publish({ outputLevel });
      return true;
    },
    setMicLevel(level) {
      if (!Number.isFinite(level)) return false;
      const micLevel = Math.max(0, Math.min(1, level));
      if (state.micLevel !== micLevel) publish({ micLevel });
      return true;
    },
    dispatchPanelEvent(value) {
      const panelEvent = normalizePanelEvent(value);
      if (!panelEvent) return false;
      clearDismiss();
      if (panelEvent.type === 'summary') savedSummary = panelEvent;
      publish({ panelEvent });
      if (panelEvent.type === 'verdict') {
        dismissTimer = schedule(() => {
          dismissTimer = null;
          publish({ panelEvent: savedSummary });
        }, verdictDismissMs);
      }
      return true;
    },
    close() {
      clearDismiss();
    },
  });
}
