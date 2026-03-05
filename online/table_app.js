import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";
import { createOnlinePokerClient } from "./client.js";
import { describeSevenCardHand, resolveShowdownPayouts } from "./showdown.js";
import { decide as botDecide, thinkTimeMs, randomPersonality, randomBotName, personalityLabel, OpponentTracker } from "./bot_engine.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const online = createOnlinePokerClient(supabase);

const POLL_MS = 1800;
const RUNTIME_TICK_MIN_MS = 1200;
const TURN_CLOCK_SECS = 25;
const REALTIME_DEBOUNCE_MS = 180;
const RECONNECT_DEBOUNCE_MS = 900;
const FALLBACK_STALE_MS = 5000;
const SEAT_COLORS = [
  "#60a5fa","#f87171","#4ade80","#fb923c","#a78bfa",
  "#f472b6","#38bdf8","#fbbf24","#34d399","#e879f9"
];
const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
const SUITS = ["S","H","D","C"];
const FULL_DECK = SUITS.flatMap(s => RANKS.map(r => `${r}${s}`));

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
  tbTitle: document.getElementById("tbTitle"),
  tbBlinds: document.getElementById("tbBlinds"),
  tbPlayers: document.getElementById("tbPlayers"),
  connDot: document.getElementById("connDot"),
  muteBtn: document.getElementById("muteBtn"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  removeBotsBtn: document.getElementById("removeBotsBtn"),
  leaveBtn: document.getElementById("leaveBtn"),
  tableSurface: document.getElementById("tableSurface"),
  seatsLayer: document.getElementById("seatsLayer"),
  potDisplay: document.getElementById("potDisplay"),
  streetLabel: document.getElementById("streetLabel"),
  boardCards: document.getElementById("boardCards"),
  startHandBtn: document.getElementById("startHandBtn"),
  actionStrip: document.getElementById("actionStrip"),
  presetRow: document.getElementById("presetRow"),
  foldBtn: document.getElementById("foldBtn"),
  callBtn: document.getElementById("callBtn"),
  betRaiseBtn: document.getElementById("betRaiseBtn"),
  allInBtn: document.getElementById("allInBtn"),
  betSlider: document.getElementById("betSlider"),
  betAmount: document.getElementById("betAmount"),
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
  muted: false,
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
  botActionTimer: null,
  opponentTracker: new OpponentTracker(),
  lastTrackedEventSeq: 0,
  equityCacheKey: "",
  equityCache: new Map(),
  audioCtx: null,
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
  if (state.muted) return;
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

function isHostPlayer() {
  const table = getTable();
  if (!table) return false;
  return table.created_by_group_player_id === state.identity?.groupPlayerId;
}

function canManageHand() {
  return isHostPlayer() && Boolean(getSeatToken());
}

function isActionStreet(s) {
  return ["preflop","flop","turn","river"].includes(s);
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

function seatPosition(index, total) {
  const isMobile = window.innerWidth <= 768;
  const landscape = isLandscape();
  const angle = Math.PI / 2 + ((index - 1) / total) * Math.PI * 2;
  let xR, yR;
  if (landscape) {
    xR = total >= 8 ? 43 : 42;
    yR = total >= 8 ? 38 : 36;
  } else if (isMobile) {
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
  if (!Number.isFinite(lastMs)) return TURN_CLOCK_SECS;
  return Math.max(0, TURN_CLOCK_SECS - Math.floor((Date.now() - lastMs) / 1000));
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
    const ts = await online.getTableState({
      tableId: state.tableId,
      viewerGroupPlayerId: state.identity?.groupPlayerId || null,
      viewerSeatToken: getSeatToken() || null,
    });
    const oldHand = getLatestHand();
    state.tableState = ts;
    state.lastSyncAt = Date.now();

    const hand = getLatestHand();
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

    if (hand && ["settled","canceled"].includes(hand.state) && !state.autoDealTimer && canManageHand()) {
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

const AUTO_DEAL_DELAY_MS = 5000;

function handleSettlement(hand) {
  const winners = getHandPlayers().filter(p => Number(p.result_amount || 0) > 0);
  for (const w of winners) {
    state.winOverlays.set(w.seat_no, { amount: w.result_amount, until: Date.now() + AUTO_DEAL_DELAY_MS });
  }
  if (winners.length > 0) sounds.win();
  scheduleAutoDeal();
}

function scheduleAutoDeal() {
  if (state.autoDealTimer) clearTimeout(state.autoDealTimer);
  state.autoDealTimer = setTimeout(() => {
    state.autoDealTimer = null;
    tryAutoDeal();
  }, AUTO_DEAL_DELAY_MS);
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

// ============ SIT FROM TABLE VIEW ============
async function sitSelectedSeat() {
  if (!state.identity || !state.tableId || !state.selectedSeatNo) return;
  const mySeat = getMySeat();
  if (mySeat) { toast("Already seated.", "error"); state.selectedSeatNo = null; renderSeats(); return; }
  try {
    const seat = await online.joinTable({
      tableId: state.tableId,
      groupPlayerId: state.identity.groupPlayerId,
      preferredSeat: state.selectedSeatNo,
    });
    if (seat?.seat_token) setSeatToken(state.tableId, state.identity.groupPlayerId, seat.seat_token);
    toast(`Seated at seat ${seat.seat_no}`, "success");
    state.selectedSeatNo = null;
    await loadTableState();
  } catch (err) {
    toast(err.message || "Failed to sit", "error");
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
  renderActions();
  renderHandLog();
  updateTurnUI();
}

function renderTopBar() {
  const table = getTable();
  el.tbTitle.textContent = table?.name || "Online Table";
  el.tbBlinds.textContent = table ? `${table.small_blind}/${table.big_blind}` : "";
  const seated = getSeats().filter(s => s.group_player_id && !s.left_at).length;
  el.tbPlayers.textContent = `${seated} seated`;
  el.removeBotsBtn.style.display = (isHostPlayer() && state.botSeats.size > 0) ? "" : "none";
}

function renderBoard() {
  const hand = getLatestHand();
  const board = Array.isArray(hand?.board_cards) ? hand.board_cards : [];

  el.potDisplay.textContent = hand ? `Pot ${fmtShort(hand.pot_total)}` : "Pot $0";
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
}

function renderSeats() {
  const seats = getSeats().slice().sort((a, b) => a.seat_no - b.seat_no);
  const hand = getLatestHand();
  const hpBySeat = new Map(getHandPlayers().map(hp => [hp.seat_no, hp]));
  const mySeat = getMySeat();
  const showEquity = hand && isActionStreet(hand.state) && getHandPlayers().some(hp => !hp.folded && hp.all_in);

  let equityMap = new Map();
  if (showEquity) {
    const key = `${hand.id}|${hand.state}|${JSON.stringify(hand.board_cards)}`;
    if (key !== state.equityCacheKey) {
      state.equityCache = calcEquity(hand, getHandPlayers());
      state.equityCacheKey = key;
    }
    equityMap = state.equityCache;
  }

  el.seatsLayer.innerHTML = "";
  const total = seats.length;

  // Rotate seats so main player is always at the bottom (position index that maps to 3pi/2)
  const bottomIdx = Math.floor(total / 2);
  let rotateOffset = 0;
  if (mySeat) {
    const myIdx = seats.findIndex(s => s.seat_no === mySeat.seat_no);
    if (myIdx >= 0) rotateOffset = bottomIdx - myIdx;
  }

  seats.forEach((seat, idx) => {
    const rotatedIdx = ((idx + rotateOffset) % total + total) % total;
    const pos = seatPosition(rotatedIdx + 1, total);
    const hp = hpBySeat.get(seat.seat_no);
    const occupied = seat.group_player_id && !seat.left_at;
    const pid = occupied ? seat.group_player_id : null;
    const empty = !pid;
    const isTurn = hand && hand.action_seat === seat.seat_no;
    const isFolded = hp?.folded;
    const isAllIn = hp?.all_in;

    const node = document.createElement("div");
    node.className = "seat-node";
    node.style.setProperty("--x", pos.x);
    node.style.setProperty("--y", pos.y);

    if (empty) {
      node.classList.add("empty");
      if (state.selectedSeatNo === seat.seat_no) node.classList.add("selected");
      const label = document.createElement("span");
      label.className = "seat-empty-label";
      label.textContent = "SIT";
      node.appendChild(label);
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

      if (state.selectedSeatNo === seat.seat_no) {
        const popover = document.createElement("div");
        popover.className = "seat-popover";
        const sitBtn = document.createElement("button");
        sitBtn.className = "pop-sit";
        sitBtn.textContent = "Sit";
        sitBtn.addEventListener("click", (e) => { e.stopPropagation(); sitSelectedSeat(); });
        popover.appendChild(sitBtn);
        if (isHostPlayer()) {
          const botBtn = document.createElement("button");
          botBtn.className = "pop-bot";
          botBtn.textContent = "Add Bot";
          botBtn.addEventListener("click", (e) => { e.stopPropagation(); addBot(seat.seat_no); state.selectedSeatNo = null; });
          popover.appendChild(botBtn);
        }
        node.appendChild(popover);
      }
    } else {
      const isBot = isBotSeat(seat.seat_no);
      if (isBot) node.classList.add("bot-seat");
      if (isTurn) node.classList.add("active-turn");
      if (isFolded) node.classList.add("folded");

      const color = SEAT_COLORS[(seat.seat_no - 1) % SEAT_COLORS.length];

      const header = document.createElement("div");
      header.className = "seat-header";

      const nameEl = document.createElement("span");
      nameEl.className = "seat-name";
      const botInfo = getBotInfo(seat.seat_no);
      nameEl.textContent = botInfo ? botInfo.name : seatName(pid);
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

      if (hp && Array.isArray(hp.hole_cards) && hp.hole_cards.length >= 2) {
        const isShowdown = ["showdown","settled"].includes(hand?.state);
        let reveal = isMe;
        if (isShowdown && !isFolded) {
          const isWinner = Number(hp.result_amount || 0) > 0;
          const isAggressor = getLastAggressor(hand) === seat.seat_no;
          reveal = isMe || isWinner || isAggressor;
        }
        const cards = document.createElement("div");
        cards.className = "seat-cards-row";
        if (isMe && reveal) {
          cards.appendChild(makeCardEl(hp.hole_cards[0], false, false, true));
          cards.appendChild(makeCardEl(hp.hole_cards[1], false, false, true));
        } else {
          cards.appendChild(makeCardEl(hp.hole_cards[0], !reveal, true));
          cards.appendChild(makeCardEl(hp.hole_cards[1], !reveal, true));
        }
        node.appendChild(cards);
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
        const frac = remaining != null ? remaining / TURN_CLOCK_SECS : 1;
        fg.style.strokeDashoffset = `${circ * (1 - frac)}`;
        if (remaining != null && remaining <= 5) fg.classList.add("danger");
        else if (remaining != null && remaining <= 10) fg.classList.add("warn");
        ring.append(bg, fg);
        node.appendChild(ring);
      }

      const winData = state.winOverlays.get(seat.seat_no);
      if (winData && Date.now() < winData.until) {
        node.classList.add("winner-seat");
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
        const stk = Number(seat.chip_stack || 0);
        const startStk = Number(tbl?.starting_stack || 200);
        const handActive = hand && !["settled","canceled"].includes(hand.state);
        const playerInHand = hp && !hp.folded;
        const busted = stk <= 0;
        const low = stk <= startStk * 0.2;
        const showRebuy = busted && !playerInHand || (!handActive && low);
        if (showRebuy) {
          const rbBtn = document.createElement("button");
          rbBtn.className = "seat-rebuy-btn";
          rbBtn.textContent = busted ? "Buy In" : "Top Up";
          rbBtn.addEventListener("click", (e) => { e.stopPropagation(); doRebuy(); });
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

function updateTimerRings() {
  const hand = getLatestHand();
  if (!hand || !hand.action_seat) return;
  const remaining = getTurnClock(hand);
  const frac = remaining != null ? remaining / TURN_CLOCK_SECS : 1;
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

  const myTurn = hand && isActionStreet(hand.state) && token && hp && !hp.folded && !hp.all_in && hand.action_seat === hp.seat_no;
  const noActiveHand = !hand || ["settled","canceled"].includes(hand.state);

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
    el.presetRow.classList.remove("hidden");

    const toCall = Math.max(0, Number(hand.current_bet || 0) - Number(hp.street_contribution || 0));
    el.callBtn.textContent = toCall > 0 ? `Call ${fmtShort(toCall)}` : "Check";
    el.betRaiseBtn.textContent = Number(hand.current_bet || 0) > 0 ? "Raise" : "Bet";
    el.allInBtn.textContent = `All-in`;

    const minBet = Number(hand.current_bet || 0) > 0
      ? Number(hand.current_bet || 0) + Math.max(Number(hand.min_raise || 0), Number(getTable()?.big_blind || 2))
      : Number(getTable()?.big_blind || 2);
    const maxBet = Number(hp.stack_end || 0) + Number(hp.street_contribution || 0);
    el.betSlider.min = Math.min(minBet, maxBet);
    el.betSlider.max = maxBet;
    if (Number(el.betAmount.value) < minBet) {
      el.betSlider.value = minBet;
      el.betAmount.value = minBet;
    }
  } else {
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

function renderHandLog() {
  const events = getHandEvents();
  el.handLogInner.innerHTML = "";
  if (!events.length) {
    el.handLogInner.innerHTML = '<div class="log-entry">No events yet.</div>';
    return;
  }
  events.slice(-40).forEach(ev => {
    const div = document.createElement("div");
    div.className = "log-entry";
    div.innerHTML = `<strong>#${ev.seq}</strong> ${describeEvent(ev)}`;
    el.handLogInner.appendChild(div);
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

  const amount = Number(el.betAmount.value || 0);
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
  el.foldBtn.addEventListener("click", () => withAction("Fold", () => doAction("fold")));
  el.callBtn.addEventListener("click", () => {
  const hand = getLatestHand();
    const hp = getMyHandPlayer();
    const toCall = Math.max(0, Number(hand?.current_bet || 0) - Number(hp?.street_contribution || 0));
    withAction(toCall > 0 ? "Call" : "Check", () => doAction(toCall > 0 ? "call" : "check"));
  });
  el.betRaiseBtn.addEventListener("click", () => {
  const hand = getLatestHand();
    const actionType = Number(hand?.current_bet || 0) > 0 ? "raise" : "bet";
    withAction(actionType, () => doAction(actionType));
  });
  el.allInBtn.addEventListener("click", () => withAction("All-in", () => doAction("all_in")));

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

  el.tableSurface.addEventListener("click", (e) => {
    if (!e.target.closest(".seat-node") && state.selectedSeatNo != null) {
      state.selectedSeatNo = null;
      renderSeats();
    }
  });

  el.muteBtn.addEventListener("click", () => {
    state.muted = !state.muted;
    el.muteBtn.textContent = state.muted ? "🔇" : "🔊";
  });

  el.logToggle.addEventListener("click", () => {
    state.logOpen = !state.logOpen;
    el.handLog.classList.toggle("open", state.logOpen);
    el.logToggle.textContent = state.logOpen ? "Hand Log ▼" : "Hand Log ▲";
  });

  el.betSlider.addEventListener("input", () => {
    el.betAmount.value = el.betSlider.value;
  });

  el.betAmount.addEventListener("input", () => {
    el.betSlider.value = el.betAmount.value;
  });

  document.querySelectorAll(".preset-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const frac = Number(btn.dataset.fraction || 0);
      const pot = Number(getLatestHand()?.pot_total || 0);
      const val = Math.max(Number(el.betSlider.min), Math.round(pot * frac));
      el.betSlider.value = val;
      el.betAmount.value = val;
    });
  });

  window.addEventListener("focus", () => reconnect());
  window.addEventListener("online", () => reconnect());
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reconnect(); });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.tableState) renderAll(); }, 200);
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
