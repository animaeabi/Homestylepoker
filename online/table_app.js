import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";
import { createOnlinePokerClient } from "./client.js?v=90";
import { describeSevenCardHand, resolveShowdownPayouts } from "./showdown.js";
import { decide as botDecide, thinkTimeMs, randomPersonality, randomBotName, personalityLabel, OpponentTracker } from "./bot_engine.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const online = createOnlinePokerClient(supabase);

const POLL_MS = 1800;
const RUNTIME_TICK_MIN_MS = 1200;
const DEAL_STAGGER_MS = 205;
const DEAL_ANIMATION_MS = 700;
const DEAL_REVEAL_MS = 260;
const DEAL_REVEAL_OFFSET_MS = 120;
const BOARD_REVEAL_STAGGER_MS = 120;
const BOARD_REVEAL_LAND_MS = 520;
const BOARD_REVEAL_FLIP_MS = 420;
const BOARD_REVEAL_FLIP_STAGGER_MS = 80;
const POT_BUMP_MS = 520;
const CHIP_PUSH_MS = 760;
const CHIP_PUSH_STAGGER_MS = 48;
const VOICE_FLOOR_TTL_SECS = 6;
const VOICE_FLOOR_HEARTBEAT_MS = 2500;
const VOICE_HOLD_DELAY_MS = 160;
const VOICE_CLICK_SUPPRESS_MS = 420;
const VOICE_BUSY_TOAST_MS = 2000;
function getTurnClockSecs() { return state.config.turnTime || 25; }
const REALTIME_DEBOUNCE_MS = 180;
const RECONNECT_DEBOUNCE_MS = 900;
const FALLBACK_STALE_MS = 5000;
const LANDSCAPE_COLLAPSE_MEDIA = "(orientation: landscape) and (max-height: 500px)";
const PORTRAIT_COLLAPSE_MEDIA = "(max-width: 768px) and (orientation: portrait)";
const SEAT_COLORS = [
  "#60a5fa","#f87171","#4ade80","#fb923c","#a78bfa",
  "#f472b6","#38bdf8","#fbbf24","#34d399","#e879f9"
];
const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
const SUITS = ["S","H","D","C"];
const FULL_DECK = SUITS.flatMap(s => RANKS.map(r => `${r}${s}`));
const AVATAR_PALETTES = [
  { a: "#5c7cff", b: "#25346f", ring: "#f0c56e" },
  { a: "#00a3a3", b: "#14545d", ring: "#f0c56e" },
  { a: "#d4682d", b: "#6a2811", ring: "#f0c56e" },
  { a: "#a25be7", b: "#442178", ring: "#f0c56e" },
  { a: "#3da85f", b: "#1f5b36", ring: "#f0c56e" },
  { a: "#db5a7f", b: "#5d1f36", ring: "#f0c56e" },
  { a: "#4a89d7", b: "#1c3f73", ring: "#f0c56e" },
  { a: "#f09b3f", b: "#734919", ring: "#f0c56e" },
];
const BOT_AVATAR_RING = "#b194ff";

const TABLE_ADJECTIVES = ["Velvet","Midnight","Golden","Shadow","Royal","Crimson","Silver","Emerald","Diamond","Sapphire"];
const TABLE_NOUNS = ["River","Bluff","Stakes","Aces","Flush","Kings","Edge","Pot","Draw","Jackpot"];

function randomTableName() {
  const adj = TABLE_ADJECTIVES[Math.floor(Math.random() * TABLE_ADJECTIVES.length)];
  const noun = TABLE_NOUNS[Math.floor(Math.random() * TABLE_NOUNS.length)];
  return `${adj} ${noun}`;
}

