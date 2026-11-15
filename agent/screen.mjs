import { HEIGHT, SAFE_SCALE, WIDTH, safeArea } from '../shared/video.mjs';
import { panelSvg, renderSvg, sceneSvg, UI_TOKENS } from './card.mjs';
import { createOrbPainter } from './orb.mjs';
import { createAgentUIStore, normalizePanelEvent } from './ui-state.mjs';

const LENGTH = WIDTH * HEIGHT * 4;
const DEFAULT_VERDICT_MS = 12000;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const SAFE = safeArea(SAFE_SCALE);

export function verdictMsFrom(env = process.env) {
  const seconds = Number(env?.AGENT_CARD_SECONDS);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(120, seconds) * 1000
    : DEFAULT_VERDICT_MS;
}

export function panelEventFromDisplay(display) {
  const direct = normalizePanelEvent(display);
  if (direct) return direct;
  if (!display || typeof display !== 'object' || !Array.isArray(display.items)) return null;

  const first = display.items.find(item => item && typeof item === 'object');
  if (!first) return null;
  const reason = typeof first.reason === 'string' ? first.reason : '';
  if (display.unjudged === true) {
    const body = typeof display.reason === 'string' && display.reason.trim()
      ? display.reason
      : reason;
    return normalizePanelEvent({
      type: 'note',
      heading: 'More information',
      body: body.trim() ? body : 'The agent will explain this result aloud.',
      icon: 'info',
    });
  }

  const verdict = ({ ok: 'yes', limit: 'caution', avoid: 'no' })[first.verdict];
  if (!verdict) {
    return normalizePanelEvent({
      type: 'note',
      heading: 'More information',
      body: reason || 'The agent will explain this result aloud.',
      icon: 'info',
    });
  }
  if (!reason.trim()) {
    return normalizePanelEvent({
      type: 'note',
      heading: 'More information',
      body: 'The agent will explain this result aloud.',
      icon: 'info',
    });
  }
  return normalizePanelEvent({
    type: 'verdict',
    verdict,
    food: typeof first.food === 'string' ? first.food : 'Food',
    reason,
    ...(typeof first.swap === 'string' && first.swap.trim() ? { alternative: first.swap } : {}),
  });
}

