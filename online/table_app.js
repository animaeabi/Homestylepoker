import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";
import { createOnlinePokerClient } from "./client.js";
import { describeSevenCardHand, resolveShowdownPayouts } from "./showdown.js";
import { decide as botDecide, thinkTimeMs, randomPersonality, randomBotName, personalityLabel, OpponentTracker } from "./bot_engine.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const online = createOnlinePokerClient(supabase);

const POLL_MS = 1800;
const RUNTIME_TICK_MIN_MS = 1200;
const DEAL_STAGGER_MS = 110;
const DEAL_ANIMATION_MS = 320;
const DEAL_REVEAL_MS = 180;
const DEAL_REVEAL_OFFSET_MS = 72;
const POT_BUMP_MS = 520;
const CHIP_PUSH_MS = 760;
const CHIP_PUSH_STAGGER_MS = 48;
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
  potVisual: {
    handId: null,
    chipCount: 0,
    pulseUntil: 0,
  },
  potPushAnimation: null,
  clearedPotHandId: null,
  audioCtx: null,
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

// ============ TOAST ============
function toast(message, type = "") {
  const div = document.createElement("div");
  div.className = `toast${type ? ` ${type}` : ""}`;
  div.textContent = message;
  el.toastContainer.appendChild(div);
  setTimeout(() => div.remove(), 3500);
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
  bet: () => { playTone(600, 0.06, 0.1); setTimeout(() => playTone(800, 0.04, 0.08), 60); },
  fold: () => playTone(250, 0.1, 0.06, "triangle"),
  allIn: () => { playTone(500, 0.15, 0.15); setTimeout(() => playTone(700, 0.15, 0.12), 100); setTimeout(() => playTone(900, 0.2, 0.1), 200); },
  win: () => { playTone(800, 0.15, 0.12); setTimeout(() => playTone(1000, 0.15, 0.1), 120); setTimeout(() => playTone(1200, 0.25, 0.1), 250); },
  deal: () => playTone(1200, 0.03, 0.05, "triangle"),
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
    el.presetAmountLabel.textContent = "$";
  }
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