// ============ DOM REFS ============
const el = {
  lobby: document.getElementById("lobby"),
  lobbyForm: document.getElementById("lobbyForm"),
  lobbyName: document.getElementById("lobbyName"),
  lobbyTableName: document.getElementById("lobbyTableName"),
  lobbySB: document.getElementById("lobbySB"),
  lobbyBB: document.getElementById("lobbyBB"),
  lobbyStack: document.getElementById("lobbyStack"),
  lobbySeats: document.getElementById("lobbySeats"),
  lobbySubmit: document.getElementById("lobbySubmit"),
  lobbyStatus: document.getElementById("lobbyStatus"),
  joinInfo: document.getElementById("joinInfo"),
  joinTableName: document.getElementById("joinTableName"),
  joinTableDetail: document.getElementById("joinTableDetail"),
  createFields: document.getElementById("createFields"),

  tableView: document.getElementById("tableView"),
  topBar: document.getElementById("topBar"),
  landscapeBarToggle: document.getElementById("landscapeBarToggle"),
  tableBootOverlay: document.getElementById("tableBootOverlay"),
  tableBootLabel: document.getElementById("tableBootLabel"),
  tbTitle: document.getElementById("tbTitle"),
  tbBlinds: document.getElementById("tbBlinds"),
  tbPlayers: document.getElementById("tbPlayers"),
  connDot: document.getElementById("connDot"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  removeBotsBtn: document.getElementById("removeBotsBtn"),
  leaveBtn: document.getElementById("leaveBtn"),
  tableSurface: document.getElementById("tableSurface"),
  dealerDeck: document.getElementById("dealerDeck"),
  dealFxLayer: document.getElementById("dealFxLayer"),
  seatsLayer: document.getElementById("seatsLayer"),
  potDisplay: document.getElementById("potDisplay"),
  potStackArt: document.getElementById("potStackArt"),
  potAmount: document.getElementById("potAmount"),
  actionAnnouncement: document.getElementById("actionAnnouncement"),
  actionAnnouncementActor: document.getElementById("actionAnnouncementActor"),
  actionAnnouncementText: document.getElementById("actionAnnouncementText"),
  streetLabel: document.getElementById("streetLabel"),
  boardCards: document.getElementById("boardCards"),
  winReason: document.getElementById("winReason"),
  startHandBtn: document.getElementById("startHandBtn"),
  actionStrip: document.getElementById("actionStrip"),
  presetRow: document.getElementById("presetRow"),
  foldBtn: document.getElementById("foldBtn"),
  callBtn: document.getElementById("callBtn"),
  betRaiseBtn: document.getElementById("betRaiseBtn"),
  allInBtn: document.getElementById("allInBtn"),
  betSlider: document.getElementById("betSlider"),
  betAmount: document.getElementById("betAmount"),
  betSliderQuick: document.getElementById("betSliderQuick"),
  betAmountQuick: document.getElementById("betAmountQuick"),
  presetAmountLabel: document.getElementById("presetAmountLabel"),
  myHandArea: document.getElementById("myHandArea"),
  myHandCards: document.getElementById("myHandCards"),
  myHandNameplate: document.getElementById("myHandNameplate"),
  myHandAvatar: document.querySelector(".my-hand-avatar"),
  hamburgerBtn: document.getElementById("hamburgerBtn"),
  configOverlay: document.getElementById("configOverlay"),
  configBackdrop: document.getElementById("configBackdrop"),
  configClose: document.getElementById("configClose"),
  configPanel: document.getElementById("configPanel"),
  cfgSB: document.getElementById("cfgSB"),
  cfgBB: document.getElementById("cfgBB"),
  cfgTurnTime: document.getElementById("cfgTurnTime"),
  cfgSaveGame: document.getElementById("cfgSaveGame"),
  logToggle: document.getElementById("logToggle"),
  handLog: document.getElementById("handLog"),
  handLogInner: document.getElementById("handLogInner"),
  voiceFab: document.getElementById("voiceFab"),
  voiceFabDot: document.getElementById("voiceFabDot"),
  voiceAudioRack: document.getElementById("voiceAudioRack"),
  chatFab: document.getElementById("chatFab"),
  chatFabBadge: document.getElementById("chatFabBadge"),
  chatPanel: document.getElementById("chatPanel"),
  chatHeader: document.getElementById("chatHeader"),
  chatClose: document.getElementById("chatClose"),
  chatList: document.getElementById("chatList"),
  chatEmpty: document.getElementById("chatEmpty"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  chatSend: document.getElementById("chatSend"),
  toastContainer: document.getElementById("toastContainer"),
};

// ============ STATE ============
const state = {
  identity: null,
  tableId: null,
  tableState: null,
  selectedSeatNo: null,
  logOpen: false,
  loading: false,
  tableBooting: false,
  pendingAction: false,
  pollTimer: null,
  turnTimer: null,
  realtimeChannel: null,
  realtimeHealthy: false,
  rtRefreshTimer: null,
  rtRefreshQueued: false,
  lastSyncAt: 0,
  lastReconnectAt: 0,
  runtimeTickBusy: false,
  runtimeTickLastAt: 0,
  winOverlays: new Map(),
  autoDealTimer: null,
  botSeats: new Map(),
  handLogEntries: [],
  lastLoggedHandId: null,
  lastLoggedSeq: 0,
  config: {
    autoDeal: true,
    showdownTime: 5000,
    turnTime: 25,
    soundOn: true,
    showLog: true,
  },
  botActionTimer: null,
  opponentTracker: new OpponentTracker(),
  lastTrackedEventSeq: 0,
  equityCacheKey: "",
  equityCache: new Map(),
  dealAnimation: null,
  streetRevealAnimation: null,
  potVisual: {
    handId: null,
    chipCount: 0,
    pulseUntil: 0,
  },
  potPushAnimation: null,
  clearedPotHandId: null,
  audioCtx: null,
  actionAnnouncementQueue: [],
  actionAnnouncementHideTimer: null,
  actionAnnouncementNextTimer: null,
  lastAnnouncedActionHandId: null,
  lastAnnouncedActionSeq: 0,
  showdownRevealHandId: null,
  showdownRevealSeats: new Set(),
  voiceCall: null,
  voiceSession: null,
  voiceJoinPromise: null,
  voiceConnected: false,
  voiceJoining: false,
  voiceSpeaking: false,
  voiceBudgetLocked: false,
  voiceUsageMinutes: 0,
  voiceUsageLimit: 9000,
  voiceFloorHeartbeatTimer: null,
  voiceAudioElements: new Map(),
  voicePermissionPrimed: false,
  voicePermissionDenied: false,
  voicePressTimer: null,
  voiceHoldRequested: false,
  voiceSuppressClickUntil: 0,
  lastVoiceBusyToastAt: 0,
  chatOpen: false,
  chatUnread: 0,
  chatMessages: [],
  chatMessageIds: new Set(),
  chatChannel: null,
  chatHealthy: false,
  chatPanelPosition: null,
  chatDrag: {
    active: false,
    pointerId: null,
    offsetX: 0,
    offsetY: 0,
  },
  landscapeTopBarExpanded: true,
  landscapeCompactMode: false,
  compactTopBarMode: null,
  landscapeRaisePanelOpen: false,
};

function getUrlTableId() {
  return new URLSearchParams(window.location.search).get("table") || "";
}

function isJoinMode() {
  return Boolean(getUrlTableId());
}

// ============ IDENTITY ============
function loadIdentity() {
  try {
    const raw = localStorage.getItem("online_lobby_identity");
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function saveIdentity(identity) {
  localStorage.setItem("online_lobby_identity", JSON.stringify(identity));
  state.identity = identity;
}

function seatTokenKey(tableId, playerId) {
  return tableId && playerId ? `online_seat_token:${tableId}:${playerId}` : null;
}

function getSeatToken(tableId = state.tableId, playerId = state.identity?.groupPlayerId) {
  const key = seatTokenKey(tableId, playerId);
  return key ? localStorage.getItem(key) || null : null;
}

function setSeatToken(tableId, playerId, token) {
  const key = seatTokenKey(tableId, playerId);
  if (!key) return;
  if (token) localStorage.setItem(key, token);
  else localStorage.removeItem(key);
}

function isSeatClaimRequiredError(error) {
  return /player_already_seated_claim_required/i.test(String(error?.message || error || ""));
}

function isSeatAutoReclaimMiss(error) {
  return /active_seat_not_found|online_table_not_found|player_not_eligible_for_group/i.test(
    String(error?.message || error || "")
  );
}

// ============ TOAST ============
function toast(message, type = "") {
  const div = document.createElement("div");
  div.className = `toast${type ? ` ${type}` : ""}`;
  div.textContent = message;
  el.toastContainer.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

function resetChatState() {
  state.chatOpen = false;
  state.chatUnread = 0;
  state.chatMessages = [];
  state.chatMessageIds = new Set();
  state.chatPanelPosition = null;
  state.chatDrag.active = false;
  state.chatDrag.pointerId = null;
  if (el.chatInput) el.chatInput.value = "";
  if (el.chatPanel) {
    el.chatPanel.style.left = "";
    el.chatPanel.style.top = "";
    el.chatPanel.style.right = "";
    el.chatPanel.style.bottom = "";
    el.chatPanel.classList.remove("dragging");
  }
}

function resetVoiceState() {
  state.voiceJoinPromise = null;
  state.voiceSession = null;
  state.voiceConnected = false;
  state.voiceJoining = false;
  state.voiceSpeaking = false;
  state.voiceBudgetLocked = false;
  state.voiceUsageMinutes = 0;
  state.voiceUsageLimit = 9000;
  state.voiceHoldRequested = false;
  state.voiceSuppressClickUntil = 0;
  if (state.voicePressTimer) {
    clearTimeout(state.voicePressTimer);
    state.voicePressTimer = null;
  }
  if (state.voiceFloorHeartbeatTimer) {
    clearInterval(state.voiceFloorHeartbeatTimer);
    state.voiceFloorHeartbeatTimer = null;
  }
  if (state.voiceAudioElements?.size) {
    for (const audio of state.voiceAudioElements.values()) {
      try { audio.pause(); } catch {}
      try { audio.srcObject = null; } catch {}
      audio.remove();
    }
    state.voiceAudioElements.clear();
  }
}

function getServerVoiceState() {
  const voice = state.tableState?.voice_state;
  const rawSpeakerId = voice?.speaker_player_id || voice?.speakerPlayerId || null;
  const rawSpeakerName = voice?.speaker_name || voice?.speakerName || "";
  const expiresAt = voice?.floor_expires_at || voice?.floorExpiresAt || null;
  const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const active = Boolean(
    rawSpeakerId &&
    (voice?.is_active === true || voice?.isActive === true || !Number.isFinite(expiresMs) || expiresMs > Date.now())
  );
  return {
    speakerPlayerId: active ? rawSpeakerId : null,
    speakerName: active ? String(rawSpeakerName || seatName(rawSpeakerId)) : "",
    floorExpiresAt: active && Number.isFinite(expiresMs) ? expiresMs : null,
    active,
  };
}

function canUseVoice() {
  const mySeat = getMySeat();
  return Boolean(state.tableId && state.identity && mySeat && !seatLooksBot(mySeat));
}

function getVoiceUiState() {
  const serverVoice = getServerVoiceState();
  if (state.voiceSpeaking) return "speaking";
  if (state.voiceJoining) return "joining";
  if (state.voiceConnected) return serverVoice.active && serverVoice.speakerPlayerId && serverVoice.speakerPlayerId !== state.identity?.groupPlayerId
    ? "busy"
    : "connected";
  if (state.voiceBudgetLocked) return "locked";
  if (serverVoice.active && serverVoice.speakerPlayerId && serverVoice.speakerPlayerId !== state.identity?.groupPlayerId) return "busy";
  if (!canUseVoice()) return "disabled";
  return "idle";
}

function renderVoiceUi() {
  const visible = Boolean(state.tableId && !el.tableView.classList.contains("hidden"));
  const button = el.voiceFab;
  if (!button) return;
  button.classList.toggle("hidden", !visible);
  if (!visible) return;

  const serverVoice = getServerVoiceState();
  const uiState = getVoiceUiState();
  const disabled = uiState === "disabled" || uiState === "locked";
  button.dataset.state = uiState;
  button.disabled = disabled || state.voiceJoining;

  let label = "Hold to talk";
  if (uiState === "speaking") label = "Speaking";
  else if (uiState === "connected") label = "Voice ready — hold to talk";
  else if (uiState === "joining") label = "Joining voice";
  else if (uiState === "busy") label = serverVoice.speakerName ? `${serverVoice.speakerName} is talking` : "Voice busy";
  else if (uiState === "locked") label = "Voice unavailable until next month";
  else if (uiState === "disabled") label = "Take a seat to use voice";

  button.setAttribute("aria-label", label);
  button.title = label;
  button.setAttribute("aria-pressed", state.voiceConnected ? "true" : "false");

  if (el.voiceFabDot) {
    const showDot = uiState === "connected" || uiState === "speaking" || uiState === "busy";
    el.voiceFabDot.classList.toggle("hidden", !showDot);
    el.voiceFabDot.dataset.state = uiState;
  }
}

function ensureDailyIframe() {
  const daily = window.DailyIframe;
  if (!daily || typeof daily.createCallObject !== "function") {
    throw new Error("Voice library failed to load.");
  }
  return daily;
}

function decodeVoiceTokenExpiry(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
    const parsed = JSON.parse(atob(padded));
    const exp = Number(parsed?.exp || 0);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function rememberVoiceSession(session) {
  if (!session?.room_url || !session?.meeting_token) {
    state.voiceSession = null;
    return null;
  }
  state.voiceSession = {
    room_url: session.room_url,
    meeting_token: session.meeting_token,
    usage_minutes: Number(session?.usage_minutes || 0),
    limit_minutes: Number(session?.limit_minutes || 9000),
    usage_estimated: Boolean(session?.usage_estimated),
    expires_at_ms: decodeVoiceTokenExpiry(session.meeting_token),
  };
  return state.voiceSession;
}

function hasReusableVoiceSession() {
  const session = state.voiceSession;
  if (!session?.room_url || !session?.meeting_token) return false;
  if (!session.expires_at_ms) return true;
  return session.expires_at_ms - Date.now() > 15000;
}

async function getVoiceSession({ forceFresh = false } = {}) {
  if (!forceFresh && hasReusableVoiceSession()) return state.voiceSession;
  const session = await online.createVoiceSession({
    tableId: state.tableId,
    actorGroupPlayerId: state.identity.groupPlayerId,
    seatToken: getSeatToken(),
  });
  state.voiceUsageMinutes = Number(session?.usage_minutes || 0);
  state.voiceUsageLimit = Number(session?.limit_minutes || 9000);
  return rememberVoiceSession(session);
}

function clearVoiceAudioRack() {
  if (state.voiceAudioElements?.size) {
    for (const audio of state.voiceAudioElements.values()) {
      try { audio.pause(); } catch {}
      try { audio.srcObject = null; } catch {}
      audio.remove();
    }
    state.voiceAudioElements.clear();
  }
}

function getParticipantAudioTrack(participant) {
  const audio = participant?.tracks?.audio;
  if (!audio) return null;
  return audio.persistentTrack || audio.track || null;
}

function syncVoiceAudioRack() {
  const rack = el.voiceAudioRack;
  const call = state.voiceCall;
  if (!rack || !call || !state.voiceConnected || typeof call.participants !== "function") {
    clearVoiceAudioRack();
    return;
  }

  const participants = call.participants() || {};
  const keep = new Set();

  for (const [participantId, participant] of Object.entries(participants)) {
    if (!participant || participantId === "local" || participant.local) continue;

    const key = String(participant.session_id || participantId);
    const track = getParticipantAudioTrack(participant);
    if (!track) continue;
    keep.add(key);

    let audio = state.voiceAudioElements.get(key);
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      audio.dataset.participantId = key;
      rack.appendChild(audio);
      state.voiceAudioElements.set(key, audio);
    }

    const trackId = String(track.id || "");
    if (audio.dataset.trackId !== trackId) {
      audio.dataset.trackId = trackId;
      audio.srcObject = new MediaStream([track]);
    }

    const playResult = audio.play?.();
    if (playResult && typeof playResult.catch === "function") {
      playResult.catch(() => {});
    }
  }

  for (const [key, audio] of state.voiceAudioElements.entries()) {
    if (keep.has(key)) continue;
    try { audio.pause(); } catch {}
    try { audio.srcObject = null; } catch {}
    audio.remove();
    state.voiceAudioElements.delete(key);
  }
}

async function ensureVoiceCallObject() {
  if (state.voiceCall) return state.voiceCall;
  const daily = ensureDailyIframe();
  const call = daily.createCallObject({
    strictMode: true,
    allowMultipleCallInstances: false,
  });

  call.on("joined-meeting", () => {
    state.voiceConnected = true;
    state.voiceJoining = false;
    syncVoiceAudioRack();
    renderVoiceUi();
  });

  call.on("left-meeting", () => {
    state.voiceConnected = false;
    state.voiceJoining = false;
    state.voiceSpeaking = false;
    if (state.voiceFloorHeartbeatTimer) {
      clearInterval(state.voiceFloorHeartbeatTimer);
      state.voiceFloorHeartbeatTimer = null;
    }
    clearVoiceAudioRack();
    renderVoiceUi();
  });

  call.on("participant-joined", syncVoiceAudioRack);
  call.on("participant-updated", syncVoiceAudioRack);
  call.on("participant-left", syncVoiceAudioRack);
  call.on("track-started", syncVoiceAudioRack);
  call.on("track-stopped", syncVoiceAudioRack);

  call.on("error", (event) => {
    state.voiceJoining = false;
    state.voiceSpeaking = false;
    renderVoiceUi();
    toast(event?.errorMsg || "Voice failed", "error");
  });

  call.on("camera-error", (event) => {
    toast(event?.errorMsg?.errorMsg || event?.errorMsg || "Microphone access failed", "error");
  });

  state.voiceCall = call;
  return call;
}

async function ensureVoiceConnected() {
  if (state.voiceConnected && state.voiceCall) return state.voiceCall;
  if (state.voiceJoinPromise) return state.voiceJoinPromise;
  if (!canUseVoice()) throw new Error("Take a seat to use voice.");
  if (state.voiceBudgetLocked) throw new Error("Voice is unavailable until next month.");

  const seatToken = getSeatToken();
  if (!seatToken) throw new Error("Take a seat to use voice.");

  state.voiceJoining = true;
  renderVoiceUi();
  state.voiceJoinPromise = (async () => {
    const call = await ensureVoiceCallObject();
    let session = await getVoiceSession();
    try {
      await call.join({
        url: session.room_url,
        token: session.meeting_token,
        userName: state.identity?.name || "Player",
        audioSource: true,
        videoSource: false,
        startAudioOff: true,
        startVideoOff: true,
        subscribeToTracksAutomatically: true,
        dailyConfig: { avoidEval: true },
      });
    } catch (error) {
      state.voiceSession = null;
      session = await getVoiceSession({ forceFresh: true });
      await call.join({
        url: session.room_url,
        token: session.meeting_token,
        userName: state.identity?.name || "Player",
        audioSource: true,
        videoSource: false,
        startAudioOff: true,
        startVideoOff: true,
        subscribeToTracksAutomatically: true,
        dailyConfig: { avoidEval: true },
      });
    }
    state.voiceConnected = true;
    syncVoiceAudioRack();
    return call;
  })();

  try {
    return await state.voiceJoinPromise;
  } catch (error) {
    const code = error?.code || error?.details?.code || "";
    if (String(code) === "voice_monthly_limit_reached" || /voice_monthly_limit_reached/i.test(String(error?.message || ""))) {
      state.voiceBudgetLocked = true;
    }
    throw error;
  } finally {
    state.voiceJoinPromise = null;
    state.voiceJoining = false;
    renderVoiceUi();
  }
}

async function requestMicrophonePermissionOnJoin() {
  if (state.voicePermissionPrimed || state.voicePermissionDenied) return;
  if (!window.isSecureContext) return;
  const mediaDevices = navigator.mediaDevices;
  if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") return;

  try {
    const stream = await mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch {}
    }
    state.voicePermissionPrimed = true;
    renderVoiceUi();
  } catch (error) {
    const name = String(error?.name || "");
    if (/NotAllowedError|PermissionDeniedError|SecurityError/i.test(name)) {
      state.voicePermissionDenied = true;
      toast("Microphone access denied. Voice chat will stay off until you allow it.", "error");
    }
  }
}

function clearVoiceFloorHeartbeat() {
  if (state.voiceFloorHeartbeatTimer) {
    clearInterval(state.voiceFloorHeartbeatTimer);
    state.voiceFloorHeartbeatTimer = null;
  }
}

function startVoiceFloorHeartbeat() {
  clearVoiceFloorHeartbeat();
  state.voiceFloorHeartbeatTimer = setInterval(async () => {
    if (!state.voiceSpeaking || !state.tableId || !state.identity) return;
    try {
      const payload = await online.refreshVoiceFloor({
        tableId: state.tableId,
        actorGroupPlayerId: state.identity.groupPlayerId,
        seatToken: getSeatToken(),
        ttlSecs: VOICE_FLOOR_TTL_SECS,
      });
      if (!payload?.granted) {
        await stopPushToTalk({ skipRelease: true, silent: true });
      }
    } catch {
      await stopPushToTalk({ skipRelease: true, silent: true });
    }
  }, VOICE_FLOOR_HEARTBEAT_MS);
}

async function disconnectVoice({ silent = false, destroy = false } = {}) {
  state.voiceHoldRequested = false;
  if (state.voicePressTimer) {
    clearTimeout(state.voicePressTimer);
    state.voicePressTimer = null;
  }
  if (state.voiceSpeaking) {
    await stopPushToTalk({ silent: true });
  } else {
    clearVoiceFloorHeartbeat();
  }
  const call = state.voiceCall;
  if (!call) {
    state.voiceConnected = false;
    state.voiceJoining = false;
    clearVoiceAudioRack();
    renderVoiceUi();
    return;
  }
  try {
    if (state.voiceConnected) {
      await call.leave();
    }
    if (destroy && typeof call.destroy === "function") {
      await call.destroy();
      state.voiceCall = null;
    }
  } catch {
    if (destroy) state.voiceCall = null;
  } finally {
    state.voiceConnected = false;
    state.voiceJoining = false;
    state.voiceSpeaking = false;
    clearVoiceFloorHeartbeat();
    clearVoiceAudioRack();
    renderVoiceUi();
    if (!silent) toast("Voice off", "success");
  }
}

async function startPushToTalk() {
  if (!state.voiceHoldRequested || state.voiceSpeaking) return;
  if (!canUseVoice()) {
    toast("Take a seat to use voice.", "error");
    return;
  }

  const serverVoice = getServerVoiceState();
  if (serverVoice.active && serverVoice.speakerPlayerId && serverVoice.speakerPlayerId !== state.identity?.groupPlayerId) {
    if (Date.now() - state.lastVoiceBusyToastAt > VOICE_BUSY_TOAST_MS) {
      state.lastVoiceBusyToastAt = Date.now();
      toast(serverVoice.speakerName ? `${serverVoice.speakerName} is on the mic` : "Voice is busy right now.");
    }
    renderVoiceUi();
    return;
  }

  try {
    const call = await ensureVoiceConnected();
    if (!state.voiceHoldRequested) {
      renderVoiceUi();
      return;
    }

    const seatToken = getSeatToken();
    const payload = await online.claimVoiceFloor({
      tableId: state.tableId,
      actorGroupPlayerId: state.identity.groupPlayerId,
      seatToken,
      ttlSecs: VOICE_FLOOR_TTL_SECS,
    });

    if (!payload?.granted) {
      if (Date.now() - state.lastVoiceBusyToastAt > VOICE_BUSY_TOAST_MS) {
        state.lastVoiceBusyToastAt = Date.now();
        toast(payload?.speaker_name ? `${payload.speaker_name} is on the mic` : "Voice is busy right now.");
      }
      renderVoiceUi();
      return;
    }

    if (!state.voiceHoldRequested) {
      await online.releaseVoiceFloor({
        tableId: state.tableId,
        actorGroupPlayerId: state.identity.groupPlayerId,
        seatToken,
      });
      renderVoiceUi();
      return;
    }

    call.setLocalAudio(true);
    state.voiceSpeaking = true;
    startVoiceFloorHeartbeat();
    renderVoiceUi();
  } catch (error) {
    if (state.voiceConnected || state.voiceCall) {
      await disconnectVoice({ silent: true, destroy: true });
    }
    toast(error?.message || "Voice failed", "error");
    renderVoiceUi();
  }
}

async function stopPushToTalk({ skipRelease = false, silent = false } = {}) {
  state.voiceHoldRequested = false;
  clearVoiceFloorHeartbeat();
  try {
    state.voiceCall?.setLocalAudio(false);
  } catch {
    // Ignore local audio shutdown issues during teardown.
  }

  if (!skipRelease && state.tableId && state.identity && getSeatToken()) {
    try {
      await online.releaseVoiceFloor({
        tableId: state.tableId,
        actorGroupPlayerId: state.identity.groupPlayerId,
        seatToken: getSeatToken(),
      });
    } catch {
      // Ignore release failures; floor expiry is the backstop.
    }
  }

  state.voiceSpeaking = false;
  renderVoiceUi();
  if (!silent) toast("Mic released");
}

function onVoicePointerDown(event) {
  event.preventDefault();
  event.stopPropagation();
  if (event.pointerType === "mouse" && event.button !== 0) return;
  try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch {}
  if (state.voicePressTimer) clearTimeout(state.voicePressTimer);
  state.voiceHoldRequested = false;
  state.voicePressTimer = setTimeout(() => {
    state.voicePressTimer = null;
    state.voiceHoldRequested = true;
    state.voiceSuppressClickUntil = Date.now() + VOICE_CLICK_SUPPRESS_MS;
    void startPushToTalk();
  }, VOICE_HOLD_DELAY_MS);
}

function onVoicePointerEnd(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  try {
    if (event?.pointerId != null) event.currentTarget?.releasePointerCapture?.(event.pointerId);
  } catch {}
  if (state.voicePressTimer) {
    clearTimeout(state.voicePressTimer);
    state.voicePressTimer = null;
    return;
  }
  if (!state.voiceHoldRequested && !state.voiceSpeaking) return;
  state.voiceHoldRequested = false;
  state.voiceSuppressClickUntil = Date.now() + VOICE_CLICK_SUPPRESS_MS;
  void (async () => {
    if (state.voiceSpeaking) {
      await stopPushToTalk({ silent: true });
    }
  })();
}

async function onVoiceFabClick(event) {
  event.preventDefault();
  event.stopPropagation();
  if (Date.now() < state.voiceSuppressClickUntil) return;
  if (!canUseVoice()) {
    toast("Take a seat to use voice.", "error");
    return;
  }
  if (state.voiceBudgetLocked) {
    toast("Voice is unavailable until next month.", "error");
    return;
  }
  if (state.voiceJoining) return;
  toast("Hold to talk");
}

function onVoiceContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
}

function formatChatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getChatViewportBounds() {
  const vv = window.visualViewport;
  return {
    width: vv?.width || window.innerWidth || document.documentElement.clientWidth || 0,
    height: vv?.height || window.innerHeight || document.documentElement.clientHeight || 0,
    offsetLeft: vv?.offsetLeft || 0,
    offsetTop: vv?.offsetTop || 0,
  };
}

function clampChatPanelPosition(x, y, panelRect = el.chatPanel?.getBoundingClientRect()) {
  const viewport = getChatViewportBounds();
  const panelWidth = panelRect?.width || 184;
  const panelHeight = panelRect?.height || 220;
  const margin = 8;
  const minX = viewport.offsetLeft + margin;
  const maxX = viewport.offsetLeft + Math.max(margin, viewport.width - panelWidth - margin);
  const minY = viewport.offsetTop + margin;
  const maxY = viewport.offsetTop + Math.max(margin, viewport.height - panelHeight - margin);
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

function applyChatPanelPosition() {
  if (!el.chatPanel) return;
  const position = state.chatPanelPosition;
  if (!position) {
    el.chatPanel.style.left = "";
    el.chatPanel.style.top = "";
    el.chatPanel.style.right = "";
    el.chatPanel.style.bottom = "";
    return;
  }
  const clamped = clampChatPanelPosition(position.x, position.y);
  state.chatPanelPosition = clamped;
  el.chatPanel.style.left = `${clamped.x}px`;
  el.chatPanel.style.top = `${clamped.y}px`;
  el.chatPanel.style.right = "auto";
  el.chatPanel.style.bottom = "auto";
}

function startChatDrag(event) {
  if (!state.chatOpen || !el.chatPanel || !el.chatHeader) return;
  if (event.target?.closest?.(".chat-close")) return;
  event.preventDefault();
  event.stopPropagation();
  const rect = el.chatPanel.getBoundingClientRect();
  const startX = event.clientX ?? event.pageX ?? 0;
  const startY = event.clientY ?? event.pageY ?? 0;
  const initial = state.chatPanelPosition || { x: rect.left, y: rect.top };
  const clamped = clampChatPanelPosition(initial.x, initial.y, rect);
  state.chatPanelPosition = clamped;
  state.chatDrag.active = true;
  state.chatDrag.pointerId = event.pointerId ?? null;
  state.chatDrag.offsetX = startX - clamped.x;
  state.chatDrag.offsetY = startY - clamped.y;
  el.chatPanel.classList.add("dragging");
  applyChatPanelPosition();
  try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch {}
}

function moveChatDrag(event) {
  if (!state.chatDrag.active || !el.chatPanel) return;
  if (state.chatDrag.pointerId != null && event.pointerId != null && event.pointerId !== state.chatDrag.pointerId) return;
  event.preventDefault();
  const nextX = (event.clientX ?? event.pageX ?? 0) - state.chatDrag.offsetX;
  const nextY = (event.clientY ?? event.pageY ?? 0) - state.chatDrag.offsetY;
  state.chatPanelPosition = clampChatPanelPosition(nextX, nextY);
  applyChatPanelPosition();
}

function endChatDrag(event) {
  if (!state.chatDrag.active) return;
  if (state.chatDrag.pointerId != null && event?.pointerId != null && event.pointerId !== state.chatDrag.pointerId) return;
  try { event?.currentTarget?.releasePointerCapture?.(event.pointerId); } catch {}
  state.chatDrag.active = false;
  state.chatDrag.pointerId = null;
  el.chatPanel?.classList.remove("dragging");
}

function renderChatUi() {
  const visible = Boolean(state.tableId && !el.tableView.classList.contains("hidden"));
  el.chatFab?.classList.toggle("hidden", !visible || state.chatOpen);
  if (el.chatFab) el.chatFab.setAttribute("aria-expanded", state.chatOpen ? "true" : "false");
  el.chatPanel?.classList.toggle("hidden", !visible || !state.chatOpen);
  if (visible && state.chatOpen) applyChatPanelPosition();

  const unread = Number(state.chatUnread || 0);
  if (el.chatFabBadge) {
    el.chatFabBadge.classList.toggle("hidden", unread <= 0);
    el.chatFabBadge.textContent = unread > 99 ? "99+" : String(unread);
  }

  if (el.chatSend && el.chatInput) {
    const canSend = Boolean(state.tableId && state.identity && String(el.chatInput.value || "").trim());
    el.chatSend.disabled = !canSend;
  }

  if (!el.chatList || !el.chatEmpty) return;
  el.chatList.innerHTML = "";
  const messages = state.chatMessages.slice(-40);
  if (!messages.length) {
    el.chatList.appendChild(el.chatEmpty);
    return;
  }

  for (const msg of messages) {
    const item = document.createElement("div");
    item.className = `chat-msg${msg.self ? " self" : ""}`;

    const meta = document.createElement("div");
    meta.className = "chat-msg-meta";
    const author = document.createElement("span");
    author.className = "chat-msg-author";
    author.textContent = msg.name || "Player";
    const time = document.createElement("span");
    time.className = "chat-msg-time";
    time.textContent = formatChatTime(msg.at);
    meta.append(author, time);

    const body = document.createElement("div");
    body.className = "chat-msg-body";
    body.textContent = msg.text || "";
    item.append(meta, body);
    el.chatList.appendChild(item);
  }

  el.chatList.scrollTop = el.chatList.scrollHeight;
}

function normalizeChatMessage(message) {
  const text = String(message?.text || "").trim();
  const id = String(message?.id || "");
  const playerId = message?.player_id || message?.playerId || null;
  if (!text || !id) return null;
  return {
    id,
    tableId: message?.table_id || message?.tableId || state.tableId || null,
    text: text.slice(0, 180),
    name: String(message?.name || "Player").slice(0, 30),
    playerId,
    at: message?.at || new Date().toISOString(),
    self: Boolean(playerId && playerId === state.identity?.groupPlayerId),
  };
}

function applyServerChatHistory(messages) {
  if (!Array.isArray(messages)) return;
  const priorIds = new Set(state.chatMessages.map(msg => msg.id));
  const priorCount = state.chatMessages.length;
  const normalized = [];
  const seen = new Set();
  let unseenCount = 0;

  for (const raw of messages) {
    const msg = normalizeChatMessage(raw);
    if (!msg || seen.has(msg.id)) continue;
    seen.add(msg.id);
    normalized.push(msg);
  }

  const trimmed = normalized.slice(-40);
  if (priorCount > 0 && !state.chatOpen) {
    for (const msg of trimmed) {
      if (!priorIds.has(msg.id) && !msg.self) unseenCount += 1;
    }
  }

  state.chatMessages = trimmed;
  state.chatMessageIds = new Set(trimmed.map(msg => msg.id));
  if (unseenCount > 0) state.chatUnread += unseenCount;
  renderChatUi();
}

function toggleChat(forceOpen = !state.chatOpen) {
  state.chatOpen = Boolean(forceOpen);
  if (state.chatOpen) state.chatUnread = 0;
  renderChatUi();
  if (state.chatOpen) {
    requestAnimationFrame(() => {
      el.chatInput?.focus();
      if (el.chatList) el.chatList.scrollTop = el.chatList.scrollHeight;
    });
  }
}

function addChatMessage(message, { self = false } = {}) {
  const text = String(message?.text || "").trim();
  const id = String(message?.id || "");
  if (!text || !id || state.chatMessageIds.has(id)) return;
  state.chatMessageIds.add(id);
  state.chatMessages.push({
    id,
    text: text.slice(0, 180),
    name: String(message?.name || "Player").slice(0, 30),
    playerId: message?.playerId || null,
    at: message?.at || new Date().toISOString(),
    self,
  });
  while (state.chatMessages.length > 40) {
    const removed = state.chatMessages.shift();
    if (removed?.id) state.chatMessageIds.delete(removed.id);
  }
  if (!self && !state.chatOpen) state.chatUnread += 1;
  renderChatUi();
}

async function sendChatMessage(rawText) {
  const text = String(rawText || "").trim().slice(0, 180);
  if (!text) return;
  if (!state.tableId || !state.identity) {
    toast("Chat is unavailable right now.", "error");
    return;
  }
  const seatToken = getSeatToken();
  if (!seatToken) {
    toast("Join a seat to use chat.", "error");
    return;
  }
  const payload = {
    id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tableId: state.tableId,
    playerId: state.identity.groupPlayerId,
    name: state.identity.name || seatName(state.identity.groupPlayerId),
    text,
    at: new Date().toISOString(),
  };

  try {
    const persisted = await online.postTableChatMessage({
      tableId: state.tableId,
      actorGroupPlayerId: state.identity.groupPlayerId,
      seatToken,
      message: text,
    });
    const nextMessage = normalizeChatMessage(persisted) || normalizeChatMessage(payload) || payload;

    addChatMessage(nextMessage, { self: true });
    if (state.chatChannel && state.chatHealthy) {
      const status = await state.chatChannel.send({
        type: "broadcast",
        event: "table_chat",
        payload: nextMessage,
      });
      if (status !== "ok" && !persisted) {
        throw new Error(typeof status === "string" ? status : "broadcast failed");
      }
    }
    if (el.chatInput) el.chatInput.value = "";
    renderChatUi();
    if (persisted) {
      queueRtRefresh();
    }
  } catch (err) {
    toast(err?.message || "Chat failed", "error");
  }
}

// ============ SOUNDS ============
function getAudioCtx() {
  if (!state.audioCtx) {
    try { state.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  return state.audioCtx;
}

function playTone(freq, duration = 0.08, gain = 0.1, type = "sine") {
  if (!state.config.soundOn) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(g).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

const sounds = {
  yourTurn: () => { playTone(880, 0.12, 0.15); setTimeout(() => playTone(1100, 0.1, 0.12), 130); },
  check: () => playTone(400, 0.05, 0.08, "triangle"),
  call: () => { playTone(470, 0.05, 0.08, "triangle"); setTimeout(() => playTone(560, 0.05, 0.07, "triangle"), 55); },
  bet: () => { playTone(600, 0.06, 0.1); setTimeout(() => playTone(800, 0.04, 0.08), 60); },
  raise: () => { playTone(640, 0.08, 0.1); setTimeout(() => playTone(860, 0.08, 0.09), 65); setTimeout(() => playTone(1040, 0.06, 0.08), 135); },
  fold: () => playTone(250, 0.1, 0.06, "triangle"),
  allIn: () => { playTone(500, 0.15, 0.15); setTimeout(() => playTone(700, 0.15, 0.12), 100); setTimeout(() => playTone(900, 0.2, 0.1), 200); },
  win: () => { playTone(800, 0.15, 0.12); setTimeout(() => playTone(1000, 0.15, 0.1), 120); setTimeout(() => playTone(1200, 0.25, 0.1), 250); },
  deal: () => playTone(1200, 0.03, 0.05, "triangle"),
  streetFlip: () => { playTone(880, 0.04, 0.05, "triangle"); setTimeout(() => playTone(620, 0.06, 0.05, "triangle"), 45); },
  tick: () => playTone(1000, 0.02, 0.04, "square"),
};

// ============ HELPERS ============
function fmt(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "$0.00";
}

function fmtShort(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "$0";
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

function actionAmountText(amount) {
  return amount != null ? fmtShort(amount) : "";
}

function presetSymbol(fraction) {
  if (fraction === 0.33) return "⅓";
  if (fraction === 0.5) return "½";
  if (fraction === 0.75) return "¾";
  return "Pot";
}

function presetName(fraction) {
  if (fraction === 0.33) return "one-third-pot";
  if (fraction === 0.5) return "half-pot";
  if (fraction === 0.75) return "three-quarter-pot";
  return "pot";
}

function getActionCopy(ev) {
  const actor = ev.actor_group_player_id ? seatName(ev.actor_group_player_id) : "Player";
  const p = ev.payload || {};
  const amountText = actionAmountText(p.amount);
  const targetText = actionAmountText(p.raise_to ?? p.target_amount);
  switch (p.action_type) {
    case "check":
      return { actor, detail: "checks", sound: "check", actionType: "check" };
    case "call":
      return { actor, detail: amountText ? `calls ${amountText}` : "calls", sound: "call", actionType: "call" };
    case "bet":
      return { actor, detail: amountText ? `bets ${amountText}` : "bets", sound: "bet", actionType: "bet" };
    case "raise":
      return { actor, detail: targetText ? `raises to ${targetText}` : amountText ? `raises by ${amountText}` : "raises", sound: "raise", actionType: "raise" };
    case "fold":
      return { actor, detail: "folds", sound: "fold", actionType: "fold" };
    case "all_in":
      return { actor, detail: amountText ? `goes all-in for ${amountText}` : "goes all-in", sound: "all_in", actionType: "all_in" };
    default:
      return { actor, detail: p.action_type || "acts", sound: null, actionType: p.action_type || "" };
  }
}

function playActionAnnouncementSound(kind) {
  switch (kind) {
    case "check": sounds.check(); break;
    case "call": sounds.call(); break;
    case "bet": sounds.bet(); break;
    case "raise": sounds.raise(); break;
    case "fold": sounds.fold(); break;
    case "all_in": sounds.allIn(); break;
    default: break;
  }
}

function hideActionAnnouncement() {
  el.actionAnnouncement?.classList.remove("visible");
}

function resetActionAnnouncements() {
  state.actionAnnouncementQueue = [];
  clearTimeout(state.actionAnnouncementHideTimer);
  clearTimeout(state.actionAnnouncementNextTimer);
  state.actionAnnouncementHideTimer = null;
  state.actionAnnouncementNextTimer = null;
  state.lastAnnouncedActionHandId = null;
  state.lastAnnouncedActionSeq = 0;
  if (el.actionAnnouncement) delete el.actionAnnouncement.dataset.action;
  if (el.actionAnnouncementActor) el.actionAnnouncementActor.textContent = "";
  if (el.actionAnnouncementText) el.actionAnnouncementText.textContent = "";
  hideActionAnnouncement();
}

function flushActionAnnouncementQueue() {
  if (!state.actionAnnouncementQueue.length) return;
  const next = state.actionAnnouncementQueue.shift();
  if (!next || !el.actionAnnouncement || !el.actionAnnouncementActor || !el.actionAnnouncementText) return;
  clearTimeout(state.actionAnnouncementHideTimer);
  clearTimeout(state.actionAnnouncementNextTimer);
  el.actionAnnouncement.dataset.action = next.actionType || "";
  el.actionAnnouncementActor.textContent = next.actor;
  el.actionAnnouncementText.textContent = next.detail;
  el.actionAnnouncement.classList.add("visible");
  playActionAnnouncementSound(next.sound);
  state.actionAnnouncementHideTimer = setTimeout(hideActionAnnouncement, 950);
  state.actionAnnouncementNextTimer = setTimeout(() => {
    state.actionAnnouncementNextTimer = null;
    flushActionAnnouncementQueue();
  }, 1100);
}

function queueActionAnnouncement(ev) {
  const copy = getActionCopy(ev);
  if (!copy.detail) return;
  state.actionAnnouncementQueue.push(copy);
  if (!state.actionAnnouncementNextTimer) flushActionAnnouncementQueue();
}

function syncActionAnnouncements({ hadPriorTableState = false, oldHandId = null } = {}) {
  const hand = getLatestHand();
  const events = getHandEvents();
  const handId = hand?.id || null;
  const latestActionSeq = events.reduce((maxSeq, ev) => (
    ev.event_type === "action_taken" ? Math.max(maxSeq, Number(ev.seq || 0)) : maxSeq
  ), 0);

  if (!handId) {
    state.lastAnnouncedActionHandId = null;
    state.lastAnnouncedActionSeq = 0;
    return;
  }

  if (!hadPriorTableState) {
    state.lastAnnouncedActionHandId = handId;
    state.lastAnnouncedActionSeq = latestActionSeq;
    return;
  }

  if (state.lastAnnouncedActionHandId !== handId || oldHandId !== handId) {
    state.lastAnnouncedActionHandId = handId;
    state.lastAnnouncedActionSeq = 0;
  }

  const newActions = events.filter((ev) => (
    ev.event_type === "action_taken" && Number(ev.seq || 0) > Number(state.lastAnnouncedActionSeq || 0)
  ));

  if (!newActions.length) {
    state.lastAnnouncedActionSeq = latestActionSeq;
    return;
  }

  state.lastAnnouncedActionSeq = Number(newActions[newActions.length - 1].seq || state.lastAnnouncedActionSeq || 0);
  newActions.forEach(queueActionAnnouncement);
}

function decimalPlaces(v) {
  const raw = String(v ?? "").trim();
  if (!raw || !raw.includes(".")) return 0;
  return raw.split(".")[1].replace(/0+$/, "").length;
}

function getBetStep() {
  const table = getTable();
  const places = Math.max(
    decimalPlaces(table?.small_blind),
    decimalPlaces(table?.big_blind),
    decimalPlaces(getLatestHand()?.min_raise),
  );
  return places > 0 ? Number((1 / (10 ** Math.min(places, 2))).toFixed(Math.min(places, 2))) : 1;
}

function roundToStep(value, step = 1) {
  const safeStep = Math.max(0.01, Number(step || 1));
  const decimals = decimalPlaces(safeStep);
  return Number((Math.round(Number(value || 0) / safeStep) * safeStep).toFixed(decimals));
}

function getBetBounds(hand = getLatestHand(), hp = getMyHandPlayer()) {
  const toCall = Math.max(0, Number(hand?.current_bet || 0) - Number(hp?.street_contribution || 0));
  const isRaise = Number(hand?.current_bet || 0) > 0;
  const minRaw = isRaise
    ? Number(hand?.current_bet || 0) + Math.max(Number(hand?.min_raise || 0), Number(getTable()?.big_blind || 2))
    : Number(getTable()?.big_blind || 2);
  const maxRaw = Number(hp?.stack_end || 0) + Number(hp?.street_contribution || 0);
  const step = getBetStep();
  const maxBet = roundToStep(maxRaw, step);
  const minBet = roundToStep(Math.min(minRaw, maxBet), step);
  return { toCall, isRaise, minBet, maxBet, step };
}

function normalizeBetAmount(value, minBet, maxBet, step = 1) {
  const safeStep = Math.max(0.01, Number(step || 1));
  const decimals = decimalPlaces(safeStep);
  const fallback = Number.isFinite(minBet) ? minBet : 0;
  let next = Number(value);
  if (!Number.isFinite(next)) next = fallback;
  next = Math.min(Number.isFinite(maxBet) ? maxBet : next, Math.max(fallback, next));
  next = Math.min(Number.isFinite(maxBet) ? maxBet : next, Math.max(fallback, roundToStep(next, safeStep)));
  return Number(next.toFixed(decimals));
}

function getPresetBetAmount(fraction, hand = getLatestHand(), hp = getMyHandPlayer()) {
  const pot = Number(hand?.pot_total || 0);
  const contribution = Number(hp?.street_contribution || 0);
  const { toCall, minBet, maxBet, step } = getBetBounds(hand, hp);
  const bigBlind = Number(getTable()?.big_blind || step || 1);

  let rawTarget = 0;
  if (toCall > 0) {
    const potAfterCall = pot + toCall;
    rawTarget = contribution + toCall + (potAfterCall * fraction);
  } else {
    const basePot = pot > 0 ? pot * fraction : bigBlind;
    rawTarget = Math.max(bigBlind, basePot);
  }

  return normalizeBetAmount(roundToStep(rawTarget, step), minBet, maxBet, step);
}

function getPresetMeta(fraction, hand = getLatestHand(), hp = getMyHandPlayer()) {
  const { toCall, isRaise } = getBetBounds(hand, hp);
  const amount = getPresetBetAmount(fraction, hand, hp);
  const symbol = presetSymbol(fraction);
  const labelName = presetName(fraction).replace(/-/g, " ");
  const buttonText = isRaise ? `${symbol}+` : symbol;
  const actionText = isRaise ? `raise to ${fmtShort(amount)}` : `bet ${fmtShort(amount)}`;
  const extra = isRaise && toCall > 0 ? ` after calling ${fmtShort(toCall)}` : "";
  return {
    amount,
    buttonText,
    title: `${labelName} ${actionText}${extra}`,
    toastText: `${labelName[0].toUpperCase()}${labelName.slice(1)} ${actionText}`,
  };
}

function refreshPresetButtons(hand = getLatestHand(), hp = getMyHandPlayer()) {
  const { isRaise } = getBetBounds(hand, hp);
  document.querySelectorAll(".preset-chip").forEach((btn) => {
    const fraction = Number(btn.dataset.fraction || 0);
    const meta = getPresetMeta(fraction, hand, hp);
    btn.textContent = meta.buttonText;
    btn.title = meta.title;
    btn.setAttribute("aria-label", meta.title);
    btn.dataset.mode = isRaise ? "raise" : "bet";
  });
}

function getBetControlValue() {
  const quickValue = Number(el.betAmountQuick?.value);
  if (Number.isFinite(quickValue)) return quickValue;
  const quickSliderValue = Number(el.betSliderQuick?.value);
  if (Number.isFinite(quickSliderValue)) return quickSliderValue;
  const amountValue = Number(el.betAmount?.value);
  if (Number.isFinite(amountValue)) return amountValue;
  const sliderValue = Number(el.betSlider?.value);
  return Number.isFinite(sliderValue) ? sliderValue : 0;
}

function setBetControlValue(value) {
  const stringValue = String(value);
  if (el.betSlider) el.betSlider.value = stringValue;
  if (el.betSliderQuick) el.betSliderQuick.value = stringValue;
  if (el.betAmount) el.betAmount.value = stringValue;
  if (el.betAmountQuick) el.betAmountQuick.value = stringValue;
}

function refreshBetControls(hand = getLatestHand(), hp = getMyHandPlayer()) {
  if (!hand || !hp || !el.betSlider || !el.betAmount) return;
  const { isRaise, minBet, maxBet, step } = getBetBounds(hand, hp);
  const normalized = normalizeBetAmount(getBetControlValue(), minBet, maxBet, step);
  const stringMin = String(minBet);
  const stringMax = String(maxBet);
  const stringStep = String(step);
  el.betSlider.min = stringMin;
  el.betSlider.max = stringMax;
  el.betSlider.step = stringStep;
  if (el.betSliderQuick) {
    el.betSliderQuick.min = stringMin;
    el.betSliderQuick.max = stringMax;
    el.betSliderQuick.step = stringStep;
  }
  el.betAmount.min = stringMin;
  el.betAmount.max = stringMax;
  el.betAmount.step = stringStep;
  if (el.betAmountQuick) {
    el.betAmountQuick.min = stringMin;
    el.betAmountQuick.max = stringMax;
    el.betAmountQuick.step = stringStep;
  }
  setBetControlValue(normalized);
  if (el.presetAmountLabel) {
    el.presetAmountLabel.textContent = isRaise ? "Raise to" : "Bet";
  }
  refreshPresetButtons(hand, hp);
}

function getLatestHand() { return state.tableState?.latest_hand?.hand || null; }
function getHandPlayers() { return state.tableState?.latest_hand?.players || []; }
function getHandEvents() { return state.tableState?.latest_hand?.events || []; }
function getSeats() { return state.tableState?.seats || []; }
function getTable() { return state.tableState?.table || null; }

function getMySeat() {
  const me = state.identity?.groupPlayerId;
  if (!me) return null;
  return getSeats().find(s => s.group_player_id === me && !s.left_at) || null;
}

function getMyHandPlayer() {
  const me = state.identity?.groupPlayerId;
  if (!me) return null;
  return getHandPlayers().find(hp => hp.group_player_id === me) || null;
}

function seatLooksBot(seat) {
  if (!seat) return false;
  if (state.botSeats.has(seat.seat_no)) return true;
  if (seat.is_bot) return true;
  return /^bot\b/i.test(String(seat.player_name || "").trim());
}

function getEffectiveHostGroupPlayerId() {
  const table = getTable();
  if (!table) return null;
  const activeSeats = getSeats()
    .filter(seat => seat.group_player_id && !seat.left_at)
    .sort((a, b) => a.seat_no - b.seat_no);
  const declaredHostSeat = activeSeats.find(
    (seat) => seat.group_player_id === table.created_by_group_player_id
  );
  if (declaredHostSeat && !seatLooksBot(declaredHostSeat)) {
    return declaredHostSeat.group_player_id;
  }
  return activeSeats.find((seat) => !seatLooksBot(seat))?.group_player_id || null;
}

function isHostPlayer() {
  return getEffectiveHostGroupPlayerId() === state.identity?.groupPlayerId;
}

function canManageHand() {
  return isHostPlayer() && Boolean(getSeatToken()) && Boolean(getMySeat());
}

function isActionStreet(s) {
  return ["preflop","flop","turn","river"].includes(s);
}

function syncShowdownRevealState(hand = getLatestHand()) {
  const revealHandId = hand && ["showdown", "settled"].includes(hand.state) ? hand.id : null;
  if (state.showdownRevealHandId === revealHandId) return;
  state.showdownRevealHandId = revealHandId;
  state.showdownRevealSeats.clear();
}

function consumeShowdownReveal(seatNo, hand = getLatestHand()) {
  if (!hand || !["showdown", "settled"].includes(hand.state)) return false;
  if (state.showdownRevealHandId !== hand.id) {
    state.showdownRevealHandId = hand.id;
    state.showdownRevealSeats.clear();
  }
  if (state.showdownRevealSeats.has(seatNo)) return false;
  state.showdownRevealSeats.add(seatNo);
  return true;
}

function compareRankTuples(a = [], b = []) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = Number(a[i] || 0);
    const bv = Number(b[i] || 0);
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function getShowdownLeaders(hand = getLatestHand(), players = getHandPlayers()) {
  const board = Array.isArray(hand?.board_cards) ? hand.board_cards : [];
  if (!hand || !["showdown", "settled"].includes(hand.state) || board.length !== 5) return [];
  if (players.filter((player) => !player?.folded).length <= 1) return [];

  const contenders = [];
  for (const player of players) {
    if (player?.folded) continue;
    if (!Array.isArray(player?.hole_cards) || player.hole_cards.length < 2) continue;
    try {
      const desc = describeSevenCardHand([...player.hole_cards, ...board]);
      if (Array.isArray(desc?.tuple) && desc.tuple.length) {
        contenders.push({ player, desc });
      }
    } catch {
      // Ignore malformed card state in the client render path.
    }
  }
  if (!contenders.length) return [];

  let bestTuple = contenders[0].desc.tuple;
  for (const contender of contenders.slice(1)) {
    if (compareRankTuples(contender.desc.tuple, bestTuple) > 0) {
      bestTuple = contender.desc.tuple;
    }
  }

  return contenders.filter((contender) => compareRankTuples(contender.desc.tuple, bestTuple) === 0);
}

function getUncontestedWinner(hand = getLatestHand(), players = getHandPlayers()) {
  if (!hand || !["showdown", "settled"].includes(hand.state)) return null;
  const remaining = players.filter((player) => !player?.folded);
  return remaining.length === 1 ? remaining[0] : null;
}

function isContestedShowdown(hand = getLatestHand(), players = getHandPlayers()) {
  const board = Array.isArray(hand?.board_cards) ? hand.board_cards : [];
  return Boolean(
    hand &&
    ["showdown", "settled"].includes(hand.state) &&
    board.length === 5 &&
    players.filter((player) => !player?.folded).length > 1
  );
}

function seatName(groupPlayerId) {
  if (!groupPlayerId) return "Empty";
  const seats = getSeats();
  const handPlayers = getHandPlayers();
  const seat = seats.find(s => s.group_player_id === groupPlayerId);
  if (seat?.player_name) return seat.player_name;
  const hp = handPlayers.find(p => p.group_player_id === groupPlayerId);
  if (hp?.player_name) return hp.player_name;
  if (state.identity?.groupPlayerId === groupPlayerId) return state.identity.name;
  return `Seat ${seat?.seat_no || "?"}`;
}

function hashString(value = "") {
  let h = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function avatarInitials(name = "", isBot = false) {
  const cleaned = String(name || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return isBot ? "AI" : "?";
  const parts = cleaned.split(" ");
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function avatarTheme(seed = "", isBot = false) {
  const idx = hashString(seed) % AVATAR_PALETTES.length;
  const palette = AVATAR_PALETTES[idx];
  return {
    bgA: palette.a,
    bgB: palette.b,
    ring: isBot ? BOT_AVATAR_RING : palette.ring,
  };
}

function applyAvatarTheme(node, { seed = "", name = "", isBot = false } = {}) {
  if (!node) return;
  const theme = avatarTheme(seed || name, isBot);
  node.style.setProperty("--avatar-bg1", theme.bgA);
  node.style.setProperty("--avatar-bg2", theme.bgB);
  node.style.setProperty("--avatar-ring", theme.ring);
  node.textContent = avatarInitials(name, isBot);
  node.dataset.bot = isBot ? "1" : "0";
  node.setAttribute("aria-label", `${name || "Player"} avatar`);
}

function getStackCtaState({
  hand = getLatestHand(),
  handPlayer = null,
  stack = 0,
  seatStack = null,
  startingStack = 200,
} = {}) {
  const currentStack = Number(stack || 0);
  const actualSeatStack = seatStack == null ? currentStack : Number(seatStack || 0);
  const startStackValue = Math.max(0, Number(startingStack || 0));
  const handActive = Boolean(hand && !["settled", "canceled"].includes(hand.state));
  const activeAllIn = Boolean(handActive && handPlayer && !handPlayer.folded && handPlayer.all_in);
  const participatingThisHand = Boolean(
    handActive &&
    handPlayer &&
    !handPlayer.folded &&
    (Array.isArray(handPlayer.hole_cards) ? handPlayer.hole_cards.length >= 2 : true)
  );
  const busted = actualSeatStack <= 0;
  const low = actualSeatStack <= startStackValue * 0.2;

  if (activeAllIn) {
    return { kind: "status", text: "All-in" };
  }
  if (busted && !participatingThisHand) {
    return { kind: "action", text: "Buy In" };
  }
  if (!handActive && low && !busted) {
    return { kind: "action", text: "Top Up" };
  }
  return { kind: "none", text: "" };
}

function normCard(token) {
  const v = String(token || "").trim().toUpperCase();
  if (v.length !== 2) return null;
  if (!RANKS.includes(v[0]) || !SUITS.includes(v[1])) return null;
  return v;
}

function cardFace(token) {
  if (!token || token.length < 2) return { text: "", red: false, valid: false };
  const rank = token[0].toUpperCase();
  const rankText = rank === "T" ? "10" : rank;
  const suit = token[token.length - 1].toLowerCase();
  const sym = suit === "s" ? "♠" : suit === "h" ? "♥" : suit === "d" ? "♦" : suit === "c" ? "♣" : "?";
  return { text: `${rankText}${sym}`, red: suit === "h" || suit === "d", valid: "shdc".includes(suit) };
}

function makeCardEl(token, hidden = false, small = false, mine = false) {
  const div = document.createElement("div");
  const sizeClass = mine ? " card-mine" : small ? " card-sm" : "";
  if (hidden || !token) {
    div.className = `card card-back${sizeClass}`;
  } else {
    const { text, red, valid } = cardFace(token);
    div.className = `card card-face${red ? " red" : ""}${sizeClass}`;
    div.textContent = valid ? text : "??";
  }
  return div;
}

function isLandscape() {
  return window.innerHeight <= 500 && window.innerWidth > window.innerHeight;
}

function isLandscapeCollapseMode() {
  return window.matchMedia(LANDSCAPE_COLLAPSE_MEDIA).matches;
}

function isPortraitCollapseMode() {
  return window.matchMedia(PORTRAIT_COLLAPSE_MEDIA).matches;
}

function setTableViewportLock(enabled) {
  document.documentElement.classList.toggle("table-mode", enabled);
  document.body.classList.toggle("table-mode", enabled);
}

function syncViewportMetrics() {
  const vv = window.visualViewport;
  const viewportWidthSource = vv?.width || document.documentElement?.clientWidth || window.innerWidth || 0;
  const viewportHeightSource = vv?.height || document.documentElement?.clientHeight || window.innerHeight || 0;
  const viewportWidth = Math.max(320, Math.round(viewportWidthSource * 100) / 100);
  const viewportHeight = Math.max(480, Math.round(viewportHeightSource * 100) / 100);
  const screenWidth = Math.max(
    320,
    Math.min(
      window.screen?.width || viewportWidth,
      window.screen?.availWidth || viewportWidth,
      window.screen?.height || viewportWidth
    )
  );
  const screenHeight = Math.max(
    viewportHeight,
    window.screen?.height || 0,
    window.screen?.availHeight || 0,
    window.outerHeight || 0
  );

  document.documentElement.style.setProperty("--app-vw", `${viewportWidth}px`);
  document.documentElement.style.setProperty("--app-vh", `${viewportHeight}px`);
  document.documentElement.style.setProperty("--app-screen-h", `${screenHeight}px`);
  document.documentElement.style.setProperty("--app-screen-w", `${screenWidth}px`);
}

function setTableBooting(enabled, label = "Loading Table...") {
  state.tableBooting = enabled;
  el.tableView?.classList.toggle("table-booting", enabled);
  el.tableBootOverlay?.classList.toggle("hidden", !enabled);
  el.tableBootOverlay?.setAttribute("aria-hidden", enabled ? "false" : "true");
  if (el.tableBootLabel) el.tableBootLabel.textContent = label;
}

function syncLandscapeTopBar(forceCollapse = false) {
  const compactMode = isLandscapeCollapseMode()
    ? "landscape"
    : (isPortraitCollapseMode() ? "portrait" : null);

  if (!compactMode) {
    state.landscapeCompactMode = false;
    state.compactTopBarMode = null;
    state.landscapeTopBarExpanded = true;
    el.tableView.classList.remove(
      "landscape-topbar-expanded",
      "landscape-topbar-collapsed",
      "portrait-topbar-expanded",
      "portrait-topbar-collapsed"
    );
    if (el.landscapeBarToggle) {
      el.landscapeBarToggle.classList.add("hidden");
      el.landscapeBarToggle.textContent = "▲";
      el.landscapeBarToggle.setAttribute("aria-expanded", "true");
      el.landscapeBarToggle.setAttribute("aria-label", "Controls visible");
    }
    return;
  }

  const modeChanged = state.compactTopBarMode && state.compactTopBarMode !== compactMode;
  if (!state.landscapeCompactMode || forceCollapse || modeChanged) {
    state.landscapeTopBarExpanded = false;
  }
  state.landscapeCompactMode = true;
  state.compactTopBarMode = compactMode;
  const inLandscape = compactMode === "landscape";
  const inPortrait = compactMode === "portrait";
  el.tableView.classList.toggle("landscape-topbar-expanded", inLandscape && state.landscapeTopBarExpanded);
  el.tableView.classList.toggle("landscape-topbar-collapsed", inLandscape && !state.landscapeTopBarExpanded);
  el.tableView.classList.toggle("portrait-topbar-expanded", inPortrait && state.landscapeTopBarExpanded);
  el.tableView.classList.toggle("portrait-topbar-collapsed", inPortrait && !state.landscapeTopBarExpanded);
  if (el.landscapeBarToggle) {
    el.landscapeBarToggle.classList.remove("hidden");
    const expanded = state.landscapeTopBarExpanded;
    el.landscapeBarToggle.textContent = expanded ? "▲" : "▼";
    el.landscapeBarToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    el.landscapeBarToggle.setAttribute("aria-label", expanded ? "Hide controls" : "Show controls");
  }
}

function nextOccupiedSeat(activeSeatNos, seatNo) {
  for (const activeSeat of activeSeatNos) {
    if (activeSeat > seatNo) return activeSeat;
  }
  return activeSeatNos[0] || null;
}

function buildDealSeatOrder(hand) {
  const activeSeatNos = getSeats()
    .filter((seat) => seat.group_player_id && !seat.left_at)
    .map((seat) => seat.seat_no)
    .sort((a, b) => a - b);
  if (!activeSeatNos.length) return [];
  const firstSeat = activeSeatNos.length === 2
    ? hand?.button_seat
    : nextOccupiedSeat(activeSeatNos, hand?.button_seat ?? activeSeatNos[0]);
  const startIndex = Math.max(0, activeSeatNos.indexOf(firstSeat));
  return activeSeatNos.slice(startIndex).concat(activeSeatNos.slice(0, startIndex));
}

function clearDealFx() {
  const anim = state.dealAnimation;
  if (anim?.cleanupTimer) clearTimeout(anim.cleanupTimer);
  if (Array.isArray(anim?.soundTimers)) {
    anim.soundTimers.forEach((timerId) => clearTimeout(timerId));
  }
  if (state.potPushAnimation?.cleanupTimer) {
    clearTimeout(state.potPushAnimation.cleanupTimer);
  }
  if (el.dealFxLayer) el.dealFxLayer.innerHTML = "";
  if (el.potDisplay) el.potDisplay.classList.remove("pot-paying");
  state.potPushAnimation = null;
}

function maybeStartDealAnimation(oldHand, hand, hadPriorTableState = false) {
  if (!hand || hand.state !== "preflop") return;
  const isNewHand = Boolean(oldHand && hand.id !== oldHand.id);
  const isFirstVisibleHand = Boolean(!oldHand && hadPriorTableState);
  if (!isNewHand && !isFirstVisibleHand) return;
  const seatOrder = buildDealSeatOrder(hand);
  if (!seatOrder.length) return;
  clearDealFx();
  state.dealAnimation = {
    handId: hand.id,
    startedAt: Date.now(),
    seatOrder,
    launched: false,
    cleanupTimer: null,
    soundTimers: [],
  };
}

function getStreetRevealLandDelayMs(anim, index) {
  if (!anim) return null;
  const revealIndex = anim.indices.indexOf(index);
  if (revealIndex < 0) return null;
  return revealIndex * BOARD_REVEAL_STAGGER_MS;
}

function getStreetRevealFlipDelayMs(anim, index) {
  const landDelayMs = getStreetRevealLandDelayMs(anim, index);
  if (landDelayMs == null) return null;
  if (anim?.indices?.length >= 3) {
    return (anim.indices.length - 1) * BOARD_REVEAL_STAGGER_MS
      + BOARD_REVEAL_LAND_MS
      + 110
      + anim.indices.indexOf(index) * BOARD_REVEAL_FLIP_STAGGER_MS;
  }
  return landDelayMs + BOARD_REVEAL_LAND_MS - 30;
}

function getStreetRevealTotalMs(anim) {
  if (!anim?.indices?.length) return 0;
  const lastIndex = anim.indices[anim.indices.length - 1];
  const flipDelayMs = getStreetRevealFlipDelayMs(anim, lastIndex);
  return (flipDelayMs || 0) + BOARD_REVEAL_FLIP_MS + 180;
}

function clearStreetRevealFx({ keepState = false } = {}) {
  const anim = state.streetRevealAnimation;
  if (anim?.cleanupTimer) clearTimeout(anim.cleanupTimer);
  if (Array.isArray(anim?.soundTimers)) {
    anim.soundTimers.forEach((timerId) => clearTimeout(timerId));
  }
  el.dealFxLayer?.querySelectorAll(".board-flight-card").forEach((node) => node.remove());
  if (!keepState) state.streetRevealAnimation = null;
}

function maybeStartStreetRevealAnimation(oldHand, hand, hadPriorTableState = false) {
  if (!hand) return;

  const oldBoard = Array.isArray(oldHand?.board_cards) ? oldHand.board_cards : [];
  const newBoard = Array.isArray(hand.board_cards) ? hand.board_cards : [];
  if (!newBoard.length) {
    if (!oldHand || hand.id !== oldHand.id) clearStreetRevealFx();
    return;
  }
  if (!oldHand || hand.id !== oldHand.id) {
    if (!hadPriorTableState) clearStreetRevealFx();
    return;
  }

  const indices = [];
  for (let i = 0; i < newBoard.length; i += 1) {
    if (newBoard[i] && oldBoard[i] !== newBoard[i]) indices.push(i);
  }
  if (!indices.length) return;

  clearStreetRevealFx();
  state.streetRevealAnimation = {
    key: `${hand.id}|${hand.state}|${indices.join(",")}|${newBoard.join(",")}`,
    handId: hand.id,
    street: hand.state,
    board: [...newBoard],
    indices,
    startedAt: Date.now(),
    launched: false,
    cleanupTimer: null,
    soundTimers: [],
  };
}

function getStreetRevealMeta(index, hand = getLatestHand()) {
  const anim = state.streetRevealAnimation;
  if (!anim || !hand || anim.handId !== hand.id || !anim.indices.includes(index)) return null;
  const elapsed = Date.now() - anim.startedAt;
  if (elapsed >= getStreetRevealTotalMs(anim)) return null;
  const flipDelayMs = getStreetRevealFlipDelayMs(anim, index);
  return {
    landDelayMs: Math.max(0, getStreetRevealLandDelayMs(anim, index) - elapsed),
    flipDelayMs: Math.max(0, flipDelayMs - elapsed),
    showUnderlay: elapsed >= (flipDelayMs + BOARD_REVEAL_FLIP_MS * 0.45),
  };
}

function getDealCardDelayMs(anim, seatNo, cardIndex) {
  if (!anim) return null;
  const orderIndex = anim.seatOrder.indexOf(seatNo);
  if (orderIndex < 0) return null;
  const seatCount = anim.seatOrder.length;
  const roundIndex = Math.max(0, Number(cardIndex || 1) - 1);
  return (roundIndex * seatCount + orderIndex) * DEAL_STAGGER_MS;
}

function getDealCardAnimationMeta(seatNo, cardIndex, hand = getLatestHand()) {
  const anim = state.dealAnimation;
  if (!anim || !hand || anim.handId !== hand.id) return null;
  const delayMs = getDealCardDelayMs(anim, seatNo, cardIndex);
  if (delayMs == null) return null;
  const elapsed = Date.now() - anim.startedAt;
  if (elapsed >= delayMs + DEAL_ANIMATION_MS + DEAL_REVEAL_MS) return null;
  return {
    flightDelayMs: Math.max(0, delayMs - elapsed),
    revealDelayMs: Math.max(0, delayMs + DEAL_ANIMATION_MS - DEAL_REVEAL_OFFSET_MS - elapsed),
  };
}

function markDealCardTarget(cardEl, seatNo, cardIndex, hand = getLatestHand(), tiltDeg = 0) {
  if (!cardEl) return cardEl;
  cardEl.classList.add("deal-target");
  cardEl.dataset.dealSeat = String(seatNo);
  cardEl.dataset.dealCard = String(cardIndex);
  cardEl.dataset.dealTilt = String(tiltDeg);
  const dealMeta = getDealCardAnimationMeta(seatNo, cardIndex, hand);
  if (dealMeta) {
    cardEl.classList.add("card-dealing");
    cardEl.style.setProperty("--deal-reveal-delay", `${dealMeta.revealDelayMs}ms`);
  } else {
    cardEl.classList.remove("card-dealing");
    cardEl.style.removeProperty("--deal-reveal-delay");
  }
  return cardEl;
}

function getDealFlightPath(fromX, fromY, toX, toY, cardIndex = 1) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  const direction = Math.abs(dx) > 8 ? Math.sign(dx) : (Number(cardIndex || 1) % 2 === 0 ? 1 : -1);
  const arcLift = Math.max(24, Math.min(68, distance * 0.18));
  const sideDrift = Math.max(8, Math.min(22, Math.abs(dx) * 0.08 + 6)) * direction;
  const roundDrop = Number(cardIndex || 1) === 2 ? 5 : 0;
  const fromRot = direction >= 0 ? -20 : 18;
  const midRot = direction >= 0 ? -7 : 6;

  return {
    midX: fromX + dx * 0.54 + sideDrift,
    midY: fromY + dy * 0.46 - arcLift - roundDrop,
    fromRot,
    midRot,
  };
}

function getBoardRevealFlightPath(fromX, fromY, toX, toY, cardIndex = 1) {
  const path = getDealFlightPath(fromX, fromY, toX, toY, cardIndex);
  return {
    midX: path.midX,
    midY: path.midY,
    fromRot: path.fromRot * 0.5,
    midRot: 0,
    toRot: 0,
  };
}

function maybeLaunchDealFx(hand = getLatestHand()) {
  const anim = state.dealAnimation;
  if (!anim || anim.launched || !hand || anim.handId !== hand.id) return;
  if (!el.dealFxLayer || !el.dealerDeck || !el.tableSurface) return;

  const deckRect = el.dealerDeck.getBoundingClientRect();
  const tableRect = el.tableSurface.getBoundingClientRect();
  if (!deckRect.width || !tableRect.width) return;

  const fromX = deckRect.left + deckRect.width / 2 - tableRect.left;
  const fromY = deckRect.top + deckRect.height / 2 - tableRect.top;
  const totalCards = anim.seatOrder.length * 2;
  const soundTimers = [];
  let created = 0;

  for (const seatNo of anim.seatOrder) {
    for (let cardIndex = 1; cardIndex <= 2; cardIndex++) {
      const target = document.querySelector(`.deal-target[data-deal-seat="${seatNo}"][data-deal-card="${cardIndex}"]`);
      if (!target) continue;
      const delayMs = getDealCardDelayMs(anim, seatNo, cardIndex);
      if (delayMs == null) continue;

      const targetRect = target.getBoundingClientRect();
      if (!targetRect.width || !targetRect.height) continue;

      const flight = document.createElement("div");
      const toX = targetRect.left - tableRect.left;
      const toY = targetRect.top - tableRect.top;
      const path = getDealFlightPath(
        fromX - targetRect.width / 2,
        fromY - targetRect.height / 2,
        toX,
        toY,
        cardIndex
      );
      flight.className = "deal-flight-card";
      flight.style.setProperty("--from-x", `${fromX - targetRect.width / 2}px`);
      flight.style.setProperty("--from-y", `${fromY - targetRect.height / 2}px`);
      flight.style.setProperty("--to-x", `${toX}px`);
      flight.style.setProperty("--to-y", `${toY}px`);
      flight.style.setProperty("--mid-x", `${path.midX}px`);
      flight.style.setProperty("--mid-y", `${path.midY}px`);
      flight.style.setProperty("--from-rot", `${path.fromRot}deg`);
      flight.style.setProperty("--mid-rot", `${path.midRot}deg`);
      flight.style.setProperty("--to-rot", `${Number(target.dataset.dealTilt || 0)}deg`);
      flight.style.setProperty("--card-w", `${targetRect.width}px`);
      flight.style.setProperty("--card-h", `${targetRect.height}px`);
      flight.style.setProperty("--delay-ms", `${delayMs}ms`);
      flight.style.setProperty("--flight-ms", `${DEAL_ANIMATION_MS}ms`);
      flight.addEventListener("animationend", () => flight.remove(), { once: true });
      el.dealFxLayer.appendChild(flight);
      created += 1;

      soundTimers.push(setTimeout(() => sounds.deal(), Math.max(0, delayMs - 12)));
    }
  }

  if (!created) return;
  anim.launched = true;
  anim.soundTimers = soundTimers;
  anim.cleanupTimer = setTimeout(() => {
    if (state.dealAnimation?.handId === anim.handId) clearDealFx();
  }, totalCards * DEAL_STAGGER_MS + DEAL_ANIMATION_MS + 220);
}

function maybeLaunchStreetRevealFx(hand = getLatestHand()) {
  const anim = state.streetRevealAnimation;
  if (!anim || anim.launched || !hand || anim.handId !== hand.id) return;
  if (!el.dealFxLayer || !el.tableSurface || !el.boardCards) return;

  const tableRect = el.tableSurface.getBoundingClientRect();
  const deckRect = el.dealerDeck?.getBoundingClientRect();
  const boardRect = el.boardCards.getBoundingClientRect();
  if (!tableRect.width || !boardRect.width) return;

  const fallbackFromX = boardRect.left + boardRect.width / 2 - tableRect.left;
  const fallbackFromY = boardRect.top - tableRect.top - 24;
  const fromX = deckRect?.width ? deckRect.left + deckRect.width / 2 - tableRect.left : fallbackFromX;
  const fromY = deckRect?.height ? deckRect.top + deckRect.height / 2 - tableRect.top : fallbackFromY;
  const soundTimers = [];
  let created = 0;

  for (const boardIndex of anim.indices) {
    const target = el.boardCards.querySelector(`.board-deal-target[data-board-index="${boardIndex}"]`);
    if (!target) continue;
    const targetRect = target.getBoundingClientRect();
    if (!targetRect.width || !targetRect.height) continue;

    const landDelayMs = getStreetRevealLandDelayMs(anim, boardIndex);
    const flipDelayMs = getStreetRevealFlipDelayMs(anim, boardIndex);
    if (landDelayMs == null || flipDelayMs == null) continue;

    const targetX = targetRect.left - tableRect.left;
    const targetY = targetRect.top - tableRect.top;
    const path = getBoardRevealFlightPath(
      fromX - targetRect.width / 2,
      fromY - targetRect.height / 2,
      targetX,
      targetY,
      boardIndex + 1
    );

    const flight = document.createElement("div");
    flight.className = "board-flight-card";
    flight.style.setProperty("--from-x", `${fromX - targetRect.width / 2}px`);
    flight.style.setProperty("--from-y", `${fromY - targetRect.height / 2}px`);
    flight.style.setProperty("--to-x", `${targetX}px`);
    flight.style.setProperty("--to-y", `${targetY}px`);
    flight.style.setProperty("--mid-x", `${path.midX}px`);
    flight.style.setProperty("--mid-y", `${path.midY}px`);
    flight.style.setProperty("--from-rot", `${path.fromRot}deg`);
    flight.style.setProperty("--mid-rot", `${path.midRot}deg`);
    flight.style.setProperty("--to-rot", `${path.toRot}deg`);
    flight.style.setProperty("--card-w", `${targetRect.width}px`);
    flight.style.setProperty("--card-h", `${targetRect.height}px`);
    flight.style.setProperty("--delay-ms", `${landDelayMs}ms`);
    flight.style.setProperty("--flight-ms", `${BOARD_REVEAL_LAND_MS}ms`);
    flight.style.setProperty("--flip-delay-ms", `${flipDelayMs}ms`);
    flight.style.setProperty("--flip-ms", `${BOARD_REVEAL_FLIP_MS}ms`);

    const inner = document.createElement("div");
    inner.className = "board-flight-card__inner";
    const backFace = document.createElement("div");
    backFace.className = "board-flight-card__face board-flight-card__face--back";
    backFace.appendChild(makeCardEl(null, true, false, false));
    const frontFace = document.createElement("div");
    frontFace.className = "board-flight-card__face board-flight-card__face--front";
    frontFace.appendChild(makeCardEl(anim.board[boardIndex], false, false, false));
    inner.append(backFace, frontFace);
    flight.appendChild(inner);

    const finishAt = flipDelayMs + BOARD_REVEAL_FLIP_MS + 60;
    flight.addEventListener("animationend", () => {
      if (Date.now() - anim.startedAt >= finishAt) flight.remove();
    });
    el.dealFxLayer.appendChild(flight);
    created += 1;

    soundTimers.push(setTimeout(() => sounds.deal(), Math.max(0, landDelayMs - 10)));
    soundTimers.push(setTimeout(() => sounds.streetFlip(), Math.max(0, flipDelayMs + 40)));
  }

  anim.launched = true;
  anim.soundTimers = soundTimers;
  if (!created) {
    state.streetRevealAnimation = null;
    return;
  }

  anim.cleanupTimer = setTimeout(() => {
    if (state.streetRevealAnimation?.key === anim.key) {
      clearStreetRevealFx();
      renderBoard();
    }
  }, getStreetRevealTotalMs(anim));
}

function getPotChipCount(potTotal, bigBlind) {
  if (!(potTotal > 0)) return 0;
  const bbUnits = potTotal / Math.max(0.01, Number(bigBlind || 1));
  return Math.min(12, Math.max(3, 2 + Math.round(Math.sqrt(bbUnits) * 1.7)));
}

function renderPotChips(potTotal, bigBlind, handId) {
  if (!el.potStackArt) return;
  const chipCount = getPotChipCount(potTotal, bigBlind);
  const sameHand = state.potVisual.handId === handId;
  const previousCount = sameHand ? state.potVisual.chipCount : 0;
  const colors = ["charcoal", "red", "green", "gold", "ivory"];

  el.potStackArt.innerHTML = "";
  for (let i = 0; i < chipCount; i++) {
    const chip = document.createElement("span");
    const row = Math.floor(i / 3);
    const col = i % 3;
    const x = col * 11 + (row % 2 === 1 ? 2 : 0);
    const y = Math.max(0, 10 - row * 4 + (col === 1 ? 0 : 1));
    chip.className = `pot-chip pot-chip--${colors[i % colors.length]}`;
    if (sameHand && i >= previousCount) chip.classList.add("stack-added");
    chip.style.left = `${x}px`;
    chip.style.top = `${y}px`;
    chip.style.zIndex = String(10 + i);
    chip.style.setProperty("--chip-rot", `${[-8, 4, -3, 7, -5][i % 5]}deg`);
    el.potStackArt.appendChild(chip);
  }

  const scale = chipCount > 0 ? (0.92 + Math.min(0.42, chipCount * 0.035)) : 1;
  el.potStackArt.style.setProperty("--stack-scale", scale.toFixed(2));
  state.potVisual.handId = handId || null;
  state.potVisual.chipCount = chipCount;
}

function getSeatTargetElement(seatNo) {
  const mySeat = getMySeat();
  if (mySeat && mySeat.seat_no === seatNo) {
    return el.myHandNameplate || el.myHandArea || null;
  }
  return el.seatsLayer?.querySelector(`.seat-node[data-seat-no="${seatNo}"]`) || null;
}

function maybeLaunchPotPushFx(hand = getLatestHand()) {
  const anim = state.potPushAnimation;
  if (!anim || anim.launched || !hand || anim.handId !== hand.id) return;
  if (!el.dealFxLayer || !el.tableSurface || !el.potStackArt) return;

  const tableRect = el.tableSurface.getBoundingClientRect();
  const sourceRect = el.potStackArt.getBoundingClientRect();
  if (!tableRect.width || !sourceRect.width) return;

  const fromX = sourceRect.left + sourceRect.width / 2 - tableRect.left;
  const fromY = sourceRect.top + sourceRect.height / 2 - tableRect.top;
  const bigBlind = Math.max(0.01, Number(getTable()?.big_blind || 1));
  const colorOrder = ["charcoal", "red", "green", "gold", "ivory"];
  let created = 0;

  anim.winners.forEach((winner, winnerIndex) => {
    const targetEl = getSeatTargetElement(winner.seatNo);
    if (!targetEl) return;
    const targetRect = targetEl.getBoundingClientRect();
    if (!targetRect.width) return;
    const chipCount = Math.min(8, Math.max(4, 2 + Math.round(Math.sqrt(Number(winner.amount || 0) / bigBlind) * 1.4)));

    for (let i = 0; i < chipCount; i++) {
      const chip = document.createElement("span");
      const scatterX = ((i % 3) - 1) * 12 + (winnerIndex * 8);
      const scatterY = Math.floor(i / 3) * 7;
      chip.className = `pot-chip pot-chip--${colorOrder[(i + winnerIndex) % colorOrder.length]} pot-push-chip`;
      chip.style.setProperty("--chip-rot", `${[-10, 8, -6, 5, -3][(i + winnerIndex) % 5]}deg`);
      chip.style.setProperty("--from-x", `${fromX - 9 + (i % 2 ? 4 : -4)}px`);
      chip.style.setProperty("--from-y", `${fromY - 9 + Math.floor(i / 2) * 2}px`);
      chip.style.setProperty("--to-x", `${targetRect.left + targetRect.width / 2 - tableRect.left - 9 + scatterX}px`);
      chip.style.setProperty("--to-y", `${targetRect.top + targetRect.height / 2 - tableRect.top - 9 + scatterY}px`);
      chip.style.setProperty("--delay-ms", `${winnerIndex * 120 + i * CHIP_PUSH_STAGGER_MS}ms`);
      chip.style.setProperty("--flight-ms", `${CHIP_PUSH_MS}ms`);
      chip.addEventListener("animationend", () => chip.remove(), { once: true });
      el.dealFxLayer.appendChild(chip);
      created += 1;
    }
  });

  anim.launched = true;
  if (!created) {
    state.potPushAnimation = null;
    return;
  }

  state.clearedPotHandId = anim.handId;
  if (el.potDisplay) el.potDisplay.classList.add("pot-paying", "pot-cleared");
  if (el.potAmount) el.potAmount.textContent = fmtShort(0);
  anim.cleanupTimer = setTimeout(() => {
    if (el.potDisplay) el.potDisplay.classList.remove("pot-paying");
    if (state.potPushAnimation?.handId === anim.handId) state.potPushAnimation = null;
  }, CHIP_PUSH_MS + anim.winners.length * 120 + 600);
}

// Fixed seat positions at the table edge for portrait mode.
// Each slot is { x%, y% } placing the seat right on the rail.
const PORTRAIT_SEATS = {
  2: [
    { x: 50, y: 4 }, { x: 50, y: 86 },
  ],
  3: [
    { x: 50, y: 4 },
    { x: 8, y: 44 }, { x: 92, y: 44 },
  ],
  4: [
    { x: 30, y: 4 }, { x: 70, y: 4 },
    { x: 8, y: 52 }, { x: 92, y: 52 },
  ],
  5: [
    { x: 50, y: 4 },
    { x: 6, y: 30 }, { x: 94, y: 30 },
    { x: 8, y: 75 }, { x: 92, y: 75 },
  ],
  6: [
    { x: 30, y: 4 }, { x: 70, y: 4 },
    { x: 4, y: 40 }, { x: 96, y: 40 },
    { x: 20, y: 80 }, { x: 80, y: 80 },
  ],
  7: [
    { x: 50, y: 3 },
    { x: 12, y: 16 }, { x: 88, y: 16 },
    { x: 11, y: 45 }, { x: 89, y: 45 },
    { x: 10, y: 85 }, { x: 90, y: 85 },
  ],
  8: [
    { x: 30, y: 2 }, { x: 70, y: 2 },
    { x: 11, y: 25 }, { x: 89, y: 25 },
    { x: 12, y: 62 }, { x: 88, y: 62 },
    { x: 18, y: 90 }, { x: 82, y: 90 },
  ],
  9: [
    { x: 50, y: 2 },
    { x: 12, y: 13 }, { x: 88, y: 13 },
    { x: 2, y: 38 }, { x: 98, y: 38 },
    { x: 2, y: 62 }, { x: 98, y: 62 },
    { x: 14, y: 88 }, { x: 86, y: 88 },
  ],
  10: [
    { x: 30, y: 3 }, { x: 70, y: 3 },
    { x: 6, y: 18 }, { x: 94, y: 18 },
    { x: 4, y: 40 }, { x: 96, y: 40 },
    { x: 4, y: 62 }, { x: 96, y: 62 },
    { x: 22, y: 82 }, { x: 78, y: 82 },
  ],
};

// Hand-tuned landscape slots (table seats only; my-seat remains in hand area).
// Goal: mirrored rows with no direct seat opposite hero.
const LANDSCAPE_SEATS = {
  1: [{ x: 36, y: 9 }],
  2: [{ x: 36, y: 9 }, { x: 64, y: 9 }],
  3: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 88, y: 27 }],
  4: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }],
  5: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }, { x: 94, y: 56 }],
  6: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }, { x: 6, y: 56 }, { x: 94, y: 56 }],
  7: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }, { x: 6, y: 56 }, { x: 94, y: 56 }, { x: 80, y: 82 }],
  8: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }, { x: 6, y: 56 }, { x: 94, y: 56 }, { x: 20, y: 82 }, { x: 80, y: 82 }],
  9: [{ x: 36, y: 9 }, { x: 64, y: 9 }, { x: 12, y: 27 }, { x: 88, y: 27 }, { x: 6, y: 56 }, { x: 94, y: 56 }, { x: 20, y: 82 }, { x: 80, y: 82 }, { x: 86, y: 86 }],
};

