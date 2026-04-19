// MANA FIGHT — simple P2P multiplayer via trystero. No backend.
//
// Strategy: full-mesh WebRTC with public BitTorrent-tracker signaling.
// One shared "public" room for v1 (anyone who opens Range joins together).
// Each client is authoritative for its own state; broadcasts are purely
// visual for peers (see-each-other-run-and-cast, no PvP damage yet).

// Uses Nostr public relays for signaling (no backend).
import { joinRoom } from 'trystero';

const APP_ID = 'mana-fight-v1';
const ROOM_NAME = 'public';
const STATE_HZ = 20;          // position/yaw broadcast rate
const STATE_PERIOD = 1000 / STATE_HZ;

let room = null;
let sendState = null;
let sendEvent = null;
let myId = null;
let lastStateSent = 0;

// Handlers (set by the caller in init).
let onPeerJoinHandler = null;
let onPeerLeaveHandler = null;
let onPeerStateHandler = null;
let onPeerEventHandler = null;

export const multi = {
  get id() { return myId; },
  get peerCount() { return room ? Object.keys(room.getPeers()).length : 0; },
  get connected() { return !!room; },
};

// Fire-and-forget init — returns a promise that resolves once the room joins.
export function initMultiplayer({ onPeerJoin, onPeerLeave, onPeerState, onPeerEvent } = {}) {
  onPeerJoinHandler = onPeerJoin;
  onPeerLeaveHandler = onPeerLeave;
  onPeerStateHandler = onPeerState;
  onPeerEventHandler = onPeerEvent;

  try {
    room = joinRoom({ appId: APP_ID }, ROOM_NAME);
    myId = room.selfId || cryptoRandomId();

    // Two action channels: high-frequency state, and one-off events.
    const [sState, rState] = room.makeAction('state');
    const [sEvent, rEvent] = room.makeAction('evt');
    sendState = sState;
    sendEvent = sEvent;

    rState((data, peerId) => onPeerStateHandler?.(peerId, data));
    rEvent((data, peerId) => onPeerEventHandler?.(peerId, data));

    room.onPeerJoin((peerId) => onPeerJoinHandler?.(peerId));
    room.onPeerLeave((peerId) => onPeerLeaveHandler?.(peerId));

    return true;
  } catch (err) {
    console.warn('[multi] failed to join room:', err?.message || err);
    room = null;
    return false;
  }
}

// Throttled self-state broadcast — call every frame; only actually sends at STATE_HZ.
export function broadcastState(payload) {
  if (!sendState) return;
  const now = performance.now();
  if (now - lastStateSent < STATE_PERIOD) return;
  lastStateSent = now;
  sendState(payload);
}

// One-off events: spell cast, melee swing, death, etc.
export function broadcastEvent(type, data) {
  if (!sendEvent) return;
  sendEvent({ type, ...data, t: performance.now() });
}

export function leaveRoom() {
  if (!room) return;
  try { room.leave(); } catch {}
  room = null;
  sendState = null;
  sendEvent = null;
}

function cryptoRandomId() {
  const bytes = new Uint8Array(8);
  (crypto || window.crypto).getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
