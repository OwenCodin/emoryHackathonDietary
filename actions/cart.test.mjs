import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { createCartController } from './cart.mjs';

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
      click: async () => {},
      move: async () => {},
      wheel: async () => {},
    },
    keyboard: {
      insertText: async () => {},
      press: async () => {},
    },
    waitForTimeout: async () => {},
  };
  const context = {
    pages: () => [page],
    newPage: async () => page,
    close: async () => {},
  };
  return { page, context };
}

async function waitForState(controller, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (controller.getCartStatus().state === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(controller.getCartStatus().state, expected);
}

function createController(outputs, overrides = {}) {
  const browser = makeBrowser();
  let outputIndex = 0;
  const controller = createCartController({
    openContext: async () => browser.context,
    createAi: () => ({
      interactions: {
        create: async () => outputs[outputIndex++],
      },
    }),
    getStoreUrl: () => 'https://www.walmart.com/',
    captureFrame: async () => new Uint8Array(1280 * 720 * 4),
    activateFrame: () => {},
    ...overrides,
  });
  return { controller, browser };
}

test('cart returns quickly and reports a confirmed addition', async () => {
  const { controller, browser } = createController([
    {
      id: 'interaction-1',
      outputs: [{
        type: 'function_call',
        id: 'call-1',
        name: 'navigate',
        intent: 'Searching for the requested item',
        arguments: { url: 'https://www.walmart.com/search?q=broth' },
      }],
    },
    {
      id: 'interaction-2',
      outputs: [{
        type: 'model_output',
        content: [{ type: 'text', text: 'ADDED: Unsalted broth | $3.25' }],
      }],
    },
  ]);

  assert.deepEqual(
    await controller.startCart({ items: [{ name: 'broth', quantity: '1 carton' }] }),
    { ok: true },
  );
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
});

test('cart blocks checkout navigation and waits for the patient', async () => {
  const { controller, browser } = createController([
    {
      id: 'interaction-1',
      outputs: [{
        type: 'function_call',
        id: 'call-1',
        name: 'navigate',
        arguments: { url: 'https://www.walmart.com/checkout' },
      }],
    },
  ]);

  await controller.startCart({ items: [{ name: 'broth', quantity: '1 carton' }] });
  await waitForState(controller, 'waiting_for_patient');

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

test('cart pauses for model safety confirmation', async () => {
  const { controller } = createController([
    {
      id: 'interaction-1',
      outputs: [{
        type: 'function_call',
        id: 'call-1',
        name: 'click',
        safety_decision: 'require_confirmation',
        arguments: { x: 100, y: 200 },
      }],
    },
  ]);

  await controller.startCart({ items: [{ name: 'broth', quantity: '1 carton' }] });
  await waitForState(controller, 'waiting_for_patient');
  assert.match(controller.getCartStatus().step, /confirm/i);
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

  await controller.startCart({ items: [{ name: 'broth', quantity: '1 carton' }] });
  assert.deepEqual(
    await controller.startCart({ items: [{ name: 'rice', quantity: '1 bag' }] }),
    { ok: false, error: 'busy' },
  );
  await controller.stopCart();
  release?.({
    id: 'interaction-1',
    outputs: [{ type: 'model_output', content: [{ type: 'text', text: 'MISSING: stopped' }] }],
  });
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
  const items = [{ name: 'broth', quantity: '1 carton' }];

  assert.deepEqual(await controller.startCart({ items }), { ok: true });
  await waitForState(controller, 'failed');
  assert.deepEqual(await controller.startCart({ items }), { ok: true });
  await waitForState(controller, 'failed');
});

test('cart stops after 60 browser actions', async () => {
  const outputs = Array.from({ length: 61 }, (_, index) => ({
    id: `interaction-${index}`,
    outputs: [{
      type: 'function_call',
      id: `call-${index}`,
      name: 'take_screenshot',
      arguments: {},
    }],
  }));
  const { controller } = createController(outputs);

  await controller.startCart({ items: [{ name: 'broth', quantity: '1 carton' }] });
  await waitForState(controller, 'failed');
  assert.match(controller.getCartStatus().step, /60 browser actions/);
});

test('cart stops after four minutes', async () => {
  let timeCall = 0;
  const { controller } = createController([
    {
      id: 'interaction-1',
      outputs: [{
        type: 'function_call',
        id: 'call-1',
        name: 'take_screenshot',
        arguments: {},
      }],
    },
  ], {
    now: () => (timeCall++ === 0 ? 0 : 4 * 60 * 1000),
  });

  await controller.startCart({ items: [{ name: 'broth', quantity: '1 carton' }] });
  await waitForState(controller, 'failed');
  assert.equal(controller.getCartStatus().step, 'Cart stopped after four minutes');
});

test('cart never types phone or payment-like data', async () => {
  const { controller } = createController([
    {
      id: 'interaction-1',
      outputs: [{
        type: 'function_call',
        id: 'call-1',
        name: 'type',
        arguments: { text: '+1 (555) 123-4567' },
      }],
    },
  ]);

  await controller.startCart({ items: [{ name: 'broth', quantity: '1 carton' }] });
  await waitForState(controller, 'failed');
  assert.match(controller.getCartStatus().step, /personal or payment data/i);
});