function portraitSeatPosition(index, total) {
  const clamped = Math.max(2, Math.min(10, total));
  const positions = PORTRAIT_SEATS[clamped] || PORTRAIT_SEATS[6];
  const idx = Math.max(0, Math.min(index - 1, positions.length - 1));
  const p = positions[idx];
  return { x: `${p.x}%`, y: `${p.y}%` };
}

function landscapeSeatPosition(index, total) {
  const clamped = Math.max(1, Math.min(9, total));
  const positions = LANDSCAPE_SEATS[clamped] || LANDSCAPE_SEATS[8];
  const idx = Math.max(0, Math.min(index - 1, positions.length - 1));
  const p = positions[idx];
  return { x: `${p.x}%`, y: `${p.y}%` };
}

function isPortraitMobile() {
  return window.innerWidth <= 768 && window.innerHeight > window.innerWidth;
}

function isCompactMobileLayout() {
  return isPortraitMobile() || isLandscape();
}

function seatPosition(index, total) {
  const landscape = isLandscape();
  const portrait = isPortraitMobile();
  const angle = Math.PI / 2 + ((index - 1) / total) * Math.PI * 2;
  let xR, yR;
  if (landscape) {
    return landscapeSeatPosition(index, total);
  } else if (portrait) {
    return portraitSeatPosition(index, total);
  } else if (window.innerWidth <= 768) {
    xR = total >= 8 ? 39 : 37;
    yR = total >= 8 ? 40 : 38;
  } else {
    xR = 41;
    yR = 37;
  }
  return { x: `${50 + Math.cos(angle) * xR}%`, y: `${50 - Math.sin(angle) * yR}%` };
}

