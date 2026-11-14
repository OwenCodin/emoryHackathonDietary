import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeActions, makeFakeRenal } from './fake-modules.mjs';
import { toolLogLine } from './toollog.mjs';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('network used'); };

let tools;
before(async () => { tools = await import('./tools.mjs'); });
after(() => { globalThis.fetch = originalFetch; });

const PHONE = '+15555550100';
const LINK = `https://relay.example/k/${'A'.repeat(43)}`;
const STATUS = (over = {}) => ({ ok: true, configured: true, relay: true, connected: false, pending: false, ...over });

function setup({ status = STATUS(), start, send, build = {}, cart } = {}) {
  const clock = { t: 1_000_000 };
  const calls = { start: 0, send: [], startCart: 0 };
  const actions = {
    ...makeFakeActions(),
    async getKrogerStatus() { return typeof status === 'function' ? status() : status; },
    async startKrogerSignIn() { calls.start += 1; return start ? start() : { ok: true, link: LINK }; },
    async sendText(a) { calls.send.push(a); return send ? send(a) : { ok: true }; },
    async startCart(a) { calls.startCart += 1; return cart ? cart(a) : { ok: true }; },
  };
  const t = tools.buildTools({
    camera: null, renal: makeFakeRenal(), actions, debugFrameDir: '', timeoutMs: 2000, cartWaitMs: 0,
    phone: PHONE, now: () => clock.t, ...build,
  });
  return { t, calls, clock, actions };
}

describe('kroger_status', () => {
  it('says Kroger is not set up when not configured', async () => {
    const { t } = setup({ status: STATUS({ configured: false, relay: false }) });
    const r = await t.kroger_status.execute();
    assert.deepEqual(r, { ok: true, connected: false, set_up: false, can_text: false, say: "Kroger shopping isn't set up on this line, so there's nothing to sign in to." });
  });
  it('says connected', async () => {
    const r = await setup({ status: STATUS({ connected: true }) }).t.kroger_status.execute();
    assert.deepEqual(r, { ok: true, connected: true, say: 'Your Kroger account is connected.' });
  });
  it('says still waiting when pending', async () => {
    const r = await setup({ status: STATUS({ pending: true }) }).t.kroger_status.execute();
    assert.deepEqual(r, { ok: true, connected: false, pending: true, can_text: true, say: "I'm still waiting for you to finish signing in to Kroger from the link I texted you." });
  });
  it('offers a link when the relay is set and not connected', async () => {
    const r = await setup().t.kroger_status.execute();
    assert.deepEqual(r, { ok: true, connected: false, can_text: true, say: "Your Kroger account isn't connected yet. I can text you a link to sign in." });
  });
  it('cannot text without a relay', async () => {
    const r = await setup({ status: STATUS({ relay: false }) }).t.kroger_status.execute();
    assert.deepEqual(r, { ok: true, connected: false, can_text: false, say: "Your Kroger account isn't connected yet, and I can't text a sign-in link on this line." });
  });
  it('fails with tool_failed on a bad or missing status', async () => {
    assert.equal((await setup({ status: { ok: false } }).t.kroger_status.execute()).error, 'tool_failed');
    const { t, actions } = setup();
    delete actions.getKrogerStatus;
    assert.equal((await t.kroger_status.execute()).error, 'tool_failed');
    assert.equal((await setup({ status: () => { throw new Error('x'); } }).t.kroger_status.execute()).error, 'tool_failed');
  });
});

