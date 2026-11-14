import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { createCartController } from './cart.mjs';
import { createKrogerClient } from './kroger.mjs';

const png = await sharp({
  create: {
    width: 4,
    height: 4,
    channels: 3,
    background: '#ffffff',
  },
})
  .png()
  .toBuffer();

function makeBrowser() {
  let currentUrl = 'about:blank';
  const history = [];
  const calls = [];
  const page = {
    url: () => currentUrl,
    goto: async (url) => {
      history.push(currentUrl);
      currentUrl = url;
    },
    goBack: async () => {
      currentUrl = history.pop() ?? 'about:blank';
    },
    screenshot: async () => png,
    mouse: {
      click: async (...args) => { calls.push(['click', ...args]); },
      move: async (...args) => { calls.push(['move', ...args]); },
      wheel: async (...args) => { calls.push(['wheel', ...args]); },
    },
    keyboard: {
      insertText: async () => {},
      press: async (...args) => { calls.push(['press', ...args]); },
    },
    goForward: async () => { calls.push(['goForward']); },
    waitForTimeout: async () => {},
  };
  const context = {
    pages: () => [page],
    newPage: async () => page,
    close: async () => {},
  };
  return { page, context, calls };
}

async function waitForState(controller, expected) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (controller.getCartStatus().state === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(controller.getCartStatus().state, expected);
}

const thought = { type: 'thought', signature: 's' };

function callStep(id, name, args = {}) {
  return { id, type: 'function_call', name, arguments: args };
}

function actionReply(id, ...steps) {
  return { id, status: 'requires_action', steps: [thought, ...steps] };
}

function textReply(id, text) {
  return {
    id,
    status: 'completed',
    steps: [thought, { type: 'model_output', content: [{ type: 'text', text }] }],
  };
}

function createController(replies, overrides = {}) {
  const browser = makeBrowser();
  const requests = [];
  let replyIndex = 0;
  const controller = createCartController({
    openContext: async () => browser.context,
    createAi: () => ({
      interactions: {
        create: async (request) => {
          requests.push(request);
          const reply = replies[replyIndex++];
          return typeof reply === 'function' ? reply(request) : reply;
        },
      },
    }),
    getStoreUrl: () => 'https://www.walmart.com/',
    captureFrame: async () => new Uint8Array(1280 * 720 * 4),
    activateFrame: () => {},
    getKrogerConfig: () => null,
    ...overrides,
  });
  return { controller, browser, requests };
}

const ITEMS = [{ name: 'broth', quantity: '1 carton' }];

async function runToState(replies, state, overrides) {
  const ctx = createController(replies, overrides);
  await ctx.controller.startCart({ items: ITEMS });
  await waitForState(ctx.controller, state);
  return { ...ctx, calls: ctx.browser.calls };
}

test('cart returns quickly and reports a confirmed addition from steps', async () => {
  const { controller, browser, requests } = createController([
    actionReply('interaction-1', callStep('call-1', 'navigate', {
      intent: 'Searching for broth',
      url: 'https://www.walmart.com/search?q=broth',
    })),
    textReply('interaction-2', 'ADDED: Unsalted broth | $3.25'),
  ]);

  assert.deepEqual(await controller.startCart({ items: ITEMS }), { ok: true });
  await waitForState(controller, 'done');

  assert.deepEqual(controller.getCartStatus(), {
    ok: true,
    state: 'done',
    step: 'Cart complete',
    added: [{ name: 'Unsalted broth', price: 3.25 }],
    missing: [],
    total: 3.25,
    cartUrl: 'https://www.walmart.com/search?q=broth',
  });
  assert.equal(browser.page.url(), 'https://www.walmart.com/search?q=broth');
  assert.equal(requests.length, 2);
});

test('step text comes from arguments.intent while the next request is made', async () => {
  let stepSeen;
  const ctx = createController([
    actionReply('interaction-1', callStep('call-1', 'take_screenshot', { intent: 'Looking at the page' })),
    () => {
      stepSeen = ctx.controller.getCartStatus().step;
      return textReply('interaction-2', 'MISSING: x');
    },
  ]);
  await ctx.controller.startCart({ items: ITEMS });
  await waitForState(ctx.controller, 'done');
  assert.equal(stepSeen, 'Looking at the page');
});