function getTurnClock(hand) {
  if (!hand || !isActionStreet(hand.state) || !hand.action_seat) return null;
  const lastMs = hand.last_action_at ? Date.parse(hand.last_action_at) : NaN;
  if (!Number.isFinite(lastMs)) return getTurnClockSecs();
  return Math.max(0, getTurnClockSecs() - Math.floor((Date.now() - lastMs) / 1000));
}

// ============ EQUITY CALC ============
function calcEquity(hand, handPlayers) {
  const contenders = (handPlayers || [])
    .filter(hp => !hp.folded && Array.isArray(hp.hole_cards) && hp.hole_cards.length === 2)
    .map(hp => ({ seatNo: hp.seat_no, holeCards: hp.hole_cards.map(normCard).filter(Boolean) }))
    .filter(hp => hp.holeCards.length === 2);
  if (contenders.length < 2) return new Map();

  const boardKnown = (hand?.board_cards || []).map(normCard).filter(Boolean);
  const unknownCount = Math.max(0, 5 - boardKnown.length);
  const knownSet = new Set(boardKnown);
  for (const hp of handPlayers || []) {
    if (Array.isArray(hp.hole_cards)) hp.hole_cards.forEach(t => { const c = normCard(t); if (c) knownSet.add(c); });
  }
  const deck = FULL_DECK.filter(t => !knownSet.has(t));
  const eq = new Map(contenders.map(p => [p.seatNo, 0]));
  let trials = 0;

  const run = (board) => {
    const payouts = resolveShowdownPayouts({
      boardCards: board,
      players: contenders.map(p => ({ seatNo: p.seatNo, folded: false, committed: 1, holeCards: p.holeCards }))
    });
    for (const po of payouts) eq.set(po.seat_no, (eq.get(po.seat_no) || 0) + po.amount / contenders.length);
    trials++;
  };

  if (unknownCount === 0) { run(boardKnown); }
  else if (unknownCount <= 2) {
    for (let i = 0; i < deck.length; i++) {
      if (unknownCount === 1) { run([...boardKnown, deck[i]]); }
      else { for (let j = i + 1; j < deck.length; j++) run([...boardKnown, deck[i], deck[j]]); }
    }
  } else {
    for (let n = 0; n < 600; n++) {
      const shuffled = deck.slice();
      for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
      run([...boardKnown, ...shuffled.slice(0, unknownCount)]);
    }
  }

  const pct = new Map();
  for (const [seat, units] of eq) pct.set(seat, trials > 0 ? Number(((units / trials) * 100).toFixed(1)) : 0);
  return pct;
}

