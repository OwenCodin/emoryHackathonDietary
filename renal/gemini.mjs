// Call Gemini with a primary model and a hedged fallback model under one overall deadline.
// Never rejects: resolves { ok: true, value, model } or { ok: false, error }.

function shortError(error, fallback) {
  const message = error instanceof Error && error.message ? error.message : fallback;
  return String(message).slice(0, 120) || fallback;
}

export function generateJsonWithFallback({
  ai,
  models,
  buildRequest,
  parse,
  totalMs,
  hedgeMs,
  label = 'request',
}) {
  return new Promise((resolve) => {
    const list = [];
    for (const model of models ?? []) {
      if (typeof model === 'string' && model && !list.includes(model)) list.push(model);
    }
    if (list.length === 0) {
      resolve({ ok: false, error: 'no model configured' });
      return;
    }

    let settled = false;
    let started = 0;
    let failed = 0;
    let lastError = `${label} failed`;
    let hedgeTimer;
    let deadlineTimer;
    const controllers = [];

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      clearTimeout(deadlineTimer);
      for (const controller of controllers) {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }
      resolve(result);
    }

    function startNext() {
      if (settled || started >= list.length) return false;
      const model = list[started];
      started += 1;
      clearTimeout(hedgeTimer);
      const controller = new AbortController();
      controllers.push(controller);
      const request = Promise.resolve().then(() => ai.models.generateContent(buildRequest(model, controller.signal)));
      request.then((response) => {
        let value = null;
        try {
          value = parse(response?.text, response);
        } catch {
          value = null;
        }
        if (value === null || value === undefined) fail('bad model output');
        else finish({ ok: true, value, model });
      }).catch((error) => fail(shortError(error, `${label} failed`)));
      if (started < list.length) hedgeTimer = setTimeout(startNext, hedgeMs);
      return true;
    }

    function fail(message) {
      failed += 1;
      if (settled) return;
      lastError = message;
      if (!startNext() && failed >= started) finish({ ok: false, error: lastError });
    }

    deadlineTimer = setTimeout(() => finish({ ok: false, error: `${label} timed out` }), totalMs);
    startNext();
  });
}
