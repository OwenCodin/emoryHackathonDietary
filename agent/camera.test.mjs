import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import sharp from 'sharp';
import { ParticipantKind, RoomEvent, TrackKind } from '@livekit/rtc-node';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('network used'); };

let camera;
before(async () => { camera = await import('./camera.mjs'); });
after(() => { globalThis.fetch = originalFetch; });

const tick = () => new Promise(r => setTimeout(r, 15));
const video = { kind: TrackKind.KIND_VIDEO, sid: 'TR_v' };
const pub = (over = {}) => ({ sid: 'TR_v', kind: TrackKind.KIND_VIDEO, muted: false, ...over });
const who = (identity, kind = ParticipantKind.STANDARD) => ({ identity, kind });

// A stream the test feeds by hand.
function feed(convert) {
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; } });
  const frame = { width: 4, height: 2, convert: convert ?? (() => ({ width: 4, height: 2, data: new Uint8Array(32).fill(200) })) };
  return { stream, push: async () => { controller.enqueue({ frame }); await tick(); } };
}

function setup({ playground = false } = {}) {
  const room = new EventEmitter();
  const clock = { t: 10000 };
  const f = feed();
  const cam = camera.watchCaller(room, { playground, openStream: () => f.stream, now: () => clock.t });
  return { room, clock, f, cam };
}

describe('isFresh', () => {
  it('uses age <= limit', () => {
    assert.equal(camera.isFresh(1000, 2000, 1500), true);
    assert.equal(camera.isFresh(1000, 2500, 1500), true);
    assert.equal(camera.isFresh(1000, 2501, 1500), false);
    assert.equal(camera.isFresh(null, 2000, 1500), false);
    assert.equal(camera.isFresh(undefined, 2000, 1500), false);
  });
});

describe('watchCaller', () => {
  it('returns null with no track', async () => {
    const { cam } = setup();
    assert.equal(await cam.jpeg(), null);
  });

  it('gives a jpeg from a caller frame', async () => {
    const { room, f, cam } = setup();
    room.emit(RoomEvent.TrackSubscribed, video, pub(), who('chert-bridge-test'));
    await f.push();
    const buf = await cam.jpeg();
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xd8);
    const meta = await sharp(buf).metadata();
    assert.equal(meta.format, 'jpeg');
    assert.equal(meta.width, 4);
    assert.equal(meta.height, 2);
  });

  it('returns null when the frame is stale, unless a longer age is allowed', async () => {
    const { room, clock, f, cam } = setup();
    room.emit(RoomEvent.TrackSubscribed, video, pub(), who('chert-bridge-test'));
    await f.push();
    clock.t += 1501;
    assert.equal(await cam.jpeg(), null);
    assert.ok(Buffer.isBuffer(await cam.jpeg(5000)));
  });

  it('returns null after mute and works again after unmute with a new frame', async () => {
    const { room, f, cam } = setup();
    room.emit(RoomEvent.TrackSubscribed, video, pub(), who('chert-bridge-test'));
    await f.push();
    room.emit(RoomEvent.TrackMuted, pub({ muted: true }), who('chert-bridge-test'));
    assert.equal(await cam.jpeg(), null);
    await f.push(); // frames arriving while muted must not be served
    assert.equal(await cam.jpeg(), null);
    room.emit(RoomEvent.TrackUnmuted, pub(), who('chert-bridge-test'));
    await f.push();
    assert.ok(Buffer.isBuffer(await cam.jpeg()));
  });

  it('returns null after unsubscribe', async () => {
    const { room, f, cam } = setup();
    room.emit(RoomEvent.TrackSubscribed, video, pub(), who('chert-bridge-test'));
    await f.push();
    room.emit(RoomEvent.TrackUnsubscribed, video, pub(), who('chert-bridge-test'));
    assert.equal(await cam.jpeg(), null);
  });

  it('ignores other identities without playground', async () => {
    const { room, f, cam } = setup({ playground: false });
    room.emit(RoomEvent.TrackSubscribed, video, pub(), who('someone-else'));
    await f.push();
    assert.equal(await cam.jpeg(), null);
  });

  it('accepts any non-agent with playground, never an agent', async () => {
    const a = setup({ playground: true });
    a.room.emit(RoomEvent.TrackSubscribed, video, pub(), who('someone-else'));
    await a.f.push();
    assert.ok(Buffer.isBuffer(await a.cam.jpeg()));
    const b = setup({ playground: true });
    b.room.emit(RoomEvent.TrackSubscribed, video, pub(), who('agent-x', ParticipantKind.AGENT));
    await b.f.push();
    assert.equal(await b.cam.jpeg(), null);
  });

  it('ignores audio tracks', async () => {
    const { room, f, cam } = setup();
    room.emit(RoomEvent.TrackSubscribed, { kind: TrackKind.KIND_AUDIO, sid: 'TR_a' }, pub({ sid: 'TR_a', kind: TrackKind.KIND_AUDIO }), who('chert-bridge-test'));
    await f.push();
    assert.equal(await cam.jpeg(), null);
  });

  it('never throws when convert fails', async () => {
    const room = new EventEmitter();
    const f = feed(() => { throw new Error('bad frame'); });
    const cam = camera.watchCaller(room, { playground: false, openStream: () => f.stream, now: () => 10000 });
    room.emit(RoomEvent.TrackSubscribed, video, pub(), who('chert-bridge-test'));
    await f.push();
    assert.equal(await cam.jpeg(), null);
  });
});