// ============ LOBBY ============
function initLobby() {
  setTableViewportLock(false);
  setTableBooting(false);
  state.pendingAction = false;
  resetActionAnnouncements();
  const savedName = localStorage.getItem("online_player_name") || "";
  if (savedName) el.lobbyName.value = savedName;
  el.lobbyTableName.value = randomTableName();

  if (isJoinMode()) {
    el.createFields.classList.add("hidden");
    el.lobbySubmit.textContent = "Join Table";
    el.joinInfo.classList.remove("hidden");
    loadJoinTableInfo();
  }

  el.lobbyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = el.lobbyName.value.trim();
    if (!name) { setLobbyStatus("Please enter your name.", "error"); return; }
    localStorage.setItem("online_player_name", name);
    el.lobbySubmit.disabled = true;
    setLobbyStatus("Connecting...");

    try {
      const identity = await online.ensureLobbyPlayer({ name });
      saveIdentity({ name, groupId: identity.group_id, groupPlayerId: identity.group_player_id });

      if (isJoinMode()) {
        await joinExistingTable(getUrlTableId());
      } else {
        await createAndJoinTable();
      }
    } catch (err) {
      setLobbyStatus(err.message || "Failed to connect.", "error");
      el.lobbySubmit.disabled = false;
    }
  });
}

async function loadJoinTableInfo() {
  try {
    const tableId = getUrlTableId();
    const info = await online.getTableInfo(tableId);
    if (info) {
      el.joinTableName.textContent = info.name;
      const seatedCount = await countSeated(tableId);
      el.joinTableDetail.textContent = `Blinds ${info.small_blind}/${info.big_blind} · ${seatedCount}/${info.max_seats} seated · Stack ${fmtShort(info.starting_stack)}`;
    } else {
      el.joinTableName.textContent = "Table not found";
    }
  } catch { /* ignore */ }
}

async function countSeated(tableId) {
  try {
    const { count } = await supabase
      .from("online_table_seats")
      .select("*", { count: "exact", head: true })
      .eq("table_id", tableId)
      .not("group_player_id", "is", null)
      .is("left_at", null);
    return count || 0;
  } catch { return 0; }
}

function setLobbyStatus(msg, type = "") {
  el.lobbyStatus.textContent = msg;
  el.lobbyStatus.className = `lobby-status${type ? ` ${type}` : ""}`;
}

async function createAndJoinTable() {
  const id = state.identity;
  const table = await online.createTable({
    groupId: id.groupId,
    name: el.lobbyTableName.value.trim() || randomTableName(),
    createdByGroupPlayerId: id.groupPlayerId,
    smallBlind: Number(el.lobbySB.value) || 1,
    bigBlind: Number(el.lobbyBB.value) || 2,
    maxSeats: Number(el.lobbySeats.value) || 6,
    startingStack: Number(el.lobbyStack.value) || 200,
  });

  const seat = await online.joinTable({
    tableId: table.id,
    groupPlayerId: id.groupPlayerId,
    preferredSeat: 1,
  });

  if (seat?.seat_token) setSeatToken(table.id, id.groupPlayerId, seat.seat_token);
  await requestMicrophonePermissionOnJoin();
  enterTable(table.id);
}

async function joinExistingTable(tableId) {
  const id = state.identity;
  let seat = null;
  try {
    seat = await online.joinTable({
      tableId,
      groupPlayerId: id.groupPlayerId,
    });
  } catch (err) {
    if (!isSeatClaimRequiredError(err)) throw err;
    seat = await online.claimTableSeat({
      tableId,
      groupPlayerId: id.groupPlayerId,
    });
  }
  if (seat?.seat_token) setSeatToken(tableId, id.groupPlayerId, seat.seat_token);
  await requestMicrophonePermissionOnJoin();
  enterTable(tableId);
}