test('the follow-up request is a function_result with call_id and previous_interaction_id', async () => {
  const { requests } = await runToState([
    actionReply('interaction-1', callStep('call-1', 'navigate', {
      intent: 'Searching',
      url: 'https://www.walmart.com/search?q=broth',
    })),
    textReply('interaction-2', 'ADDED: Unsalted broth | $3.25'),
  ], 'done');

  const first = requests[0];
  assert.equal(first.previous_interaction_id, undefined);
  assert.equal(first.input[1].type, 'image');

  const second = requests[1];
  assert.equal(second.previous_interaction_id, 'interaction-1');
  assert.equal(second.input.length, 1);
  const result = second.input[0];
  assert.equal(result.type, 'function_result');
  assert.equal(result.call_id, 'call-1');
  assert.equal(result.name, 'navigate');
  const textPart = result.result.find((part) => part.type === 'text');
  assert.deepEqual(JSON.parse(textPart.text), { url: 'https://www.walmart.com/search' });
  const imagePart = result.result.find((part) => part.type === 'image');
  assert.equal(imagePart.mime_type, 'image/png');
  assert.ok(imagePart.data.length > 0);
});

test('a missing result and a completed reply with no text are recorded', async () => {
  const a = await runToState([textReply('i1', 'MISSING: out of stock')], 'done');
  assert.deepEqual(a.controller.getCartStatus().missing, ['broth: out of stock']);

  const b = await runToState([{ id: 'i1', status: 'completed', steps: [thought] }], 'done');
  assert.deepEqual(b.controller.getCartStatus().missing, ['broth: no confirmed result']);
});

test('cart blocks checkout navigation and waits for the patient', async () => {
  const { controller, browser } = await runToState([
    actionReply('interaction-1', callStep('call-1', 'navigate', { url: 'https://www.walmart.com/checkout' })),
  ], 'waiting_for_patient');

  assert.equal(browser.page.url(), 'https://www.walmart.com/');
  assert.match(controller.getCartStatus().step, /checkout/i);
});

test('cart falls back to an Instacart list when the store shows a bot challenge', async () => {
  const browser = makeBrowser();
  browser.page.locator = () => ({
    innerText: async () => "We noticed unusual traffic. Verify you're human.",
  });
  let fallbackItems;
  const controller = createCartController({
    openContext: async () => browser.context,
    createAi: () => {
      throw new Error('Gemini should not run after a bot challenge');
    },
    getStoreUrl: () => 'https://www.kroger.com/',
    captureFrame: async () => new Uint8Array(1280 * 720 * 4),
    activateFrame: () => {},
    createFallbackLink: async ({ items }) => {
      fallbackItems = items;
      return { ok: true, url: 'https://www.instacart.com/store/list/abc' };
    },
  });

  await controller.startCart({ items: [{ name: 'unsalted broth', quantity: '1 carton' }] });
  await waitForState(controller, 'done');

  assert.deepEqual(fallbackItems, [{ name: 'unsalted broth', quantity: '1 carton' }]);
  assert.equal(browser.page.url(), 'https://www.instacart.com/store/list/abc');
  assert.match(controller.getCartStatus().step, /choose a store/);
});

test('cart pauses for model safety confirmation read from arguments', async () => {
  const { controller, calls } = await runToState([
    actionReply('interaction-1', callStep('call-1', 'click', {
      x: 100,
      y: 200,
      safety_decision: { decision: 'require_confirmation', explanation: 'x' },
    })),
  ], 'waiting_for_patient');
  assert.match(controller.getCartStatus().step, /confirm/i);
  assert.equal(calls.filter((c) => c[0] === 'click').length, 0);
});

test('cart reports busy when a second cart starts', async () => {
  let release;
  const browser = makeBrowser();
  const controller = createCartController({
    openContext: async () => browser.context,
    createAi: () => ({
      interactions: {
        create: () => new Promise((resolve) => {
          release = resolve;
        }),
      },
    }),
    getStoreUrl: () => 'https://www.walmart.com/',
    captureFrame: async () => new Uint8Array(1280 * 720 * 4),
    activateFrame: () => {},
  });

  await controller.startCart({ items: ITEMS });
  assert.deepEqual(
    await controller.startCart({ items: [{ name: 'rice', quantity: '1 bag' }] }),
    { ok: false, error: 'busy' },
  );
  await controller.stopCart();
  release?.(textReply('interaction-1', 'MISSING: stopped'));
  await waitForState(controller, 'idle');
});

