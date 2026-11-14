import { randomUUID } from 'node:crypto';
import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from 'livekit-server-sdk';

const API_BASE = 'https://app.trychert.com/api/v1';

function getSettings(phone, reason) {
  const settings = {
    apiKey: process.env.CHERT_API_KEY,
    projectId: process.env.CHERT_PROJECT_ID,
    lineId: process.env.CHERT_LINE_ID,
    patientPhone: process.env.PATIENT_PHONE,
    livekitUrl: process.env.LIVEKIT_URL,
    livekitApiKey: process.env.LIVEKIT_API_KEY,
    livekitApiSecret: process.env.LIVEKIT_API_SECRET,
    agentName: process.env.AGENT_NAME,
  };
  if (Object.values(settings).some((value) => !value)) {
    return { error: 'Chert or LiveKit call configuration is incomplete' };
  }
  if (!settings.apiKey.startsWith('ftk_')) {
    return { error: 'CHERT_API_KEY is not a project API key' };
  }
  if (!/^\+[1-9]\d{7,14}$/.test(settings.patientPhone) || phone !== settings.patientPhone) {
    return { error: 'Recipient must be the configured verified patient number' };
  }
  if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 500) {
    return { error: 'Call reason must contain 1 to 500 characters' };
  }

  try {
    const url = new URL(settings.livekitUrl);
    if (url.protocol !== 'wss:' || !settings.livekitApiKey || !settings.livekitApiSecret) {
      return { error: 'LIVEKIT_URL and credentials are invalid' };
    }
    settings.livekitHost = `https://${url.host}`;
  } catch {
    return { error: 'LIVEKIT_URL and credentials are invalid' };
  }

  return { settings };
}

function headers(settings, idempotencyKey) {
  return {
    Authorization: `Bearer ${settings.apiKey}`,
    'X-Chert-Project-Id': settings.projectId,
    'Idempotency-Key': idempotencyKey,
    'Content-Type': 'application/json',
  };
}

function isAudioTrack(track) {
  return track.type === 0 || track.type === 'audio' || track.type === 'AUDIO';
}

function getCallId(body) {
  return body.id ?? body.data?.id ?? body.call?.id ?? null;
}

function hasBridgeReady(body) {
  const events = body?.events ?? body?.data?.events ?? body?.data ?? [];
  return Array.isArray(events) && events.some((event) =>
    [event?.type, event?.name, event?.event]
      .some((value) => typeof value === 'string' && value.endsWith('bridge_ready'))
  );
}

function isTerminalCall(body) {
  const terminalStates = new Set([
    'ended',
    'completed',
    'failed',
    'cancelled',
    'no_answer',
    'busy',
  ]);
  const states = [
    body?.state,
    body?.status,
    body?.data?.state,
    body?.data?.status,
    ...(Array.isArray(body?.events ?? body?.data?.events)
      ? (body.events ?? body.data.events).flatMap((event) => [
        event?.type,
        event?.name,
        event?.event,
        event?.status,
      ])
      : []),
  ];
  return states.some((state) => {
    if (typeof state !== 'string') return false;
    const normalized = state.toLowerCase();
    return [...terminalStates].some(
      (terminalState) => normalized === terminalState || normalized.endsWith(`.${terminalState}`),
    );
  });
}