async function tryRestoreExistingSeat(tableId, identity) {
  try {
    const seat = await online.claimTableSeat({
      tableId,
      groupPlayerId: identity.groupPlayerId,
    });
    if (!seat?.seat_token) return false;
    setSeatToken(tableId, identity.groupPlayerId, seat.seat_token);
    enterTable(tableId);
    return true;
  } catch (err) {
    if (isSeatAutoReclaimMiss(err)) return false;
    console.warn("Failed to auto-reclaim seat", err);
    return false;
  }
}

// ============ ENTER TABLE ============
function enterTable(tableId) {
  if (state.voiceConnected || state.voiceCall) {
    void disconnectVoice({ silent: true, destroy: true });
  }
  state.tableId = tableId;
  state.tableState = null;
  state.lastSyncAt = 0;
  state.landscapeRaisePanelOpen = false;
  state.pendingAction = false;
  prevHandState = null;
  prevActionSeat = null;
  resetActionAnnouncements();
  resetChatState();
  resetVoiceState();
  const url = new URL(window.location.href);
  url.searchParams.set("table", tableId);
  url.searchParams.delete("mode");
  url.searchParams.delete("player");
  url.searchParams.delete("host");
  url.searchParams.delete("group");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);

  el.lobby.classList.add("hidden");
  el.tableView.classList.remove("hidden");
  setTableViewportLock(true);
  syncLandscapeTopBar(true);
  setTableBooting(true, "Loading Table...");
  renderVoiceUi();
  renderChatUi();

  loadBotSeats();
  loadTableState();
  startRealtime(tableId);
  startPolling();
  startTurnTicker();
}

// ============ REALTIME ============
async function stopRealtime() {
  if (state.rtRefreshTimer) { clearTimeout(state.rtRefreshTimer); state.rtRefreshTimer = null; }
  state.rtRefreshQueued = false;
  if (state.realtimeChannel) {
    try { await supabase.removeChannel(state.realtimeChannel); } catch { /* ignore */ }
  }
  if (state.chatChannel) {
    try { await supabase.removeChannel(state.chatChannel); } catch { /* ignore */ }
  }
  state.realtimeChannel = null;
  state.realtimeHealthy = false;
  state.chatChannel = null;
  state.chatHealthy = false;
  renderChatUi();
}

function queueRtRefresh() {
  if (state.rtRefreshQueued) return;
  state.rtRefreshQueued = true;
  state.rtRefreshTimer = setTimeout(() => {
    state.rtRefreshQueued = false;
    state.rtRefreshTimer = null;
    if (!state.loading && state.tableId) loadTableState();
  }, REALTIME_DEBOUNCE_MS);
}