test('cart can be restarted after failing before browser launch', async () => {
  const controller = createCartController({
    getStoreUrl: () => null,
    openContext: async () => {
      throw new Error('Browser should not open without a store URL');
    },
    activateFrame: () => {},
  });

  assert.deepEqual(await controller.startCart({ items: ITEMS }), { ok: true });
  await waitForState(controller, 'failed');
  assert.deepEqual(await controller.startCart({ items: ITEMS }), { ok: true });
  await waitForState(controller, 'failed');
});

test('cart stops after 60 browser actions', async () => {
  const replies = Array.from({ length: 61 }, (_, index) =>
    actionReply(`interaction-${index}`, callStep(`call-${index}`, 'take_screenshot', {})));
  const { controller } = await runToState(replies, 'failed');
  assert.match(controller.getCartStatus().step, /60 browser actions/);
});

test('cart stops after four minutes', async () => {
  let timeCall = 0;
  const { controller } = await runToState([
    actionReply('interaction-1', callStep('call-1', 'take_screenshot', {})),
  ], 'failed', {
    now: () => (timeCall++ === 0 ? 0 : 4 * 60 * 1000),
  });
  assert.equal(controller.getCartStatus().step, 'Cart stopped after four minutes');
});

test('cart never types phone or payment-like data', async () => {
  const { controller } = await runToState([
    actionReply('interaction-1', callStep('call-1', 'type', { text: '+1 (555) 123-4567' })),
  ], 'failed');
  assert.match(controller.getCartStatus().step, /personal or payment data/i);
});

test('click coordinates are 0-999 normalized to the 1280x720 viewport', async () => {
  const { calls } = await runToState([
    actionReply('i1', callStep('c1', 'click', { x: 500, y: 500 })),
    textReply('i2', 'MISSING: x'),
  ], 'done');
  assert.deepEqual(calls.find((c) => c[0] === 'click'), ['click', 640, 360]);
});

test('out-of-range click coordinates fail the action', async () => {
  const { controller, calls } = await runToState([
    actionReply('i1', callStep('c1', 'click', { x: 1200, y: 10 })),
  ], 'failed');
  assert.match(controller.getCartStatus().step, /Click coordinates are invalid/);
  assert.equal(calls.filter((c) => c[0] === 'click').length, 0);
});

test('scroll uses magnitude_in_pixels, supports horizontal, and clamps', async () => {
  const { calls } = await runToState([
    actionReply('i1', callStep('c1', 'scroll', { x: 500, y: 500, direction: 'down', magnitude_in_pixels: 400 })),
    actionReply('i2', callStep('c2', 'scroll', { direction: 'right', magnitude_in_pixels: 250 })),
    actionReply('i3', callStep('c3', 'scroll', { direction: 'up', magnitude_in_pixels: 99999 })),
    textReply('i4', 'MISSING: x'),
  ], 'done');
  assert.deepEqual(calls.filter((c) => c[0] === 'wheel'), [
    ['wheel', 0, 400],
    ['wheel', 250, 0],
    ['wheel', 0, -1200],
  ]);
  assert.deepEqual(calls.filter((c) => c[0] === 'move')[0], ['move', 640, 360]);
});

test('double click, hotkey and go_forward are supported; unknown actions report back', async () => {
  const { calls, requests, controller } = await runToState([
    actionReply('i1', callStep('c1', 'double_click', { x: 100, y: 100 })),
    actionReply('i2', callStep('c2', 'hotkey', { keys: ['Control', 'a'] })),
    actionReply('i3', callStep('c3', 'go_forward', {})),
    actionReply('i4', callStep('c4', 'drag_and_drop', { start_x: 1, start_y: 1, end_x: 2, end_y: 2 })),
    textReply('i5', 'MISSING: x'),
  ], 'done');
  assert.deepEqual(calls.find((c) => c[0] === 'click'), ['click', 128, 72, { clickCount: 2 }]);
  assert.deepEqual(calls.find((c) => c[0] === 'press'), ['press', 'Control+a']);
  assert.ok(calls.some((c) => c[0] === 'goForward'));
  const last = requests.at(-1).input[0];
  assert.equal(last.call_id, 'c4');
  const text = JSON.parse(last.result.find((part) => part.type === 'text').text);
  assert.equal(text.error, 'unsupported action');
  assert.deepEqual(controller.getCartStatus().missing, ['broth: x']);
});