export function createScreen({
  render = renderSvg,
  now = Date.now,
  verdictMs = verdictMsFrom(process.env),
  renderTimeoutMs = 3000,
  reducedMotion = process.env.AGENT_REDUCED_MOTION === '1',
  log = message => console.log(message),
} = {}) {
  let base = null;
  let previousBase = null;
  let panel = null;
  let previousPanel = null;
  let stateTransitionStartedAt = 0;
  let panelTransitionStartedAt = 0;
  let stateFrom = 'idle';
  let currentState = 'idle';
  let currentPanel = null;
  let sceneRevision = 0;
  let panelRevision = 0;
  let sceneLogged = false;
  let panelLogged = false;
  const pending = new Set();
  const blank = new Uint8Array(LENGTH);
  for (let i = 0; i < LENGTH; i += 4) {
    blank[i] = Number.parseInt(UI_TOKENS.colors.background.slice(1, 3), 16);
    blank[i + 1] = Number.parseInt(UI_TOKENS.colors.background.slice(3, 5), 16);
    blank[i + 2] = Number.parseInt(UI_TOKENS.colors.background.slice(5, 7), 16);
    blank[i + 3] = 255;
  }
  const orb = createOrbPainter({ reducedMotion, now });

  const safeLog = message => {
    try { log(message); } catch { /* Logging must not interrupt video output. */ }
  };
  const track = promise => {
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
  };

  const draw = async svg => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('render timeout')), renderTimeoutMs);
    });
    try {
      const work = Promise.resolve().then(() => render(svg));
      work.catch(() => {});
      const pixels = await Promise.race([work, timeout]);
      if (!(pixels instanceof Uint8Array) || pixels.length !== LENGTH) throw new Error('render size');
      return pixels;
    } finally {
      clearTimeout(timer);
    }
  };

  const renderScene = () => {
    const revision = ++sceneRevision;
    const task = draw(sceneSvg({ state: currentState })).then(
      pixels => {
        if (revision !== sceneRevision) return;
        previousBase = base;
        base = pixels;
        stateTransitionStartedAt = now();
        if (!previousBase) stateTransitionStartedAt -= UI_TOKENS.transitionMs;
      },
      error => {
        if (!sceneLogged) {
          sceneLogged = true;
          safeLog(`[agent] video scene render failed: ${error?.message ?? 'unknown error'}`);
        }
      },
    );
    track(task);
  };

  const renderPanel = () => {
    const revision = ++panelRevision;
    const task = draw(panelSvg(currentPanel)).then(
      pixels => {
        if (revision !== panelRevision) return;
        previousPanel = panel;
        panel = pixels;
        panelTransitionStartedAt = now();
        if (!previousPanel) panelTransitionStartedAt -= UI_TOKENS.transitionMs;
      },
      error => {
        if (!panelLogged) {
          panelLogged = true;
          safeLog(`[agent] video panel render failed: ${error?.message ?? 'unknown error'}`);
        }
      },
    );
    track(task);
  };

  const store = createAgentUIStore({
    verdictDismissMs: verdictMs,
    onChange: snapshot => {
      let stateChanged = false;
      if (snapshot.agentState !== currentState) {
        stateFrom = currentState;
        currentState = snapshot.agentState;
        stateChanged = true;
      }
      const panelChanged = snapshot.panelEvent !== currentPanel;
      if (panelChanged) currentPanel = snapshot.panelEvent;
      if (stateChanged) renderScene();
      if (panelChanged) renderPanel();
    },
  });

  renderScene();
  renderPanel();

  function compositePanel(pixels, layer, opacity, offsetY) {
    if (!layer || opacity <= 0) return;
    const x0 = Math.max(0, Math.floor(SAFE.x + 82 * SAFE_SCALE));
    const x1 = Math.min(WIDTH, Math.ceil(SAFE.x + 1080 * SAFE_SCALE));
    const top = Math.max(0, Math.floor(SAFE.y + 382 * SAFE_SCALE));
    const bottom = Math.min(HEIGHT, Math.ceil(SAFE.y + 675 * SAFE_SCALE));
    const offset = Math.round(offsetY);
    const y0 = Math.max(0, top + offset);
    const y1 = Math.min(HEIGHT, bottom + offset);
    for (let y = y0; y < y1; y++) {
      const sourceY = y - offset;
      for (let x = x0; x < x1; x++) {
        const index = (sourceY * WIDTH + x) * 4;
        const alpha = (layer[index + 3] / 255) * opacity;
        if (alpha <= 0.002) continue;
        const inverse = 1 - alpha;
        pixels[index] = Math.round(pixels[index] * inverse + layer[index] * alpha);
        pixels[index + 1] = Math.round(pixels[index + 1] * inverse + layer[index + 1] * alpha);
        pixels[index + 2] = Math.round(pixels[index + 2] * inverse + layer[index + 2] * alpha);
      }
    }
  }

  function frame(tick = 0, time = now()) {
    try {
      const pixels = (base ?? blank).slice();
      const stateProgress = clamp((time - stateTransitionStartedAt) / UI_TOKENS.transitionMs, 0, 1);
      if (previousBase && stateProgress < 1) {
        const old = previousBase;
        const oldWeight = 1 - stateProgress;
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = Math.round(pixels[i] * stateProgress + old[i] * oldWeight);
          pixels[i + 1] = Math.round(pixels[i + 1] * stateProgress + old[i + 1] * oldWeight);
          pixels[i + 2] = Math.round(pixels[i + 2] * stateProgress + old[i + 2] * oldWeight);
        }
      } else if (previousBase) {
        previousBase = null;
      }

      const panelProgress = clamp((time - panelTransitionStartedAt) / UI_TOKENS.transitionMs, 0, 1);
      if (previousPanel && panelProgress < 1) {
        compositePanel(pixels, previousPanel, 1 - panelProgress, 0);
        compositePanel(pixels, panel, panelProgress, (1 - panelProgress) * 14 * SAFE_SCALE);
      } else {
        if (previousPanel) previousPanel = null;
        compositePanel(pixels, panel, 1, 0);
      }

      const state = store.getState();
      orb(pixels, {
        state: state.agentState,
        fromState: stateFrom,
        transition: stateProgress,
        outputLevel: state.outputLevel,
        micLevel: state.micLevel,
        time,
        tick,
      });
      return pixels;
    } catch (error) {
      safeLog(`[agent] video frame render failed: ${error?.message ?? 'unknown error'}`);
      return blank.slice();
    }
  }

  return Object.freeze({
    show(value) {
      const event = panelEventFromDisplay(value);
      return event ? store.dispatchPanelEvent(event) : false;
    },
    setState(next) {
      return store.setAgentState(next);
    },
    setOutputLevel(level) {
      return store.setOutputLevel(level);
    },
    setMicLevel(level) {
      return store.setMicLevel(level);
    },
    dispatchPanelEvent(event) {
      return store.dispatchPanelEvent(event);
    },
    getState: store.getState,
    frame,
    flush: () => Promise.allSettled([...pending]),
    close: () => store.close(),
  });
}