async function startRealtime(tableId) {
  if (!tableId) { await stopRealtime(); return; }
  if (state.realtimeChannel && state.realtimeHealthy && state.chatChannel && state.chatHealthy) return;
  await stopRealtime();

  const ch = supabase
    .channel(`table:${tableId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_tables", filter: `id=eq.${tableId}` }, queueRtRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_table_seats", filter: `table_id=eq.${tableId}` }, queueRtRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_table_voice_state", filter: `table_id=eq.${tableId}` }, queueRtRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_hands", filter: `table_id=eq.${tableId}` }, queueRtRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_hand_events", filter: `table_id=eq.${tableId}` }, queueRtRefresh);

  const chatCh = supabase
    .channel(`table-chat:${tableId}`, {
      config: {
        broadcast: {
          ack: true,
          self: false,
        },
      },
    })
    .on("broadcast", { event: "table_chat" }, ({ payload }) => {
      const payloadTableId = payload?.tableId || payload?.table_id || null;
      if (!payload || payloadTableId !== state.tableId) return;
      const selfPlayerId = payload?.playerId || payload?.player_id || null;
      const self = selfPlayerId && selfPlayerId === state.identity?.groupPlayerId;
      addChatMessage(payload, { self });
    });

  state.realtimeChannel = ch;
  state.realtimeHealthy = false;
  state.chatChannel = chatCh;
  state.chatHealthy = false;

  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") { state.realtimeHealthy = true; updateConnDot(); queueRtRefresh(); }
    else if (["TIMED_OUT","CHANNEL_ERROR","CLOSED"].includes(status)) { state.realtimeHealthy = false; updateConnDot(); }
  });

  chatCh.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      state.chatHealthy = true;
      renderChatUi();
    } else if (["TIMED_OUT","CHANNEL_ERROR","CLOSED"].includes(status)) {
      state.chatHealthy = false;
      renderChatUi();
    }
  });
}

function updateConnDot() {
  el.connDot.className = `connection-dot${state.realtimeHealthy ? "" : " error"}`;
}

// ============ POLLING ============
function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    if (state.loading || !state.tableId) return;
    maybeRuntimeTick();
    if (!state.realtimeHealthy || Date.now() - state.lastSyncAt > FALLBACK_STALE_MS) loadTableState();
  }, POLL_MS);
}

function startTurnTicker() {
  if (state.turnTimer) clearInterval(state.turnTimer);
  state.turnTimer = setInterval(() => {
    if (!state.tableState) return;
    updateTurnUI();
    updateTimerRings();
  }, 1000);
}

async function maybeRuntimeTick() {
  const hand = getLatestHand();
  if (!hand || !["preflop","flop","turn","river","showdown"].includes(hand.state)) return;
  if (!canManageHand()) return;
  if (state.runtimeTickBusy || Date.now() - state.runtimeTickLastAt < RUNTIME_TICK_MIN_MS) return;
  state.runtimeTickBusy = true;
  state.runtimeTickLastAt = Date.now();
  try {
    await online.runtimeTick({ tableId: state.tableId, limit: 24, maxAdvancePerHand: 3, actorGroupPlayerId: state.identity?.groupPlayerId || null });
  } catch { /* ignore */ }
  finally { state.runtimeTickBusy = false; }
}

// ============ LOAD STATE ============
let prevHandState = null;
let prevActionSeat = null;

async function loadTableState() {
  if (!state.tableId || state.loading) return;
  state.loading = true;
  try {
    const hadPriorTableState = Boolean(state.tableState);
    const ts = await online.getTableState({
      tableId: state.tableId,
      viewerGroupPlayerId: state.identity?.groupPlayerId || null,
      viewerSeatToken: getSeatToken() || null,
    });
    const oldHand = getLatestHand();
    const oldPotTotal = Number(oldHand?.pot_total || 0);
    state.tableState = ts;
    state.lastSyncAt = Date.now();
    state.pendingAction = false;
    if (state.tableBooting) setTableBooting(false);
    if (Array.isArray(ts?.chat_messages)) {
      applyServerChatHistory(ts.chat_messages);
    }
    const voiceState = getServerVoiceState();
    if (state.voiceSpeaking && voiceState.active && voiceState.speakerPlayerId && voiceState.speakerPlayerId !== state.identity?.groupPlayerId) {
      void stopPushToTalk({ skipRelease: true, silent: true });
    }
    if ((state.voiceConnected || state.voiceJoining) && !canUseVoice()) {
      void disconnectVoice({ silent: true, destroy: true });
    }

    const hand = getLatestHand();
    syncShowdownRevealState(hand);
    const newPotTotal = Number(hand?.pot_total || 0);
    if (!oldHand || hand?.id !== oldHand.id) {
      state.potVisual.handId = hand?.id || null;
      state.potVisual.chipCount = 0;
      state.potVisual.pulseUntil = 0;
      if (state.clearedPotHandId && hand?.id !== state.clearedPotHandId) {
        state.clearedPotHandId = null;
      }
    } else if (newPotTotal > oldPotTotal + 0.001) {
      state.potVisual.pulseUntil = Date.now() + POT_BUMP_MS;
    }
    syncActionAnnouncements({ hadPriorTableState, oldHandId: oldHand?.id || null });
    maybeStartDealAnimation(oldHand, hand, hadPriorTableState);
    maybeStartStreetRevealAnimation(oldHand, hand, hadPriorTableState);
    if (hand && oldHand) {
      if (oldHand.state !== "settled" && hand.state === "settled") {
        handleSettlement(hand);
      }
      if (hand.action_seat && hand.action_seat !== prevActionSeat) {
        const myHp = getMyHandPlayer();
        if (myHp && hand.action_seat === myHp.seat_no && getSeatToken()) {
          sounds.yourTurn();
          toast("Your turn!");
        }
      }
    }
    prevHandState = hand?.state || null;
    prevActionSeat = hand?.action_seat || null;
    trackOpponentActions();

    if (state.config.autoDeal && hand && ["settled","canceled"].includes(hand.state) && !state.autoDealTimer && canManageHand()) {
      const seated = getSeats().filter(s => s.group_player_id && !s.left_at).length;
      if (seated >= 2) scheduleAutoDeal();
    }

    renderAll();
    checkBotTurn();
  } catch (err) {
    console.error("[loadTableState]", err);
    if (state.pendingAction) {
      state.pendingAction = false;
      renderActions();
    }
    if (state.tableBooting) {
      setTableBooting(true, "Reconnecting...");
    }
  } finally {
    state.loading = false;
  }
}

function getShowdownTimeMs() { return state.config.showdownTime || 5000; }

function handleSettlement(hand) {
  const showdownLeaderSeats = new Set(getShowdownLeaders(hand).map(({ player }) => player.seat_no));
  const winners = getHandPlayers().filter(p => Number(p.result_amount || 0) > 0);
  for (const w of winners) {
    state.winOverlays.set(w.seat_no, {
      amount: w.result_amount,
      until: Date.now() + getShowdownTimeMs(),
      isShowdownLeader: showdownLeaderSeats.size ? showdownLeaderSeats.has(w.seat_no) : true,
    });
  }
  state.potPushAnimation = winners.length ? {
    handId: hand.id,
    winners: winners.map((w) => ({ seatNo: w.seat_no, amount: Number(w.result_amount || 0) })),
    launched: false,
    cleanupTimer: null,
  } : null;
  if (winners.length > 0) sounds.win();
  if (state.config.autoDeal) scheduleAutoDeal();
}

function scheduleAutoDeal() {
  if (state.autoDealTimer) clearTimeout(state.autoDealTimer);
  state.autoDealTimer = setTimeout(() => {
    state.autoDealTimer = null;
    tryAutoDeal();
  }, getShowdownTimeMs());
}

async function tryAutoDeal() {
  if (!canManageHand()) return;
  const hand = getLatestHand();
  if (hand && !["settled","canceled"].includes(hand.state)) return;
  const seated = getSeats().filter(s => s.group_player_id && !s.left_at).length;
  if (seated < 2) return;

  // Auto-rebuy busted bots (max 5 rebuys per bot, then they leave)
  const botsToRemove = [];
  for (const [seatNo, botInfo] of state.botSeats) {
    const seat = getSeats().find(s => s.seat_no === seatNo && s.group_player_id && !s.left_at);
    if (seat && Number(seat.chip_stack || 0) <= 0) {
      const rebuys = botInfo.rebuyCount || 0;
      if (rebuys >= 5) {
        botsToRemove.push(seatNo);
    } else {
        try {
          await online.rebuyChips({ tableId: state.tableId, groupPlayerId: botInfo.groupPlayerId, seatToken: botInfo.seatToken });
          botInfo.rebuyCount = rebuys + 1;
          saveBotSeats();
        } catch { /* ignore */ }
      }
    }
  }
  for (const seatNo of botsToRemove) {
    await removeBot(seatNo);
    toast(`Bot at seat ${seatNo} left after 5 rebuys`);
  }

  // Refresh state after bot rebuys/removals to get accurate chip counts
  await loadTableState();
  const freshSeated = getSeats().filter(s => s.group_player_id && !s.left_at).length;
  const freshBusted = getSeats().filter(s => s.group_player_id && !s.left_at && Number(s.chip_stack || 0) <= 0).length;
  if (freshSeated - freshBusted < 2) return;

  try {
    sounds.deal();
    await online.startHand({
      tableId: state.tableId,
      startedByGroupPlayerId: state.identity.groupPlayerId,
      hostSeatToken: getSeatToken(),
    });
    await loadTableState();
  } catch {
    // If auto-deal fails (e.g. another client already started), just refresh
    await loadTableState();
  }
}

// ============ OPPONENT TRACKING ============
function trackOpponentActions() {
  const events = getHandEvents();
  if (!events.length) return;
  const tracker = state.opponentTracker;

  for (const ev of events) {
    if (ev.seq <= state.lastTrackedEventSeq) continue;
    state.lastTrackedEventSeq = ev.seq;

    const actorId = ev.actor_group_player_id;
    if (!actorId) continue;
    if (state.botSeats.size > 0) {
      let isBot = false;
      for (const [, b] of state.botSeats) { if (b.groupPlayerId === actorId) { isBot = true; break; } }
      if (isBot) continue;
    }

    const p = ev.payload || {};
    if (ev.event_type === "hand_started") {
      const handPlayers = getHandPlayers();
      for (const hp of handPlayers) {
        if (hp.group_player_id) tracker.recordHandStart(hp.group_player_id);
      }
    } else if (ev.event_type === "action_taken") {
      const street = p.street || "";
      const action = p.action_type || "";
      const facingBet = Number(p.to_call_before || 0) > 0;
      if (street === "preflop") {
        tracker.recordPreflopAction(actorId, action);
    } else {
        tracker.recordPostflopAction(actorId, action, facingBet);
      }
    }
  }
}

function getPrimaryOpponentProfile() {
  const me = state.identity?.groupPlayerId;
  const seats = getSeats().filter(s => s.group_player_id && !s.left_at && s.group_player_id !== me);
  const humans = seats.filter(s => {
    for (const [, b] of state.botSeats) { if (b.groupPlayerId === s.group_player_id) return false; }
    return true;
  });
  if (humans.length === 0) return null;
  return state.opponentTracker.getProfile(humans[0].group_player_id);
}

// ============ CONFIG PANEL ============
function openConfigPanel() {
  const table = getTable();
  if (el.cfgSB) el.cfgSB.value = table?.small_blind || 1;
  if (el.cfgBB) el.cfgBB.value = table?.big_blind || 2;
  if (el.cfgTurnTime) el.cfgTurnTime.value = state.config.turnTime;

  const isHost = canManageHand();
  if (el.cfgSB) el.cfgSB.disabled = !isHost;
  if (el.cfgBB) el.cfgBB.disabled = !isHost;
  if (el.cfgSaveGame) el.cfgSaveGame.style.display = isHost ? "" : "none";

  el.configOverlay.classList.remove("hidden");
}

function closeConfigPanel() {
  el.configOverlay.classList.add("hidden");
}

function setToggle(activeId, inactiveId) {
  document.getElementById(activeId)?.classList.add("active");
  document.getElementById(inactiveId)?.classList.remove("active");
}

// ============ SHOWDOWN HELPERS ============
function getLastAggressor(hand) {
  if (!hand) return null;
  const events = getHandEvents();
  let lastAgg = null;
  for (const ev of events) {
    if (ev.event_type === "action_taken") {
      const action = ev.payload?.action_type;
      if (action === "bet" || action === "raise" || action === "all_in") {
        const seatNo = ev.payload?.seat_no;
        if (seatNo) lastAgg = seatNo;
      }
    }
  }
  return lastAgg;
}

// ============ REBUY ============
async function doRebuy() {
  const token = getSeatToken();
  if (!token) { toast("Not seated.", "error"); return; }
  try {
    await online.rebuyChips({
      tableId: state.tableId,
      groupPlayerId: state.identity.groupPlayerId,
      seatToken: token,
    });
    toast("Chips added!", "success");
    await loadTableState();
  } catch (err) {
    toast(err.message || "Rebuy failed", "error");
  }
}

// ============ BOT MANAGEMENT ============
function isBotSeat(seatNo) {
  return state.botSeats.has(seatNo);
}

function getBotInfo(seatNo) {
  return state.botSeats.get(seatNo) || null;
}

async function addBot(seatNo) {
  if (!canManageHand()) { toast("Only the host can add bots.", "error"); return; }
  const personality = randomPersonality();
  const name = `Bot ${randomBotName()}`;

  try {
    const identity = await online.ensureLobbyPlayer({ name });
    const seat = await online.joinTable({
      tableId: state.tableId,
      groupPlayerId: identity.group_player_id,
      preferredSeat: seatNo,
      isBot: true,
    });

    if (seat?.seat_token) {
      state.botSeats.set(seat.seat_no, {
        groupPlayerId: identity.group_player_id,
        seatToken: seat.seat_token,
        personality,
        name,
      });
      saveBotSeats();
      toast(`${name} (${personalityLabel(personality)}) joined seat ${seat.seat_no}`, "success");
    }
    await loadTableState();
  } catch (err) {
    toast(err.message || "Failed to add bot", "error");
  }
}

async function removeBot(seatNo) {
  const bot = state.botSeats.get(seatNo);
  if (!bot) return;
  try {
    await online.leaveTable({
      tableId: state.tableId,
      groupPlayerId: bot.groupPlayerId,
      seatToken: bot.seatToken,
    });
  } catch { /* seat may already be gone */ }
  state.botSeats.delete(seatNo);
  saveBotSeats();
  await loadTableState();
}

async function removeAllBots() {
  const entries = [...state.botSeats.entries()];
  for (const [seatNo] of entries) {
    await removeBot(seatNo);
  }
  toast("All bots removed", "success");
}

function saveBotSeats() {
  if (!state.tableId) return;
  const data = {};
  for (const [seatNo, info] of state.botSeats) {
    data[seatNo] = info;
  }
  localStorage.setItem(`online_bots:${state.tableId}`, JSON.stringify(data));
}

function loadBotSeats() {
  if (!state.tableId) return;
  try {
    const raw = localStorage.getItem(`online_bots:${state.tableId}`);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.botSeats.clear();
    for (const [seatNo, info] of Object.entries(data)) {
      state.botSeats.set(Number(seatNo), info);
    }
  } catch { /* ignore */ }
}

function checkBotTurn() {
  if (state.botActionTimer) return;
  const hand = getLatestHand();
  if (!hand || !isActionStreet(hand.state) || !hand.action_seat) return;

  const botInfo = getBotInfo(hand.action_seat);
  if (!botInfo) return;

  const hp = getHandPlayers().find(p => p.seat_no === hand.action_seat);
  if (!hp || hp.folded || hp.all_in) return;

  const delay = thinkTimeMs({
    street: hand.state,
    toCall: Math.max(0, Number(hand.current_bet || 0) - Number(hp.street_contribution || 0)),
    pot: Number(hand.pot_total || 0),
    currentBet: Number(hand.current_bet || 0),
    activeSeatCount: getHandPlayers().filter((player) => !player.folded).length,
  });
  state.botActionTimer = setTimeout(async () => {
    state.botActionTimer = null;
    const freshHand = getLatestHand();
    if (!freshHand || freshHand.action_seat !== hand.action_seat) return;

    const freshHp = getHandPlayers().find(p => p.seat_no === freshHand.action_seat);
    if (!freshHp || freshHp.folded || freshHp.all_in) return;

    const table = getTable();
    const activePlayers = getHandPlayers().filter(p => !p.folded).length;
    const wasAggressor = botInfo._wasAggressor || false;
    const opProfile = getPrimaryOpponentProfile();

    const decision = botDecide({
      personality: botInfo.personality,
      holeCards: freshHp.hole_cards || [],
      boardCards: freshHand.board_cards || [],
      pot: Number(freshHand.pot_total || 0),
      currentBet: Number(freshHand.current_bet || 0),
      streetContribution: Number(freshHp.street_contribution || 0),
      stackEnd: Number(freshHp.stack_end || 0),
      bigBlind: Number(table?.big_blind || 2),
      street: freshHand.state,
      seatNo: freshHp.seat_no,
      buttonSeat: freshHand.button_seat,
      totalSeats: table?.max_seats || 6,
      activeSeatCount: activePlayers,
      wasAggressor,
      opponentProfile: opProfile,
    });

    if (decision.actionType === "raise" || decision.actionType === "bet") {
      botInfo._wasAggressor = true;
    }
    if (freshHand.state === "preflop" && (decision.actionType === "raise" || decision.actionType === "all_in")) {
      botInfo._wasAggressor = true;
    }

    try {
      await online.submitAction({
        handId: freshHand.id,
        actorGroupPlayerId: botInfo.groupPlayerId,
        actionType: decision.actionType,
        amount: decision.amount,
        clientActionId: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        seatToken: botInfo.seatToken,
      });
    } catch (err) {
      console.warn("[bot-action]", err?.message || err);
    }
  await loadTableState();
  }, delay);
}

// ============ RENDER ============
function renderAll() {
  renderTopBar();
  renderBoard();
  renderSeats();
  renderMyHand();
  renderActions();
  renderHandLog();
  renderVoiceUi();
  renderChatUi();
  maybeLaunchPotPushFx();
  maybeLaunchDealFx();
  maybeLaunchStreetRevealFx();
  updateTurnUI();
}

function renderTopBar() {
  const table = getTable();
  if (!table && state.tableBooting) {
    el.tbTitle.textContent = "";
    el.tbBlinds.textContent = "";
    el.tbPlayers.textContent = "";
    el.removeBotsBtn.style.display = "none";
    return;
  }
  el.tbTitle.textContent = table?.name || "Online Table";
  el.tbBlinds.textContent = table ? `${table.small_blind}/${table.big_blind}` : "";
  const seated = getSeats().filter(s => s.group_player_id && !s.left_at).length;
  el.tbPlayers.textContent = `${seated} seated`;
  el.removeBotsBtn.style.display = (canManageHand() && state.botSeats.size > 0) ? "" : "none";
}

function renderBoard() {
  const hand = getLatestHand();
  const players = getHandPlayers();
  const board = Array.isArray(hand?.board_cards) ? hand.board_cards : [];
  const showdownLeaders = getShowdownLeaders(hand, players);
  const uncontestedWinner = getUncontestedWinner(hand, players);
  const contestedShowdown = isContestedShowdown(hand, players);
  const payoutActive = Boolean(state.potPushAnimation?.handId === hand?.id && state.potPushAnimation?.launched);
  const clearedPot = Boolean(hand?.id && state.clearedPotHandId === hand.id);
  const potTotal = (payoutActive || clearedPot) ? 0 : Number(hand?.pot_total || 0);
  const bigBlind = Math.max(0.01, Number(getTable()?.big_blind || 1));
  const potBb = potTotal / bigBlind;
  const allInMode = Boolean(
    hand && (
      hand.state === "allin_progress" ||
      getHandPlayers().some((hp) => !hp.folded && hp.all_in)
    )
  );

  if (el.potAmount) el.potAmount.textContent = fmtShort(potTotal);
  renderPotChips(potTotal, bigBlind, hand?.id || null);
  if (el.potDisplay) {
    let potState = "idle";
    if (potTotal > 0) {
      if (allInMode || potBb >= 24) potState = "monster";
      else if (potBb >= 10) potState = "hot";
      else potState = "live";
    }
    el.potDisplay.dataset.state = potState;
    el.potDisplay.classList.toggle("pot-bump", Date.now() < state.potVisual.pulseUntil);
    el.potDisplay.classList.toggle("pot-cleared", payoutActive || clearedPot);
  }
  if (el.tableSurface) {
    el.tableSurface.classList.toggle("all-in-mode", allInMode);
    el.tableSurface.classList.toggle("showdown-mode", contestedShowdown);
  }
  el.streetLabel.textContent = hand ? (hand.state || "waiting").toUpperCase() : "WAITING";

  el.boardCards.innerHTML = "";
  for (let i = 0; i < 5; i++) {
    if (board[i]) {
      const card = makeCardEl(board[i], false);
      const revealMeta = getStreetRevealMeta(i, hand);
      if (revealMeta) {
        card.classList.add("board-deal-target", "board-card-hidden");
        if (revealMeta.showUnderlay) card.classList.add("board-card-settling");
        card.dataset.boardIndex = String(i);
      }
      el.boardCards.appendChild(card);
    } else {
      const empty = document.createElement("div");
      empty.className = "card card-empty";
      el.boardCards.appendChild(empty);
    }
  }

  const winReasonEl = el.winReason;
  if (winReasonEl) {
    if (uncontestedWinner) {
      winReasonEl.textContent = `${seatName(uncontestedWinner.group_player_id)} wins the pot`;
    } else if (contestedShowdown) {
      if (showdownLeaders.length > 0) {
        const label = showdownLeaders[0].desc?.label || "";
        if (showdownLeaders.length === 1) {
          const winnerName = seatName(showdownLeaders[0].player.group_player_id);
          winReasonEl.textContent = label ? `${winnerName} wins with ${label}` : `${winnerName} wins`;
        } else {
          const winnerNames = showdownLeaders.map(({ player }) => seatName(player.group_player_id)).join(" & ");
          winReasonEl.textContent = label ? `${winnerNames} split with ${label}` : `${winnerNames} split the pot`;
        }
      } else {
        winReasonEl.textContent = "";
      }
    } else {
      winReasonEl.textContent = "";
    }
    winReasonEl.classList.toggle("has-result", Boolean(winReasonEl.textContent));
  }
}

function renderSeats() {
  const seats = getSeats().slice().sort((a, b) => a.seat_no - b.seat_no);
  const hand = getLatestHand();
  const handPlayers = getHandPlayers();
  const hpBySeat = new Map(handPlayers.map(hp => [hp.seat_no, hp]));
  const mySeat = getMySeat();
  const showEquity = hand && isActionStreet(hand.state) && handPlayers.some(hp => !hp.folded && hp.all_in);

  let equityMap = new Map();
  if (showEquity) {
    const key = `${hand.id}|${hand.state}|${JSON.stringify(hand.board_cards)}`;
    if (key !== state.equityCacheKey) {
      state.equityCache = calcEquity(hand, handPlayers);
      state.equityCacheKey = key;
    }
    equityMap = state.equityCache;
  }

  el.seatsLayer.innerHTML = "";
  const total = seats.length;
  const portrait = isPortraitMobile();
  const compactMobile = isCompactMobileLayout();
  const contestedShowdown = isContestedShowdown(hand, handPlayers);
  const showdownLeaderSeats = new Set(getShowdownLeaders(hand, handPlayers).map(({ player }) => player.seat_no));
  const activeVoiceSpeakerId = getServerVoiceState().speakerPlayerId;

  const tableSeats = compactMobile && mySeat ? seats.filter(s => s.seat_no !== mySeat.seat_no) : seats;
  const tableTotal = tableSeats.length;

  const bottomIdx = Math.floor(total / 2);
  let rotateOffset = 0;
  if (!compactMobile && mySeat) {
    const myIdx = seats.findIndex(s => s.seat_no === mySeat.seat_no);
    if (myIdx >= 0) rotateOffset = bottomIdx - myIdx;
  }

  tableSeats.forEach((seat, idx) => {
    const posIdx = compactMobile ? idx : ((seats.indexOf(seat) + rotateOffset) % total + total) % total;
    const posTotal = compactMobile ? tableTotal : total;
    const pos = seatPosition(posIdx + 1, posTotal);
    const hp = hpBySeat.get(seat.seat_no);
    const occupied = seat.group_player_id && !seat.left_at;
    const pid = occupied ? seat.group_player_id : null;
    const empty = !pid;
    const isTurn = hand && hand.action_seat === seat.seat_no;
    const isFolded = hp?.folded;
    const isAllIn = hp?.all_in;

    const node = document.createElement("div");
    node.className = "seat-node";
    node.dataset.seatNo = String(seat.seat_no);
    node.style.setProperty("--x", pos.x);
    node.style.setProperty("--y", pos.y);

    if (empty) {
      node.classList.add("empty");
      const canAddBotToSeat = canManageHand();
      if (canAddBotToSeat && state.selectedSeatNo === seat.seat_no) node.classList.add("selected");
      const label = document.createElement("span");
      label.className = "seat-empty-label";
      label.textContent = "OPEN";
      node.appendChild(label);
      if (!canAddBotToSeat) {
        node.style.cursor = "default";
      } else {
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          if (state.selectedSeatNo === seat.seat_no) {
            state.selectedSeatNo = null;
            renderSeats();
            return;
          }
          state.selectedSeatNo = seat.seat_no;
          renderSeats();
        });
      }

      if (canAddBotToSeat && state.selectedSeatNo === seat.seat_no) {
        const popover = document.createElement("div");
        popover.className = "seat-popover";
        const botBtn = document.createElement("button");
        botBtn.className = "pop-bot";
        botBtn.textContent = "Add Bot";
        botBtn.addEventListener("click", (e) => { e.stopPropagation(); addBot(seat.seat_no); state.selectedSeatNo = null; });
        popover.appendChild(botBtn);
        node.appendChild(popover);
      }
    } else {
      const isBot = isBotSeat(seat.seat_no);
      if (isBot) node.classList.add("bot-seat");
      if (isTurn) node.classList.add("active-turn");
      if (isFolded) node.classList.add("folded");
      if (activeVoiceSpeakerId && pid === activeVoiceSpeakerId) node.classList.add("voice-speaking");

      const botInfo = getBotInfo(seat.seat_no);
      const displayName = botInfo ? botInfo.name : seatName(pid);
      const color = SEAT_COLORS[(seat.seat_no - 1) % SEAT_COLORS.length];
      const avatarEl = document.createElement("div");
      avatarEl.className = "seat-avatar";
      applyAvatarTheme(avatarEl, {
        seed: `${pid || seat.player_name || displayName}:${seat.seat_no}`,
        name: displayName,
        isBot,
      });
      node.appendChild(avatarEl);

      const header = document.createElement("div");
      header.className = "seat-header";

      const nameEl = document.createElement("span");
      nameEl.className = "seat-name";
      nameEl.textContent = displayName;
      if (isBot) nameEl.style.color = "#a78bfa";
      else nameEl.style.color = color;

      const roleBadges = document.createElement("div");
      roleBadges.className = "seat-role-badges";

      // Inline dealer button
      if (hand && hand.button_seat === seat.seat_no) {
        const dChip = document.createElement("span");
        dChip.className = "seat-dealer-dot";
        dChip.textContent = "D";
        roleBadges.appendChild(dChip);
      }

      // SB/BB label
      if (hand) {
        if (hand.small_blind_seat === seat.seat_no) {
          const lbl = document.createElement("span");
          lbl.className = "seat-pos-label";
          lbl.textContent = "SB";
          roleBadges.appendChild(lbl);
        } else if (hand.big_blind_seat === seat.seat_no) {
          const lbl = document.createElement("span");
          lbl.className = "seat-pos-label";
          lbl.textContent = "BB";
          roleBadges.appendChild(lbl);
        }
      }

      header.append(nameEl);
      if (roleBadges.childElementCount) header.append(roleBadges);
      node.appendChild(header);

      const stackEl = document.createElement("div");
      stackEl.className = "seat-stack";
      const displayStack = (hp && hp.stack_end != null) ? hp.stack_end : seat.chip_stack;
      stackEl.textContent = fmtShort(displayStack);
      node.appendChild(stackEl);

      if (botInfo) {
        const botTag = document.createElement("div");
        botTag.className = "bot-label";
        botTag.textContent = `AI · ${personalityLabel(botInfo.personality)}`;
        node.appendChild(botTag);
      }

      // Visual cues instead of text badges
      if (isAllIn) node.classList.add("allin-seat");

      const isMe = pid === state.identity?.groupPlayerId;
      if (isMe) node.classList.add("my-seat");

      const holeCards = Array.isArray(hp?.hole_cards) ? hp.hole_cards : [];
      const hasHoleCards = holeCards.length >= 2;
      const shouldRenderHeldCards = Boolean(
        hp && (
          hasHoleCards ||
          (hand && !["settled", "canceled"].includes(hand.state))
        )
      );

      if (shouldRenderHeldCards) {
        const isShowdown = contestedShowdown;
        let reveal = isMe;
        if (isShowdown && !isFolded) {
          const isWinner = showdownLeaderSeats.has(seat.seat_no);
          const isAggressor = getLastAggressor(hand) === seat.seat_no;
          reveal = isMe || isWinner || isAggressor;
        }
        const animateShowdownReveal = isShowdown && reveal && !isMe && consumeShowdownReveal(seat.seat_no, hand);

        if (compactMobile && !isMe) {
          const cards = document.createElement("div");
          cards.className = "seat-cards-row compact-opponent";
          if (reveal) cards.classList.add("showdown");
          if (animateShowdownReveal) cards.classList.add("showdown-fresh");
          if (isShowdown && reveal) {
            const px = parseFloat(pos.x);
            const py = parseFloat(pos.y);
            const anchor = py <= 10 ? "top" : (px < 50 ? "left" : "right");
            cards.classList.add(`compact-opponent--${anchor}`);
          }
          const firstCard = markDealCardTarget(makeCardEl(holeCards[0] || null, !hasHoleCards || !reveal, false), seat.seat_no, 1, hand, -10);
          const secondCard = markDealCardTarget(makeCardEl(holeCards[1] || null, !hasHoleCards || !reveal, false), seat.seat_no, 2, hand, 9);
          cards.append(firstCard, secondCard);
          node.appendChild(cards);
        } else {
          const cards = document.createElement("div");
          cards.className = "seat-cards-row";
          if (isShowdown && reveal && !isMe) cards.classList.add("showdown");
          if (animateShowdownReveal) cards.classList.add("showdown-fresh");
          if (isMe && reveal) {
            cards.appendChild(markDealCardTarget(makeCardEl(holeCards[0] || null, false, false, true), seat.seat_no, 1, hand, -9));
            cards.appendChild(markDealCardTarget(makeCardEl(holeCards[1] || null, false, false, true), seat.seat_no, 2, hand, 8));
          } else {
            cards.appendChild(markDealCardTarget(makeCardEl(holeCards[0] || null, !hasHoleCards || !reveal, true), seat.seat_no, 1, hand, -7));
            cards.appendChild(markDealCardTarget(makeCardEl(holeCards[1] || null, !hasHoleCards || !reveal, true), seat.seat_no, 2, hand, 6));
          }
          node.appendChild(cards);
        }
      }

      if (showEquity && !isFolded) {
        const eq = equityMap.get(seat.seat_no);
        if (Number.isFinite(eq)) {
          const eqEl = document.createElement("div");
          eqEl.style.cssText = "font-size:10px;font-weight:700;color:rgba(255,255,255,0.7);text-align:center;";
          eqEl.textContent = `${eq}%`;
          node.appendChild(eqEl);
        }
      }

      if (isTurn) {
        const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        ring.setAttribute("class", "seat-timer-ring");
        ring.setAttribute("viewBox", "0 0 24 24");
        const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        bg.setAttribute("class", "seat-timer-bg");
        bg.setAttribute("cx", "12"); bg.setAttribute("cy", "12"); bg.setAttribute("r", "10");
        const fg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        fg.setAttribute("class", "seat-timer-fg");
        fg.setAttribute("cx", "12"); fg.setAttribute("cy", "12"); fg.setAttribute("r", "10");
        fg.setAttribute("data-seat", seat.seat_no);
        const circ = 2 * Math.PI * 10;
        fg.style.strokeDasharray = `${circ}`;
        const remaining = getTurnClock(hand);
        const frac = remaining != null ? remaining / getTurnClockSecs() : 1;
        fg.style.strokeDashoffset = `${circ * (1 - frac)}`;
        if (remaining != null && remaining <= 5) fg.classList.add("danger");
        else if (remaining != null && remaining <= 10) fg.classList.add("warn");
        ring.append(bg, fg);
        node.appendChild(ring);
      }

      const winData = state.winOverlays.get(seat.seat_no);
      if (winData && Date.now() < winData.until) {
        if (winData.isShowdownLeader !== false) node.classList.add("winner-seat");
        const winAmt = document.createElement("div");
        winAmt.className = "seat-win-amount";
        winAmt.textContent = `+${fmtShort(winData.amount)}`;
        node.appendChild(winAmt);
      }

      if (hp && !isFolded && hp.street_contribution > 0) {
        const betEl = document.createElement("div");
        betEl.className = "seat-bet";
        betEl.textContent = fmtShort(hp.street_contribution);
        const px = parseFloat(pos.x);
        const py = parseFloat(pos.y);
        // Position bet chip toward center of table from seat
        const cx = 50, cy = 50;
        const dx = (cx - px) * 0.35;
        const dy = (cy - py) * 0.35;
        betEl.style.left = `${px + dx}%`;
        betEl.style.top = `${py + dy}%`;
        betEl.style.transform = "translate(-50%, -50%)";
        betEl.style.position = "absolute";
        el.seatsLayer.appendChild(betEl);
      }

      // Rebuy button below player's own seat
      if (isMe) {
        const tbl = getTable();
        const seatStk = Number(seat.chip_stack || 0);
        const stk = Number((hp && hp.stack_end != null) ? hp.stack_end : seatStk || 0);
        const startStk = Number(tbl?.starting_stack || 200);
        const cta = getStackCtaState({
          hand,
          handPlayer: hp,
          stack: stk,
          seatStack: seatStk,
          startingStack: startStk,
        });
        if (cta.kind !== "none") {
          const rbBtn = document.createElement("button");
          rbBtn.type = "button";
          rbBtn.className = `seat-rebuy-btn${cta.kind === "status" ? " seat-status-chip" : ""}`;
          rbBtn.textContent = cta.text;
          if (cta.kind === "action") {
            rbBtn.addEventListener("click", (e) => { e.stopPropagation(); doRebuy(); });
          } else {
            rbBtn.disabled = true;
          }
          node.appendChild(rbBtn);
        }
      }
    }

    el.seatsLayer.appendChild(node);
  });

  for (const [seatNo, data] of state.winOverlays) {
    if (Date.now() >= data.until) state.winOverlays.delete(seatNo);
  }

}

function renderMyHand() {
  const nameEl = document.getElementById("myHandName");
  const stackEl = document.getElementById("myHandStack");
  const badgesEl = document.getElementById("myHandBadges");
  if (!el.myHandCards || !nameEl) return;
  el.myHandCards.innerHTML = "";
  if (badgesEl) badgesEl.innerHTML = "";
  el.myHandArea?.classList.add("no-hole-cards");

  const hand = getLatestHand();
  const hp = getMyHandPlayer();
  const mySeat = getMySeat();
  if (!mySeat) {
    el.myHandArea?.classList.remove("voice-speaking");
    return;
  }
  const activeVoiceSpeakerId = getServerVoiceState().speakerPlayerId;

  nameEl.textContent = state.identity?.name || "You";
  const displayStack = (hp && hp.stack_end != null) ? hp.stack_end : mySeat.chip_stack;
  stackEl.textContent = fmtShort(displayStack);
  el.myHandArea?.classList.toggle("voice-speaking", Boolean(activeVoiceSpeakerId && mySeat.group_player_id === activeVoiceSpeakerId));
  applyAvatarTheme(el.myHandAvatar, {
    seed: `${state.identity?.groupPlayerId || mySeat.group_player_id || mySeat.seat_no}:${state.identity?.name || "You"}`,
    name: state.identity?.name || "You",
    isBot: false,
  });

  if (hand && badgesEl) {
    if (hand.button_seat === mySeat.seat_no) {
      const d = document.createElement("span");
      d.className = "seat-dealer-dot";
      d.textContent = "D";
      badgesEl.appendChild(d);
    }
    if (hand.small_blind_seat === mySeat.seat_no) {
      const lbl = document.createElement("span");
      lbl.className = "seat-pos-label";
      lbl.textContent = "SB";
      badgesEl.appendChild(lbl);
    } else if (hand.big_blind_seat === mySeat.seat_no) {
      const lbl = document.createElement("span");
      lbl.className = "seat-pos-label";
      lbl.textContent = "BB";
      badgesEl.appendChild(lbl);
    }
  }

  const visibleHoleCards = Array.isArray(hp?.hole_cards)
    ? hp.hole_cards.map(normCard).filter(Boolean)
    : [];
  const hasHoleCards = visibleHoleCards.length >= 2;
  if (hasHoleCards) {
    el.myHandArea?.classList.remove("no-hole-cards");
    const useMyHandTargets = isPortraitMobile();
    const firstCard = makeCardEl(visibleHoleCards[0], false, false, false);
    const secondCard = makeCardEl(visibleHoleCards[1], false, false, false);
    el.myHandCards.appendChild(useMyHandTargets ? markDealCardTarget(firstCard, mySeat.seat_no, 1, hand, -9) : firstCard);
    el.myHandCards.appendChild(useMyHandTargets ? markDealCardTarget(secondCard, mySeat.seat_no, 2, hand, 8) : secondCard);
  }

  // Rebuy button in my-hand area -- create once, show/hide
  let rbBtn = el.myHandArea.querySelector(".my-hand-rebuy");
  if (!rbBtn) {
    rbBtn = document.createElement("button");
    rbBtn.className = "seat-rebuy-btn my-hand-rebuy";
    rbBtn.style.cssText = "position:static;transform:none;margin-top:4px;";
    rbBtn.addEventListener("click", (e) => { e.stopPropagation(); doRebuy(); });
    el.myHandArea.querySelector(".my-hand-nameplate")?.appendChild(rbBtn);
  }

  const tbl = getTable();
  const seatStk = Number(mySeat.chip_stack || 0);
  const stk = Number(displayStack || 0);
  const startStk = Number(tbl?.starting_stack || 200);
  const cta = getStackCtaState({
    hand,
    handPlayer: hp,
    stack: stk,
    seatStack: seatStk,
    startingStack: startStk,
  });

  rbBtn.textContent = cta.text;
  rbBtn.classList.toggle("seat-status-chip", cta.kind === "status");
  rbBtn.disabled = cta.kind !== "action";
  rbBtn.style.display = cta.kind === "none" ? "none" : "";
}

function updateTimerRings() {
  const hand = getLatestHand();
  if (!hand || !hand.action_seat) return;
  const remaining = getTurnClock(hand);
  const frac = remaining != null ? remaining / getTurnClockSecs() : 1;
  const circ = 2 * Math.PI * 10;
  const fgs = el.seatsLayer.querySelectorAll(".seat-timer-fg");
  fgs.forEach(fg => {
    fg.style.strokeDashoffset = `${circ * (1 - frac)}`;
    fg.classList.remove("warn", "danger");
    if (remaining != null && remaining <= 5) { fg.classList.add("danger"); sounds.tick(); }
    else if (remaining != null && remaining <= 10) fg.classList.add("warn");
  });
}

function renderActions() {
  const hand = getLatestHand();
  const hp = getMyHandPlayer();
  const token = getSeatToken();
  const isHost = canManageHand();
  const compactActions = isLandscapeCollapseMode() || isPortraitCollapseMode();
  const actionLocked = state.pendingAction;

  const myTurn = hand && isActionStreet(hand.state) && token && hp && !hp.folded && !hp.all_in && hand.action_seat === hp.seat_no && !actionLocked;
  const noActiveHand = !hand || ["settled","canceled"].includes(hand.state);
  el.tableView.classList.toggle("landscape-actions-visible", Boolean(myTurn));
  el.tableView.classList.toggle("landscape-vertical-actions", compactActions);

  const autoDealPending = Boolean(state.autoDealTimer);
  const hasWinOverlays = state.winOverlays.size > 0 && [...state.winOverlays.values()].some(d => Date.now() < d.until);
  if (autoDealPending && noActiveHand && hasWinOverlays) {
    el.startHandBtn.classList.add("hidden");
  } else if (autoDealPending && noActiveHand) {
    el.startHandBtn.classList.remove("hidden");
    el.startHandBtn.disabled = true;
    el.startHandBtn.textContent = "Dealing...";
  } else if (isHost && noActiveHand) {
    el.startHandBtn.classList.remove("hidden");
    el.startHandBtn.disabled = false;
    el.startHandBtn.textContent = "Deal";
  } else {
    el.startHandBtn.classList.add("hidden");
  }

  // Show action strip only when it's your turn
  if (myTurn) {
    el.actionStrip.classList.remove("hidden");

    const { toCall } = getBetBounds(hand, hp);
    const raiseActionType = Number(hand.current_bet || 0) > 0 ? "raise" : "bet";
    el.callBtn.textContent = toCall > 0 ? `Call ${fmtShort(toCall)}` : "Check";
    el.betRaiseBtn.textContent = raiseActionType === "raise" ? "Raise" : "Bet";
    el.allInBtn.textContent = `All-in`;
    if (compactActions) {
      el.presetRow.classList.toggle("hidden", !state.landscapeRaisePanelOpen);
    } else {
      el.presetRow.classList.remove("hidden");
    }
    refreshBetControls(hand, hp);
  } else {
    state.landscapeRaisePanelOpen = false;
    el.actionStrip.classList.add("hidden");
    el.presetRow.classList.add("hidden");
  }

}

function updateTurnUI() {
  const hand = getLatestHand();
  const remaining = getTurnClock(hand);
  if (remaining != null && remaining <= 5) {
    const hp = getMyHandPlayer();
    if (hp && hand.action_seat === hp.seat_no) {
      // tick sound handled in updateTimerRings
    }
  }
}

function accumulateHandLog() {
  const hand = getLatestHand();
  const events = getHandEvents();
  if (!hand || !events.length) return;

  // New hand started - add a separator
  if (hand.id !== state.lastLoggedHandId) {
    state.lastLoggedHandId = hand.id;
    state.lastLoggedSeq = 0;
    state.handLogEntries.push({ type: "separator", handNo: hand.hand_no });
  }

  // Add new events we haven't seen yet
  for (const ev of events) {
    if (ev.seq > state.lastLoggedSeq) {
      state.lastLoggedSeq = ev.seq;
      state.handLogEntries.push({ type: "event", ev });
    }
  }
}

function renderHandLog() {
  accumulateHandLog();
  el.handLogInner.innerHTML = "";

  if (!state.handLogEntries.length) {
    el.handLogInner.innerHTML = '<div class="log-entry">No events yet.</div>';
    return;
  }

  state.handLogEntries.forEach(entry => {
    if (entry.type === "separator") {
      const sep = document.createElement("div");
      sep.className = "log-separator";
      sep.textContent = `— Hand #${entry.handNo} —`;
      el.handLogInner.appendChild(sep);
    } else {
      const div = document.createElement("div");
      div.className = "log-entry";
      div.innerHTML = describeEvent(entry.ev);
      el.handLogInner.appendChild(div);
    }
  });

  el.handLogInner.scrollTop = el.handLogInner.scrollHeight;
}