export function createPatientCaller({
  fetchImpl = fetch,
  createKey = randomUUID,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  createLiveKit = (host, apiKey, apiSecret) => ({
    rooms: new RoomServiceClient(host, apiKey, apiSecret),
    dispatch: new AgentDispatchClient(host, apiKey, apiSecret),
    accessToken: (identity) => new AccessToken(apiKey, apiSecret, {
      identity,
      ttl: '30m',
    }),
  }),
  logError = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  let activeCall = false;

  async function cleanup(rooms, room) {
    if (!rooms || !room) return;
    try {
      await rooms.deleteRoom(room);
    } catch {
      logError('Could not clean up the outbound LiveKit room');
    }
  }

  async function monitorCall({ fetchImpl: request, settings, rooms, room, callId }) {
    const noAnswerDeadline = now() + 45_000;
    const callDeadline = now() + 5 * 60_000;
    let bridgeReady = false;
    let terminal = false;
    while (now() < (bridgeReady ? callDeadline : noAnswerDeadline)) {
      await sleep(1000);
      let response;
      let body;
      try {
        response = await request(`${API_BASE}/calls/${encodeURIComponent(callId)}/events`, {
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            'X-Chert-Project-Id': settings.projectId,
          },
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) continue;
        body = await response.json();
      } catch {
        continue;
      }

      if (!bridgeReady && hasBridgeReady(body)) {
        try {
          await rooms.updateRoomMetadata(room, JSON.stringify({
            chert_call: callId,
            chert_bridge_ready: true,
            at: new Date().toISOString(),
          }));
          bridgeReady = true;
        } catch {
          logError('Could not publish the Chert bridge-ready signal');
        }
      }
      if (isTerminalCall(body)) {
        terminal = true;
        break;
      }
    }

    if (!terminal || !bridgeReady) {
      try {
        const response = await request(`${API_BASE}/calls/${encodeURIComponent(callId)}/end`, {
          method: 'POST',
          headers: headers(settings, `end-${createKey()}`),
          body: JSON.stringify({}),
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          logError(`Could not end the outbound Chert call (HTTP ${response.status})`);
        }
      } catch {
        logError('Could not end the outbound Chert call');
      } finally {
        await cleanup(rooms, room);
      }
      return;
    }

    await cleanup(rooms, room);
  }

  async function callPatient({ phone, reason } = {}) {
    const { settings, error } = getSettings(phone, reason);
    if (error) return { ok: false, error };
    if (activeCall) return { ok: false, error: 'busy' };
    activeCall = true;

    const idempotencyKey = `call-${createKey()}`;
    const room = `outbound-${createKey()}`;
    const bridgeIdentity = `chert-bridge-out-${createKey()}`;
    let clients;
    let callAccepted = false;
    let monitorOwnsLock = false;

    try {
      clients = createLiveKit(
        settings.livekitHost,
        settings.livekitApiKey,
        settings.livekitApiSecret,
      );
      const { rooms, dispatch } = clients;
      await rooms.createRoom({ name: room, emptyTimeout: 300 });
      await dispatch.createDispatch(room, settings.agentName, {
        metadata: JSON.stringify({ outbound: true, reason, bridgeIdentity }),
      });

      let agentParticipant = null;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        const participants = await rooms.listParticipants(room);
        agentParticipant = participants.find((participant) =>
          participant.identity !== bridgeIdentity &&
          participant.tracks?.some((track) => isAudioTrack(track) && !track.muted)
        );
        if (agentParticipant) break;
        await sleep(1000);
      }
      if (!agentParticipant) {
        await cleanup(rooms, room);
        return { ok: false, error: 'LiveKit agent did not publish audio within 15 seconds' };
      }

      const token = clients.accessToken(bridgeIdentity);
      token.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
      });
      const participantToken = await token.toJwt();
      const requestBody = JSON.stringify({
        direction: 'outbound',
        mode: 'customer_managed',
        line_id: settings.lineId,
        destination: phone,
        destination_type: 'phone',
        media: { audio: true, video: true },
        livekit_url: settings.livekitUrl,
        participant_token: participantToken,
        remote_participant_identity: agentParticipant.identity,
      });

      let response;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          response = await fetchImpl(`${API_BASE}/calls`, {
            method: 'POST',
            headers: headers(settings, idempotencyKey),
            body: requestBody,
            signal: AbortSignal.timeout(20_000),
          });
          if (response.status < 500) break;
        } catch {
          if (attempt === 1) {
            await cleanup(rooms, room);
            return { ok: false, error: 'Call outcome is unknown; inspect Chert before retrying' };
          }
        }
      }

      if (!response?.ok) {
        await cleanup(rooms, room);
        return { ok: false, error: `Chert rejected the call (HTTP ${response?.status ?? 'unknown'})` };
      }
      const body = await response.json();
      const callId = getCallId(body);
      if (typeof callId !== 'string' || callId.length === 0) {
        await cleanup(rooms, room);
        return { ok: false, error: 'Chert accepted no identifiable call' };
      }

      callAccepted = true;
      monitorOwnsLock = true;
      void monitorCall({
        fetchImpl,
        settings,
        rooms,
        room,
        callId,
      }).catch(() => {
        logError('Outbound call monitoring failed; inspect Chert and LiveKit status');
        return cleanup(rooms, room);
      }).finally(() => {
        activeCall = false;
      });
      return { ok: true, callId };
    } catch (caught) {
      if (clients?.rooms && !callAccepted) await cleanup(clients.rooms, room);
      return {
        ok: false,
        error: caught instanceof Error ? caught.message : 'Could not start outbound call',
      };
    } finally {
      if (!monitorOwnsLock) activeCall = false;
    }
  }

  return { callPatient };
}

const caller = createPatientCaller();
export const callPatient = (input) => caller.callPatient(input);