describe('text_kroger_sign_in', () => {
  it('needs a phone and does not start a sign-in without one', async () => {
    const { t, calls } = setup({ build: { phone: undefined } });
    const r = await t.text_kroger_sign_in.execute();
    assert.equal(r.error, 'no_phone');
    assert.equal(calls.start, 0);
  });
  it('texts the exact message once to the configured phone and never returns the link', async () => {
    const { t, calls } = setup();
    const r = await t.text_kroger_sign_in.execute();
    assert.deepEqual(r, { ok: true, sent: true, say: "I've texted you a Kroger sign-in link. Tap it and sign in while we keep going." });
    assert.equal(calls.send.length, 1);
    assert.equal(calls.send[0].phone, PHONE);
    assert.equal(calls.send[0].text, `Sign in to Kroger so your renal dietitian can fill your cart: ${LINK} Nothing is ever paid for you.`);
    assert.ok(!JSON.stringify(r).includes(LINK));
  });
  it('sends even when status says connected, so an expired sign-in can be redone', async () => {
    const { t, calls } = setup({ status: STATUS({ connected: true }) });
    assert.equal((await t.text_kroger_sign_in.execute()).ok, true);
    assert.equal(calls.send.length, 1);
  });
  it('refuses a second send within 60 seconds and allows one after', async () => {
    const { t, calls, clock } = setup();
    await t.text_kroger_sign_in.execute();
    const again = await t.text_kroger_sign_in.execute();
    assert.equal(again.error, 'kroger_link_already_sent');
    assert.equal(calls.send.length, 1);
    clock.t += 61_000;
    assert.equal((await t.text_kroger_sign_in.execute()).ok, true);
    assert.equal(calls.send.length, 2);
  });
  it('maps not_configured and no_relay to kroger_not_configured', async () => {
    for (const error of ['not_configured', 'no_relay']) {
      const { t, calls } = setup({ start: () => ({ ok: false, error }) });
      const r = await t.text_kroger_sign_in.execute();
      assert.equal(r.error, 'kroger_not_configured');
      assert.equal(calls.send.length, 0);
    }
  });
  it('maps other start failures and bad links to tool_failed', async () => {
    assert.equal((await setup({ start: () => ({ ok: false, error: 'weird' }) }).t.text_kroger_sign_in.execute()).error, 'tool_failed');
    assert.equal((await setup({ start: () => { throw new Error('x'); } }).t.text_kroger_sign_in.execute()).error, 'tool_failed');
    for (const link of ['http://relay.example/k/x', 'not a url', `https://relay.example/${'a'.repeat(300)}`, undefined]) {
      const { t, calls } = setup({ start: () => ({ ok: true, link }) });
      assert.equal((await t.text_kroger_sign_in.execute()).error, 'tool_failed', String(link));
      assert.equal(calls.send.length, 0);
    }
  });
  it('maps send failures', async () => {
    const refused = setup({ send: () => ({ ok: false, error: 'Chert rejected the message (HTTP 403)' }) });
    assert.equal((await refused.t.text_kroger_sign_in.execute()).error, 'kroger_texting_refused');
    const unknown = setup({ send: () => ({ ok: false, error: 'Texting failed and the outcome is unknown' }) });
    assert.equal((await unknown.t.text_kroger_sign_in.execute()).error, 'kroger_text_unconfirmed');
    assert.equal((await unknown.t.text_kroger_sign_in.execute()).error, 'kroger_link_already_sent'); // mark kept
    const other = setup({ send: () => ({ ok: false, error: 'boom' }) });
    assert.equal((await other.t.text_kroger_sign_in.execute()).error, 'kroger_text_failed');
    other.calls.send.length = 0;
    assert.equal((await other.t.text_kroger_sign_in.execute()).error, 'kroger_text_failed'); // mark cleared, can retry
    assert.equal(other.calls.send.length, 1);
    const thrown = setup({ send: () => { throw new Error('x'); } });
    assert.equal((await thrown.t.text_kroger_sign_in.execute()).error, 'kroger_text_failed');
  });
  it('a guard timeout is unconfirmed', async () => {
    const { t } = setup({ send: () => new Promise(() => {}), build: { timeoutMs: 30 } });
    assert.equal((await t.text_kroger_sign_in.execute()).error, 'kroger_text_unconfirmed');
  });
  it('fixed sentences', () => {
    const { t } = setup();
    assert.ok(t.text_kroger_sign_in);
  });
});

describe('start_cart Kroger pre-check', () => {
  const items = { items: [{ name: 'rice', quantity: '1' }] };
  it('stops when Kroger is configured but not connected', async () => {
    const a = setup({ status: STATUS() });
    const r = await a.t.start_cart.execute(items);
    assert.equal(r.error, 'kroger_not_connected');
    assert.equal(r.say, "Your Kroger account isn't connected yet, so I can't fill your cart. Want me to text you a link to sign in?");
    assert.equal(a.calls.startCart, 0);
    const pending = await setup({ status: STATUS({ pending: true }) }).t.start_cart.execute(items);
    assert.equal(pending.error, 'kroger_sign_in_pending');
    assert.equal(pending.say, "I'm still waiting for you to finish signing in to Kroger. Tap the link I texted you, then ask me again.");
    const noRelay = setup({ status: STATUS({ relay: false }) });
    const r3 = await noRelay.t.start_cart.execute(items);
    assert.equal(r3.error, 'kroger_sign_in_needed');
    assert.equal(r3.say, "Your Kroger account isn't connected yet, and I can't text a sign-in link on this line, so I can't fill your cart.");
    assert.equal(noRelay.calls.startCart, 0);
  });
  it('proceeds when connected, not configured, or the status function is missing', async () => {
    for (const status of [STATUS({ connected: true }), STATUS({ configured: false, relay: false })]) {
      const a = setup({ status });
      assert.equal((await a.t.start_cart.execute(items)).ok, true);
      assert.equal(a.calls.startCart, 1);
    }
    const noFn = setup();
    delete noFn.actions.getKrogerStatus;
    assert.equal((await noFn.t.start_cart.execute(items)).ok, true);
    const bad = setup({ status: { ok: false } });
    assert.equal((await bad.t.start_cart.execute(items)).ok, true);
  });
});

describe('cart_status Kroger failures', () => {
  const failed = step => ({ ...{ ok: true, state: 'failed', step, added: [], missing: [] } });
  it('maps sign-in steps to kroger_not_connected', async () => {
    for (const step of ['Sign in to Kroger first: node --env-file=.env.local actions/kroger-login.mjs', 'Kroger sign-in expired: run the command again']) {
      const { t, actions } = setup();
      actions.getCartStatus = async () => failed(step);
      const r = await t.cart_status.execute();
      assert.equal(r.error, 'kroger_not_connected');
      assert.equal(r.state, 'failed');
      assert.ok(!/node |\.mjs/.test(r.say));
    }
  });
  it('keeps cart_failed for other failures', async () => {
    const { t, actions } = setup();
    actions.getCartStatus = async () => failed('Kroger said no');
    assert.equal((await t.cart_status.execute()).error, 'cart_failed');
  });
});

describe('privacy', () => {
  it('no link, state or phone in results or log lines', async () => {
    const { t } = setup();
    const outs = [await t.kroger_status.execute(), await t.text_kroger_sign_in.execute()];
    const wrapped = outs.map(o => ({ output: JSON.stringify(o) }));
    const text = JSON.stringify(outs) + wrapped.map((w, i) => toolLogLine(['kroger_status', 'text_kroger_sign_in'][i], w)).join('\n');
    assert.ok(!text.includes('relay.example') && !text.includes('A'.repeat(43)) && !text.includes(PHONE.slice(2)));
  });
});
