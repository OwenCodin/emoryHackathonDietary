import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInstacartLink } from './instacart.mjs';

test('Instacart fallback returns a validated shopping list URL', async () => {
  let request;
  const result = await createInstacartLink({
    apiKey: 'instacart-test-key',
    items: [{ name: 'unsalted broth', quantity: '1 carton' }],
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 201,
        json: async () => ({ products_link_url: 'https://www.instacart.com/store/list/abc' }),
      };
    },
  });

  assert.deepEqual(result, {
    ok: true,
    url: 'https://www.instacart.com/store/list/abc',
  });
  assert.equal(request.options.headers.Authorization, 'Bearer instacart-test-key');
  assert.deepEqual(JSON.parse(request.options.body).line_items, [
    { name: 'unsalted broth', display_text: '1 carton unsalted broth' },
  ]);
});

test('Instacart fallback rejects URLs outside its domain', async () => {
  const result = await createInstacartLink({
    apiKey: 'instacart-test-key',
    items: [{ name: 'rice', quantity: '1 bag' }],
    fetchImpl: async () => ({
      ok: true,
      status: 201,
      json: async () => ({ url: 'https://example.com/checkout' }),
    }),
  });

  assert.deepEqual(result, {
    ok: false,
    error: 'Instacart returned an unsupported shopping-list URL',
  });
});