function getStackCtaState({ hand = getLatestHand(), handPlayer = null, stack = 0, startingStack = 200 } = {}) {
  const currentStack = Number(stack || 0);
  const startStackValue = Math.max(0, Number(startingStack || 0));
  const handActive = Boolean(hand && !["settled", "canceled"].includes(hand.state));
  const activeAllIn = Boolean(handActive && handPlayer && !handPlayer.folded && handPlayer.all_in);
  const busted = currentStack <= 0;
  const low = currentStack <= startStackValue * 0.2;

  if (activeAllIn) {
    return { kind: "status", text: "All-in" };
  }
  if (busted && !handActive) {
    return { kind: "action", text: "Buy In" };
  }
  if (!handActive && low) {
    return { kind: "action", text: busted ? "Buy In" : "Top Up" };
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
      flight.className = "deal-flight-card";
      flight.style.setProperty("--from-x", `${fromX - targetRect.width / 2}px`);
      flight.style.setProperty("--from-y", `${fromY - targetRect.height / 2}px`);
      flight.style.setProperty("--to-x", `${targetRect.left - tableRect.left}px`);
      flight.style.setProperty("--to-y", `${targetRect.top - tableRect.top}px`);
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
    { x: 8, y: 60 }, { x: 92, y: 60 },
  ],
  4: [
    { x: 30, y: 4 }, { x: 70, y: 4 },
    { x: 8, y: 60 }, { x: 92, y: 60 },
  ],
  5: [
    { x: 50, y: 4 },
    { x: 6, y: 30 }, { x: 94, y: 30 },
    { x: 15, y: 75 }, { x: 85, y: 75 },
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
  enterTable(table.id);
}

async function joinExistingTable(tableId) {
  const id = state.identity;
  const seat = await online.joinTable({
    tableId,
    groupPlayerId: id.groupPlayerId,
  });
  if (seat?.seat_token) setSeatToken(tableId, id.groupPlayerId, seat.seat_token);
  enterTable(tableId);
}

// ============ ENTER TABLE ============
function enterTable(tableId) {
  state.tableId = tableId;
  const url = new URL(window.location.href);
  url.searchParams.set("table", tableId);
  url.searchParams.delete("mode");
  url.searchParams.delete("player");
  url.searchParams.delete("host");
  url.searchParams.delete("group");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);

  el.lobby.classList.add("hidden");
  el.tableView.classList.remove("hidden");
  syncLandscapeTopBar(true);

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
  state.realtimeChannel = null;
  state.realtimeHealthy = false;
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
  if (state.realtimeChannel && state.realtimeHealthy) return;
  await stopRealtime();

  const ch = supabase
    .channel(`table:${tableId}:${Math.random().toString(36).slice(2, 8)}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_tables", filter: `id=eq.${tableId}` }, queueRtRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_table_seats", filter: `table_id=eq.${tableId}` }, queueRtRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_hands", filter: `table_id=eq.${tableId}` }, queueRtRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "online_hand_events", filter: `table_id=eq.${tableId}` }, queueRtRefresh);

  state.realtimeChannel = ch;
  state.realtimeHealthy = false;

  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") { state.realtimeHealthy = true; updateConnDot(); queueRtRefresh(); }
    else if (["TIMED_OUT","CHANNEL_ERROR","CLOSED"].includes(status)) { state.realtimeHealthy = false; updateConnDot(); }
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

    const hand = getLatestHand();
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
    maybeStartDealAnimation(oldHand, hand, hadPriorTableState);
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

  const delay = thinkTimeMs();
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
  maybeLaunchPotPushFx();
  maybeLaunchDealFx();
  updateTurnUI();
}

function renderTopBar() {
  const table = getTable();
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
    if (board[i]) el.boardCards.appendChild(makeCardEl(board[i], false));
    else {
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

      // Inline dealer button
      if (hand && hand.button_seat === seat.seat_no) {
        const dChip = document.createElement("span");
        dChip.className = "seat-dealer-dot";
        dChip.textContent = "D";
        header.appendChild(dChip);
      }

      // SB/BB label
      if (hand) {
        if (hand.small_blind_seat === seat.seat_no) {
          const lbl = document.createElement("span");
          lbl.className = "seat-pos-label";
          lbl.textContent = "SB";
          header.appendChild(lbl);
        } else if (hand.big_blind_seat === seat.seat_no) {
          const lbl = document.createElement("span");
          lbl.className = "seat-pos-label";
          lbl.textContent = "BB";
          header.appendChild(lbl);
        }
      }

      header.append(nameEl);
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

        if (compactMobile && !isMe) {
          const floatCards = document.createElement("div");
          floatCards.className = "floating-cards";
          const px = parseFloat(pos.x);
          const py = parseFloat(pos.y);
          let anchor = "top";
          if (py <= (compactMobile && !portrait ? 20 : 18)) anchor = "top";
          else if (px <= (compactMobile && !portrait ? 24 : 22)) anchor = "left";
          else if (px >= (compactMobile && !portrait ? 76 : 78)) anchor = "right";
          else if (py >= (compactMobile && !portrait ? 60 : 64)) anchor = px < 50 ? "bottom-left" : "bottom-right";
          else anchor = px < 50 ? "left" : "right";
          floatCards.classList.add(`floating-cards--${anchor}`);
          if (!portrait) floatCards.classList.add("floating-cards--landscape");
          if (reveal) floatCards.classList.add("showdown");
          floatCards.style.left = `${px}%`;
          floatCards.style.top = `${py}%`;
          const floatTilts = anchor === "top"
            ? [-8, 6]
            : anchor === "left"
              ? [-6, 4]
              : anchor === "right"
                ? [-4, 6]
                : anchor === "bottom-left"
                  ? [-7, 5]
                  : [-5, 7];
          const firstCard = markDealCardTarget(makeCardEl(holeCards[0] || null, !hasHoleCards || !reveal, false), seat.seat_no, 1, hand, floatTilts[0]);
          const secondCard = markDealCardTarget(makeCardEl(holeCards[1] || null, !hasHoleCards || !reveal, false), seat.seat_no, 2, hand, floatTilts[1]);
          floatCards.append(firstCard, secondCard);
          el.seatsLayer.appendChild(floatCards);
        } else {
          const cards = document.createElement("div");
          cards.className = "seat-cards-row";
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
        const stk = Number((hp && hp.stack_end != null) ? hp.stack_end : seat.chip_stack || 0);
        const startStk = Number(tbl?.starting_stack || 200);
        const cta = getStackCtaState({ hand, handPlayer: hp, stack: stk, startingStack: startStk });
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
  if (!mySeat) return;

  nameEl.textContent = state.identity?.name || "You";
  const displayStack = (hp && hp.stack_end != null) ? hp.stack_end : mySeat.chip_stack;
  stackEl.textContent = fmtShort(displayStack);
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
  const stk = Number(displayStack || 0);
  const startStk = Number(tbl?.starting_stack || 200);
  const cta = getStackCtaState({ hand, handPlayer: hp, stack: stk, startingStack: startStk });

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

  const myTurn = hand && isActionStreet(hand.state) && token && hp && !hp.folded && !hp.all_in && hand.action_seat === hp.seat_no;
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
      const amt = p.amount != null ? ` ${fmtShort(p.amount)}` : "";
      return `<strong>${actor}</strong>: ${p.action_type}${amt}`;
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
  if (actionType === "fold") sounds.fold();
  else if (actionType === "check") sounds.check();
  else if (actionType === "all_in") sounds.allIn();
  else sounds.bet();
}

// ============ EVENT HANDLERS ============
function bindEvents() {
  el.foldBtn.addEventListener("click", () => {
    state.landscapeRaisePanelOpen = false;
    withAction("Fold", () => doAction("fold"));
  });
  el.callBtn.addEventListener("click", () => {
    state.landscapeRaisePanelOpen = false;
    const hand = getLatestHand();
    const hp = getMyHandPlayer();
    const toCall = Math.max(0, Number(hand?.current_bet || 0) - Number(hp?.street_contribution || 0));
    withAction(toCall > 0 ? "Call" : "Check", () => doAction(toCall > 0 ? "call" : "check"));
  });
  el.betRaiseBtn.addEventListener("click", () => {
    const hand = getLatestHand();
    const actionType = Number(hand?.current_bet || 0) > 0 ? "raise" : "bet";
    if ((isLandscapeCollapseMode() || isPortraitCollapseMode()) && !state.landscapeRaisePanelOpen) {
      state.landscapeRaisePanelOpen = true;
      renderActions();
      return;
    }
    state.landscapeRaisePanelOpen = false;
    withAction(actionType, () => doAction(actionType));
  });
  el.allInBtn.addEventListener("click", () => {
    state.landscapeRaisePanelOpen = false;
    withAction("All-in", () => doAction("all_in"));
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
      const pot = Number(getLatestHand()?.pot_total || 0);
      const { minBet, maxBet, step } = getBetBounds();
      const val = normalizeBetAmount(roundToStep(pot * frac, step), minBet, maxBet, step);
      setBetControlValue(val);
      refreshBetControls();
    });
  });

  window.addEventListener("focus", () => reconnect());
  window.addEventListener("online", () => reconnect());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reconnect(); });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      syncLandscapeTopBar();
      if (state.tableState) renderAll();
    }, 200);
  });

  window.addEventListener("beforeunload", () => {
    if (state.pollTimer) clearInterval(state.pollTimer);
    if (state.turnTimer) clearInterval(state.turnTimer);
    if (state.autoDealTimer) clearTimeout(state.autoDealTimer);
    if (state.botActionTimer) clearTimeout(state.botActionTimer);
    if (state.realtimeChannel) supabase.removeChannel(state.realtimeChannel);
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
function init() {
  bindEvents();
  syncLandscapeTopBar(true);

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
  }

  initLobby();
}

init();
