import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isAllowedStoreUrl,
  isCheckoutUrl,
} from './store.mjs';

test('store navigation allows only HTTPS grocery retailer hosts', () => {
  assert.equal(isAllowedStoreUrl('https://www.walmart.com/'), true);
  assert.equal(isAllowedStoreUrl('https://www.kroger.com/'), true);
  assert.equal(isAllowedStoreUrl('https://www.instacart.com/'), true);
  assert.equal(isAllowedStoreUrl('https://www.amazon.com/fresh'), true);
  assert.equal(isAllowedStoreUrl('http://www.walmart.com/'), false);
  assert.equal(isAllowedStoreUrl('https://user:pass@www.walmart.com/'), false);
  assert.equal(isAllowedStoreUrl('https://www.walmart.com/?session_token=secret'), false);
  assert.equal(isAllowedStoreUrl('https://walmart.com.attacker.test/'), false);
  assert.equal(isAllowedStoreUrl('https://example.com/'), false);
});

test('checkout detection covers both checkout and payment paths', () => {
  assert.equal(isCheckoutUrl('https://www.walmart.com/checkout'), true);
  assert.equal(isCheckoutUrl('https://www.kroger.com/payment/options'), true);
  assert.equal(isCheckoutUrl('https://www.kroger.com/cart?next=checkout'), true);
  assert.equal(isCheckoutUrl('https://www.kroger.com/cart'), false);
});