function describeEvent(ev) {
  const actor = ev.actor_group_player_id ? seatName(ev.actor_group_player_id) : "System";
  const p = ev.payload || {};
  switch (ev.event_type) {
    case "hand_started": return `Hand #${p.hand_no || "?"} started`;
    case "blind_posted": return `Blinds: SB ${fmtShort(p.small_blind_amount)} / BB ${fmtShort(p.big_blind_amount)}`;
    case "hole_dealt": return "Hole cards dealt";
    case "action_taken": {
      const copy = getActionCopy(ev);
      return `<strong>${copy.actor || actor}</strong> ${copy.detail}`;
    }
    case "street_dealt": {
      const cards = Array.isArray(p.board_cards) ? p.board_cards.map(t => { const f = cardFace(t); return f.valid ? f.text : "?"; }).join(" ") : "";
      return `${(p.street || "street").toUpperCase()} dealt ${cards}`;
    }
    case "showdown_ready": return "Showdown";
    case "pot_awarded": return "Pot awarded";
    case "hand_settled": return "Hand settled";
    default: return ev.event_type;
  }
}

// ============ ACTIONS ============
async function withAction(label, fn) {
  if (state.loading) return;
  state.loading = true;
  try {
    await fn();
    await loadTableState();
  } catch (err) {
    toast(err.message || label + " failed", "error");
  } finally {
    state.loading = false;
  }
}

function buildActionPayload(actionType) {
  const hand = getLatestHand();
  const hp = getMyHandPlayer();
  const token = getSeatToken();
  if (!hand?.id || !hp) throw new Error("Not in an active hand.");
  if (!token) throw new Error("Seat controlled on another device.");

  const { minBet, maxBet, step } = getBetBounds(hand, hp);
  const amount = normalizeBetAmount(getBetControlValue(), minBet, maxBet, step);
  setBetControlValue(amount);
  if ((actionType === "bet" || actionType === "raise") && amount <= 0) throw new Error("Enter an amount.");

  return {
    handId: hand.id,
    actorGroupPlayerId: state.identity.groupPlayerId,
    actionType,
    amount: (actionType === "bet" || actionType === "raise") ? amount : null,
    clientActionId: `a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    seatToken: token,
  };
}

async function doAction(actionType) {
  const payload = buildActionPayload(actionType);
  await online.submitAction(payload);
}

async function submitTurnAction(label, actionType) {
  if (state.loading || state.pendingAction) return;
  state.pendingAction = true;
  state.landscapeRaisePanelOpen = false;
  renderActions();
  state.loading = true;
  try {
    await doAction(actionType);
    await loadTableState();
  } catch (err) {
    state.pendingAction = false;
    renderActions();
    toast(err.message || `${label} failed`, "error");
  } finally {
    state.loading = false;
  }
}

// ============ EVENT HANDLERS ============
function bindEvents() {
  el.foldBtn.addEventListener("click", () => {
    submitTurnAction("Fold", "fold");
  });
  el.callBtn.addEventListener("click", () => {
    const hand = getLatestHand();
    const hp = getMyHandPlayer();
    const toCall = Math.max(0, Number(hand?.current_bet || 0) - Number(hp?.street_contribution || 0));
    submitTurnAction(toCall > 0 ? "Call" : "Check", toCall > 0 ? "call" : "check");
  });
  el.betRaiseBtn.addEventListener("click", () => {
    const hand = getLatestHand();
    const actionType = Number(hand?.current_bet || 0) > 0 ? "raise" : "bet";
    if ((isLandscapeCollapseMode() || isPortraitCollapseMode()) && !state.landscapeRaisePanelOpen) {
      state.landscapeRaisePanelOpen = true;
      renderActions();
      return;
    }
    submitTurnAction(actionType, actionType);
  });
  el.allInBtn.addEventListener("click", () => {
    submitTurnAction("All-in", "all_in");
  });

  el.startHandBtn.addEventListener("click", () => {
    withAction("Start hand", async () => {
      await online.startHand({
        tableId: state.tableId,
        startedByGroupPlayerId: state.identity.groupPlayerId,
        hostSeatToken: getSeatToken(),
      });
      sounds.deal();
  });
});

  el.copyLinkBtn.addEventListener("click", async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("table", state.tableId);
    ["player","host","mode","group"].forEach(k => url.searchParams.delete(k));
    const link = `${url.origin}${url.pathname}${url.search}`;
    try {
      await navigator.clipboard.writeText(link);
      toast("Link copied!", "success");
    } catch {
      toast(link);
    }
  });

  el.leaveBtn.addEventListener("click", async () => {
    const token = getSeatToken();
    if (!token) { toast("Not seated.", "error"); return; }
    try {
      await online.leaveTable({
        tableId: state.tableId,
        groupPlayerId: state.identity.groupPlayerId,
        seatToken: token,
      });
      setSeatToken(state.tableId, state.identity.groupPlayerId, null);
    } catch (err) {
      toast(err.message || "Leave failed", "error");
      return;
    }
    window.location.href = "index.html";
  });

  el.removeBotsBtn.addEventListener("click", () => {
    withAction("Remove bots", removeAllBots);
  });

  el.landscapeBarToggle?.addEventListener("click", () => {
    if (!isLandscapeCollapseMode() && !isPortraitCollapseMode()) return;
    state.landscapeTopBarExpanded = !state.landscapeTopBarExpanded;
    syncLandscapeTopBar();
  });

  el.tableSurface.addEventListener("click", (e) => {
    if ((isLandscapeCollapseMode() || isPortraitCollapseMode()) && state.landscapeTopBarExpanded) {
      state.landscapeTopBarExpanded = false;
      syncLandscapeTopBar();
    }
    if (state.landscapeRaisePanelOpen) {
      state.landscapeRaisePanelOpen = false;
      renderActions();
    }
    if (!e.target.closest(".seat-node") && state.selectedSeatNo != null) {
      state.selectedSeatNo = null;
      renderSeats();
    }
  });

  // Config panel
  el.hamburgerBtn.addEventListener("click", () => openConfigPanel());
  el.configBackdrop.addEventListener("click", () => closeConfigPanel());
  el.configClose.addEventListener("click", () => closeConfigPanel());

  el.configPanel.querySelectorAll(".config-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      el.configPanel.querySelectorAll(".config-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const tabId = tab.dataset.tab;
      document.getElementById("configTabGame").classList.toggle("hidden", tabId !== "game");
      document.getElementById("configTabPrefs").classList.toggle("hidden", tabId !== "prefs");
    });
  });

  // Auto-deal toggle
  document.getElementById("cfgAutoDealYes").addEventListener("click", () => { setToggle("cfgAutoDealYes", "cfgAutoDealNo"); state.config.autoDeal = true; });
  document.getElementById("cfgAutoDealNo").addEventListener("click", () => { setToggle("cfgAutoDealNo", "cfgAutoDealYes"); state.config.autoDeal = false; });

  // Showdown time
  el.configPanel.querySelectorAll("[data-showdown]").forEach(btn => {
    btn.addEventListener("click", () => {
      el.configPanel.querySelectorAll("[data-showdown]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.config.showdownTime = Number(btn.dataset.showdown) * 1000;
    });
  });

  // Sound toggle
  document.getElementById("cfgSoundOn").addEventListener("click", () => { setToggle("cfgSoundOn", "cfgSoundOff"); state.config.soundOn = true; });
  document.getElementById("cfgSoundOff").addEventListener("click", () => { setToggle("cfgSoundOff", "cfgSoundOn"); state.config.soundOn = false; });

  // Log toggle
  document.getElementById("cfgLogOn").addEventListener("click", () => {
    setToggle("cfgLogOn", "cfgLogOff");
    state.config.showLog = true;
    el.logToggle.classList.remove("hidden");
  });
  document.getElementById("cfgLogOff").addEventListener("click", () => {
    setToggle("cfgLogOff", "cfgLogOn");
    state.config.showLog = false;
    el.logToggle.classList.add("hidden");
    el.handLog.classList.remove("open");
    state.logOpen = false;
  });

  // Save game config (blinds, turn time)
  el.cfgSaveGame.addEventListener("click", async () => {
    if (!canManageHand()) { toast("Only the host can change game settings.", "error"); closeConfigPanel(); return; }
    const sb = Number(el.cfgSB.value);
    const bb = Number(el.cfgBB.value);
    const turnTime = Number(el.cfgTurnTime.value);
    if (sb > 0 && bb > 0 && bb >= sb) {
      try {
        await supabase.from("online_tables").update({ small_blind: sb, big_blind: bb }).eq("id", state.tableId);
        toast("Blinds updated", "success");
      } catch { toast("Failed to update blinds", "error"); }
    }
    if (turnTime >= 10 && turnTime <= 120) {
      state.config.turnTime = turnTime;
    }
    closeConfigPanel();
    await loadTableState();
  });

  el.logToggle.addEventListener("click", () => {
    state.logOpen = !state.logOpen;
    el.handLog.classList.toggle("open", state.logOpen);
    el.logToggle.textContent = state.logOpen ? "Hand Log ▼" : "Hand Log ▲";
  });

  el.chatFab?.addEventListener("click", () => {
    toggleChat();
  });

  el.chatHeader?.addEventListener("pointerdown", startChatDrag);
  el.chatHeader?.addEventListener("pointermove", moveChatDrag);
  el.chatHeader?.addEventListener("pointerup", endChatDrag);
  el.chatHeader?.addEventListener("pointercancel", endChatDrag);

  el.voiceFab?.addEventListener("pointerdown", onVoicePointerDown);
  el.voiceFab?.addEventListener("pointerup", onVoicePointerEnd);
  el.voiceFab?.addEventListener("pointercancel", onVoicePointerEnd);
  el.voiceFab?.addEventListener("pointerleave", onVoicePointerEnd);
  el.voiceFab?.addEventListener("click", onVoiceFabClick);
  el.voiceFab?.addEventListener("contextmenu", onVoiceContextMenu);

  el.chatClose?.addEventListener("click", () => {
    toggleChat(false);
  });

  el.chatInput?.addEventListener("input", () => {
    renderChatUi();
  });

  el.chatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      el.chatForm?.requestSubmit();
    }
  });

  el.chatForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await sendChatMessage(el.chatInput?.value || "");
  });

  el.betSlider.addEventListener("input", () => {
    setBetControlValue(el.betSlider.value);
    refreshBetControls();
  });

  el.betSliderQuick?.addEventListener("input", () => {
    setBetControlValue(el.betSliderQuick.value);
    refreshBetControls();
  });

  el.betAmount.addEventListener("input", () => {
    setBetControlValue(el.betAmount.value);
    refreshBetControls();
  });

  el.betAmountQuick?.addEventListener("input", () => {
    setBetControlValue(el.betAmountQuick.value);
    refreshBetControls();
  });

  document.querySelectorAll(".preset-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const frac = Number(btn.dataset.fraction || 0);
      const meta = getPresetMeta(frac);
      setBetControlValue(meta.amount);
      refreshBetControls();
      toast(meta.toastText);
    });
  });

  window.addEventListener("focus", () => reconnect());
  window.addEventListener("online", () => reconnect());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      reconnect();
      return;
    }
    if (state.voiceConnected || state.voiceCall) {
      void disconnectVoice({ silent: true, destroy: true });
    }
  });

  let resizeTimer = null;
  const handleViewportResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      syncViewportMetrics();
      if (state.chatOpen) applyChatPanelPosition();
      syncLandscapeTopBar();
      if (state.tableState) renderAll();
    }, 200);
  };
  window.addEventListener("resize", handleViewportResize);
  window.visualViewport?.addEventListener("resize", handleViewportResize);
  window.visualViewport?.addEventListener("scroll", handleViewportResize);

  window.addEventListener("beforeunload", () => {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.turnTimer) clearInterval(state.turnTimer);
    if (state.autoDealTimer) clearTimeout(state.autoDealTimer);
    if (state.botActionTimer) clearTimeout(state.botActionTimer);
    if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
    if (state.chatChannel) supabase.removeChannel(state.chatChannel);
    void disconnectVoice({ silent: true, destroy: true });
  });
}

function reconnect() {
  if (Date.now() - state.lastReconnectAt < RECONNECT_DEBOUNCE_MS) return;
  state.lastReconnectAt = Date.now();
  if (!state.tableId || state.loading) return;
  startRealtime(state.tableId);
  loadTableState();
}

// ============ INIT ============
async function init() {
  bindEvents();
  syncViewportMetrics();
  syncLandscapeTopBar(true);
  renderChatUi();

  const savedIdentity = loadIdentity();
  const urlTable = getUrlTableId();

  if (savedIdentity && urlTable) {
    state.identity = savedIdentity;
    el.lobbyName.value = savedIdentity.name || "";

    const existingToken = getSeatToken(urlTable, savedIdentity.groupPlayerId);
    if (existingToken) {
      enterTable(urlTable);
      return;
    }

    if (await tryRestoreExistingSeat(urlTable, savedIdentity)) {
      return;
    }
  }

  initLobby();
}

init().catch((err) => {
  console.error("Failed to initialize online table", err);
  initLobby();
});
