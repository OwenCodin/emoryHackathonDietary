// Keeps the caller's latest video frame and turns it into a JPEG on request.
// jpeg() returns null (never an old picture) when there is no video, the frame is too old,
// the camera is muted or the track is gone.
import { ParticipantKind, RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';
import sharp from 'sharp';

// Pure freshness rule: a frame is fresh when it is at most maxAgeMs old.
export function isFresh(at, now, maxAgeMs) {
  return typeof at === 'number' && Number.isFinite(at) && now - at <= maxAgeMs;
}

export function watchCaller(room, options = {}) {
  const playground = options.playground ?? process.env.PLAYGROUND === '1';
  const openStream = options.openStream ?? (track => new VideoStream(track));
  const now = options.now ?? (() => Date.now());

  let latest = null; // { frame, at }
  let generation = 0;
  let videoSid = null;
  let muted = false;
  let activeReader = null;

  // Cancelling frees the stream's native handle and stops it queueing frames nobody reads.
  const releaseReader = () => {
    const r = activeReader;
    activeReader = null;
    if (!r) return;
    try { Promise.resolve(r.cancel()).catch(() => {}); } catch { /* already released */ }
    try { r.releaseLock?.(); } catch { /* a read may still be parked */ }
  };

  // Without PLAYGROUND only the Chert bridge is the caller; with it, any non-agent participant.
  const accepts = participant => playground
    ? participant?.kind !== ParticipantKind.AGENT
    : String(participant?.identity ?? '').startsWith('chert-bridge-');

  const start = track => {
    const mine = ++generation;
    releaseReader(); // the previous track's reader, if a second video track replaces it
    let reader;
    try { reader = openStream(track).getReader(); } catch { return; }
    activeReader = reader;
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done || mine !== generation) break;
          if (!muted) latest = { frame: value.frame, at: now() };
        }
      } catch { /* track ended */ }
      if (mine === generation) latest = null;
      else if (activeReader === reader) releaseReader();
      else { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* released */ } }
    })();
  };

  const onSubscribed = (track, publication, participant) => {
    if (track?.kind !== TrackKind.KIND_VIDEO || !accepts(participant)) return;
    videoSid = publication?.sid ?? null;
    muted = publication?.muted === true;
    latest = null;
    console.log(`[agent] camera video from=${participant.identity}`);
    start(track);
  };
  const onUnsubscribed = (track, publication) => {
    if (track?.kind === TrackKind.KIND_VIDEO && publication?.sid === videoSid) {
      generation++;
      releaseReader();
      latest = null;
      videoSid = null;
    }
  };
  const onMuted = publication => {
    if (videoSid !== null && publication?.sid === videoSid) { muted = true; latest = null; }
  };
  const onUnmuted = publication => {
    if (videoSid !== null && publication?.sid === videoSid) muted = false;
  };

  room.on(RoomEvent.TrackSubscribed, onSubscribed);
  room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
  room.on(RoomEvent.TrackMuted, onMuted);
  room.on(RoomEvent.TrackUnmuted, onUnmuted);

  return {
    // A JPEG of what the caller is showing now, or null if there is no fresh frame.
    async jpeg(maxAgeMs = 1500) {
      try {
        if (muted || !latest || !isFresh(latest.at, now(), maxAgeMs)) return null;
        const rgba = latest.frame.convert(VideoBufferType.RGBA);
        return await sharp(Buffer.from(rgba.data), { raw: { width: rgba.width, height: rgba.height, channels: 4 } })
          .jpeg({ quality: 85 }).toBuffer();
      } catch {
        return null;
      }
    },
    close() {
      generation++;
      releaseReader();
      latest = null;
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      room.off(RoomEvent.TrackMuted, onMuted);
      room.off(RoomEvent.TrackUnmuted, onUnmuted);
    },
  };
}