test('wait defaults to one second and caps long waits instead of failing', async () => {
  const { controller } = await runToState([
    actionReply('i1', callStep('c1', 'wait', { intent: 'Waiting' })),
    textReply('i2', 'MISSING: x'),
  ], 'done');
  assert.equal(controller.getCartStatus().state, 'done');

  const negative = await runToState([
    actionReply('i1', callStep('c1', 'wait', { seconds: -1 })),
  ], 'failed');
  assert.match(negative.controller.getCartStatus().step, /Wait duration is invalid/);
});

test('two function calls in one reply run in order and get two results', async () => {
  const { calls, requests } = await runToState([
    actionReply('i1',
      callStep('c1', 'click', { x: 500, y: 500 }),
      callStep('c2', 'click', { x: 0, y: 0 })),
    textReply('i2', 'MISSING: x'),
  ], 'done');
  assert.deepEqual(calls.filter((c) => c[0] === 'click'), [
    ['click', 640, 360],
    ['click', 0, 0],
  ]);
  assert.deepEqual(requests[1].input.map((part) => part.call_id), ['c1', 'c2']);
  assert.equal(requests[1].previous_interaction_id, 'i1');
});

test('parallel calls all count toward the cap', async () => {
  const many = Array.from({ length: 61 }, (_, i) => callStep(`c${i}`, 'take_screenshot', {}));
  const { controller } = await runToState([actionReply('i1', ...many)], 'failed');
  assert.match(controller.getCartStatus().step, /60 browser actions/);
});

test('a blocked call anywhere in a multi-call reply stops all of them', async () => {
  const intent = await runToState([
    actionReply('i1',
      callStep('c1', 'click', { x: 500, y: 500 }),
      callStep('c2', 'click', { intent: 'Proceed to checkout', x: 1, y: 1 })),
  ], 'waiting_for_patient');
  assert.match(intent.controller.getCartStatus().step, /blocked/i);
  assert.equal(intent.calls.filter((c) => c[0] === 'click').length, 0);

  const safety = await runToState([
    actionReply('i1',
      callStep('c1', 'click', { x: 500, y: 500 }),
      callStep('c2', 'click', { x: 1, y: 1, safety_decision: { decision: 'blocked' } })),
  ], 'waiting_for_patient');
  assert.equal(safety.calls.filter((c) => c[0] === 'click').length, 0);
});

// ---- Kroger API path ----

const KROGER_CONFIG = { clientId: 'test-client', clientSecret: 'test-secret', locationId: '01100695', tokenDir: '/unused' };
const LOGIN = 'node --env-file=.env.local actions/kroger-login.mjs';

function krogerProduct(upc, description, price) {
  return { upc, description, items: [{ price: { regular: price } }] };
}

const defaultSearch = (term) => ({
  status: 200,
  body: {
    data: term === 'apples'
      ? [krogerProduct('2', 'Honeycrisp Apple', 1.1)]
      : [krogerProduct('1', 'Kroger Salted Butter', 3), krogerProduct('3', 'Kroger® Unsalted Butter Sticks', 3.59)],
  },
});

function makeKrogerController({ stored = { refreshToken: 'test-refresh' }, search = defaultSearch, add, refreshStatus = 200, openContext } = {}) {
  const calls = [];
  let controller;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, body: init.body });
    let status = 200;
    let body = {};
    if (u.pathname === '/v1/connect/oauth2/token') {
      if (new URLSearchParams(String(init.body)).get('grant_type') === 'refresh_token') status = refreshStatus;
      body = { access_token: 'test-user-access', expires_in: 1800 };
    } else if (u.pathname === '/v1/products') {
      ({ status, body } = search(u.searchParams.get('filter.term')));
    } else if (u.pathname === '/v1/cart/add') {
      ({ status, body = null } = add?.(JSON.parse(init.body), controller) ?? { status: 204 });
    } else {
      throw new Error(`unexpected ${u.pathname}`);
    }
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  controller = createCartController({
    openContext: openContext ?? (async () => { throw new Error('browser must not open'); }),
    getKrogerConfig: () => KROGER_CONFIG,
    createKroger: (config) => createKrogerClient({
      ...config,
      tokenStore: { load: async () => stored, save: async () => ({ ok: true }) },
      fetchImpl,
    }),
  });
  return { controller, calls };
}

test('browser path is used when there is no Kroger config', async () => {
  let opened = false;
  const ctx = createController([textReply('i', 'MISSING: x')], {
    openContext: async () => { opened = true; return makeBrowser().context; },
  });
  await ctx.controller.startCart({ items: ITEMS });
  await waitForState(ctx.controller, 'done');
  assert.equal(opened, true);
});

test('kroger API path fills the cart without a browser', async () => {
  const { controller, calls } = makeKrogerController();
  assert.deepEqual(await controller.startCart({
    items: [{ name: 'unsalted butter', quantity: '2' }, { name: 'apples', quantity: '3 apples' }],
  }), { ok: true });
  await waitForState(controller, 'done');
  assert.deepEqual(controller.getCartStatus(), {
    ok: true,
    state: 'done',
    step: 'Kroger cart updated',
    added: [
      { name: 'Kroger® Unsalted Butter Sticks', price: 7.18 },
      { name: 'Honeycrisp Apple', price: 3.3 },
    ],
    missing: [],
    total: 10.48,
    cartUrl: 'https://www.kroger.com/cart',
  });
  const adds = calls.filter((c) => c.path === '/v1/cart/add').map((c) => JSON.parse(c.body).items[0]);
  assert.deepEqual(adds.map((a) => a.quantity), [2, 3]);
});

test('kroger path reports missing items and keeps going', async () => {
  const { controller } = makeKrogerController({
    search: (term) => term === 'apples'
      ? { status: 200, body: { data: [] } }
      : term === 'rice'
        ? { status: 500, body: {} }
        : { status: 200, body: { data: [krogerProduct('1', 'Plain Broth', 2)] } },
    add: () => ({ status: 500 }),
  });
  await controller.startCart({ items: [
    { name: 'apples', quantity: '1' },
    { name: 'rice', quantity: '1' },
    { name: 'broth', quantity: '1' },
  ] });
  await waitForState(controller, 'done');
  const s = controller.getCartStatus();
  assert.deepEqual(s.missing, [
    'apples: no matching product at the store',
    'rice: product search failed (http_500)',
    'broth: Kroger did not accept the item (http_500)',
  ]);
  assert.equal(s.step, 'No items could be added to the Kroger cart');
  assert.equal(s.cartUrl, null);
});

test('kroger path with no stored sign-in fails with the login command', async () => {
  const { controller, calls } = makeKrogerController({ stored: null });
  await controller.startCart({ items: ITEMS });
  await waitForState(controller, 'failed');
  assert.equal(controller.getCartStatus().step, `Sign in to Kroger first: ${LOGIN}`);
  assert.equal(calls.length, 0);
});

test('kroger refresh rejected fails with the expired message', async () => {
  const { controller, calls } = makeKrogerController({ refreshStatus: 401 });
  await controller.startCart({ items: ITEMS });
  await waitForState(controller, 'failed');
  assert.equal(controller.getCartStatus().step, `Kroger sign-in expired: run ${LOGIN} again`);
  assert.equal(calls.some((c) => c.path === '/v1/products'), false);
});

test('kroger 401 mid-run keeps earlier items', async () => {
  let adds = 0;
  const { controller } = makeKrogerController({
    add: () => (++adds === 1 ? { status: 204 } : { status: 401 }),
  });
  await controller.startCart({ items: [
    { name: 'unsalted butter', quantity: '1' },
    { name: 'apples', quantity: '1' },
  ] });
  await waitForState(controller, 'failed');
  const s = controller.getCartStatus();
  assert.equal(s.step, `Kroger sign-in expired: run ${LOGIN} again`);
  assert.deepEqual(s.added, [{ name: 'Kroger® Unsalted Butter Sticks', price: 3.59 }]);
  assert.equal(s.total, 3.59);
  assert.ok(!JSON.stringify(s).includes('test-user-access'));
});

test('stopCart during the kroger run goes idle with no further requests', async () => {
  let stopper;
  const { controller, calls } = makeKrogerController({
    add: (body, c) => { stopper = c.stopCart(); return { status: 204 }; },
  });
  await controller.startCart({ items: [
    { name: 'unsalted butter', quantity: '1' },
    { name: 'apples', quantity: '1' },
  ] });
  await waitForState(controller, 'idle');
  await stopper;
  assert.equal(controller.getCartStatus().step, 'Cart stopped');
  assert.equal(calls.filter((c) => c.path === '/v1/cart/add').length, 1);
});

