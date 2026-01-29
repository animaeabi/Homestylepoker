import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.3";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (selector) => document.querySelector(selector);

const elements = {
  landing: $("#landing"),
  newGameName: $("#newGameName"),
  newBuyIn: $("#newBuyIn"),
  newHostName: $("#newHostName"),
  gameGroup: $("#gameGroup"),
  createGame: $("#createGame"),
  joinCode: $("#joinCode"),
  joinGame: $("#joinGame"),
  openSessions: $("#openSessions"),
  groupList: $("#groupList"),
  createGroup: $("#createGroup"),
  groupModal: $("#groupModal"),
  groupModalTitle: $("#groupModalTitle"),
  groupModalClose: $("#groupModalClose"),
  groupPlayerList: $("#groupPlayerList"),
  groupPlayerForm: $("#groupPlayerForm"),
  groupPlayerName: $("#groupPlayerName"),
  groupPlayerAdd: $("#groupPlayerAdd"),
  createGroupModal: $("#createGroupModal"),
  createGroupClose: $("#createGroupClose"),
  createGroupForm: $("#createGroupForm"),
  createGroupName: $("#createGroupName"),
  createGroupCancel: $("#createGroupCancel"),
  createGroupSubmit: $("#createGroupSubmit"),
  rosterModal: $("#rosterModal"),
  rosterTitle: $("#rosterTitle"),
  rosterClose: $("#rosterClose"),
  rosterList: $("#rosterList"),
  rosterCancel: $("#rosterCancel"),
  rosterStart: $("#rosterStart"),
  summaryGroup: $("#summaryGroup"),
  summaryQuarter: $("#summaryQuarter"),
  openSummary: $("#openSummary"),
  configNotice: $("#configNotice"),
  themeToggle: $("#themeToggle"),
  sessionsPanel: $("#sessionsPanel"),
  sessionsBack: $("#sessionsBack"),
  gamePanel: $("#gamePanel"),
  gameTitle: $("#gameTitle"),
  gameCode: $("#gameCode"),
  gameStatusChip: $("#gameStatusChip"),
  gameName: $("#gameName"),
  currency: $("#currency"),
  defaultBuyIn: $("#defaultBuyIn"),
  leaveGame: $("#leaveGame"),
  copyLink: $("#copyLink"),
  copyLinkInline: $("#copyLinkInline"),
  openLink: $("#openLink"),
  hostLayout: $("#hostLayout"),
  joinPanel: $("#joinPanel"),
  logPanel: $("#logPanel"),
  joinLink: $("#joinLink"),
  qrCanvas: $("#qrCanvas"),
  settledNotice: $("#settledNotice"),
  settledAt: $("#settledAt"),
  openSettle: $("#openSettle"),
  settleModal: $("#settleModal"),
  settlePanel: $("#settlePanel"),
  settleForm: $("#settleForm"),
  settleList: $("#settleList"),
  settleCancel: $("#settleCancel"),
  settleError: $("#settleError"),
  settlementSummary: $("#settlementSummary"),
  summaryModal: $("#summaryModal"),
  summaryClose: $("#summaryClose"),
  summaryTitle: $("#summaryTitle"),
  summarySubtitle: $("#summarySubtitle"),
  summaryBreakdown: $("#summaryBreakdown"),
  summaryTransfers: $("#summaryTransfers"),
  hostModeToggle: $("#hostModeToggle"),
  hostPanel: $("#hostPanel"),
  summary: $("#summary"),
  hostPlayerName: $("#hostPlayerName"),
  hostAddPlayer: $("#hostAddPlayer"),
  players: $("#players"),
  recentGames: $("#recentGames"),
  deleteAllGames: $("#deleteAllGames"),
  playerPanel: $("#playerPanel"),
  playerPanelTitle: $("#playerPanelTitle"),
  playerPanelHeading: $("#playerPanelHeading"),
  playerPanelSubtitle: $("#playerPanelSubtitle"),
  playerJoin: $("#playerJoin"),
  playerName: $("#playerName"),
  joinAsPlayer: $("#joinAsPlayer"),
  playerMatchList: $("#playerMatchList"),
  playerSeat: $("#playerSeat"),
  playerCard: $("#playerCard"),
  playerAddDefault: $("#playerAddDefault"),
  playerBuyins: $("#playerBuyins"),
  playerSettledSummary: $("#playerSettledSummary"),
  playerNotice: $("#playerNotice"),
  playerJoinNotice: $("#playerJoinNotice"),
  logTable: $("#logTable"),
  connectionStatus: $("#connectionStatus"),
  saveStatus: $("#saveStatus")
};

const state = {
  game: null,
  players: [],
  buyins: [],
  settlements: [],
  settlementsAvailable: true,
  groups: [],
  groupPlayers: [],
  activeGroupId: null,
  roster: [],
  isHost: false,
  canHost: false,
  playerId: null,
  channel: null
};

const configMissing =
  !SUPABASE_URL ||
  SUPABASE_URL.startsWith("REPLACE") ||
  !SUPABASE_ANON_KEY ||
  SUPABASE_ANON_KEY.startsWith("REPLACE");

if (configMissing) {
  elements.configNotice.classList.remove("hidden");
  elements.createGame.disabled = true;
  if (elements.joinGame) elements.joinGame.disabled = true;
  elements.joinAsPlayer.disabled = true;
  elements.hostAddPlayer.disabled = true;
  if (elements.openSettle) elements.openSettle.disabled = true;
  if (elements.deleteAllGames) elements.deleteAllGames.disabled = true;
  if (elements.createGroup) elements.createGroup.disabled = true;
  if (elements.openSummary) elements.openSummary.disabled = true;
  if (elements.openSessions) elements.openSessions.disabled = true;
}

const supabase = configMissing ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const playerKey = (code) => `poker_player_${code}`;
const hostKey = (code) => `poker_host_${code}`;
const recentGamesKey = "poker_recent_games";
const themeKey = "poker_theme";
const deletePinKey = "poker_delete_pin_ok";
const deletePin = "2/7";
const lastGroupKey = "poker_last_group";
const hostNameKey = "poker_host_name";
const gameNameAdjectives = [
  "Lucky",
  "Tilted",
  "Royal",
  "Wild",
  "Silky",
  "Sneaky",
  "Brassy",
  "Grindy",
  "Sharky",
  "Button",
  "River",
  "Flop",
  "Turn",
  "All-In",
  "Split",
  "High-Stakes"
];
const gameNameNouns = [
  "Flush",
  "Full House",
  "Bad Beat",
  "Chip Stack",
  "Dealer",
  "Table",
  "Pot",
  "Showdown",
  "Runners",
  "Blind Battle",
  "Kings",
  "Aces",
  "Lucky Draw",
  "Saddle",
  "Night"
];

const safeTrim = (value) => (value || "").trim();

function normalizeName(name) {
  return safeTrim(name).replace(/\s+/g, " ").toLowerCase();
}

function applyTheme(theme) {
  const mode = theme === "light" ? "light" : "dark";
  document.body.classList.toggle("theme-light", mode === "light");
  document.body.classList.toggle("theme-dark", mode === "dark");
  if (elements.themeToggle) {
    elements.themeToggle.textContent = mode === "dark" ? "Light mode" : "Dark mode";
    elements.themeToggle.setAttribute("aria-pressed", mode === "dark");
  }
}

function initTheme() {
  const stored = localStorage.getItem(themeKey);
  if (stored) {
    applyTheme(stored);
    return;
  }
  applyTheme("dark");
}

function initHostName() {
  if (!elements.newHostName) return;
  const stored = loadHostName();
  if (stored) {
    elements.newHostName.value = stored;
  }
}

function loadStoredPlayer(code) {
  if (!code) return null;
  const raw = localStorage.getItem(playerKey(code));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { id: parsed.id || null, name: parsed.name || "" };
    }
    return { id: raw, name: "" };
  } catch (err) {
    return { id: raw, name: "" };
  }
}

function saveStoredPlayer(code, player) {
  if (!code || !player?.id) return;
  localStorage.setItem(
    playerKey(code),
    JSON.stringify({ id: player.id, name: player.name || "" })
  );
}

function clearStoredPlayer(code) {
  if (!code) return;
  localStorage.removeItem(playerKey(code));
}

function loadRecentGames() {
  try {
    const stored = JSON.parse(localStorage.getItem(recentGamesKey) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored;
  } catch (err) {
    return [];
  }
}

function saveRecentGames(list) {
  localStorage.setItem(recentGamesKey, JSON.stringify(list));
}

function isLocalHostForGame(code) {
  return localStorage.getItem(hostKey(code)) === "true";
}

function loadLastGroup() {
  return localStorage.getItem(lastGroupKey) || "";
}

function saveLastGroup(value) {
  if (!value) {
    localStorage.removeItem(lastGroupKey);
    return;
  }
  localStorage.setItem(lastGroupKey, value);
}

function loadHostName() {
  return safeTrim(localStorage.getItem(hostNameKey));
}

function saveHostName(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) {
    localStorage.removeItem(hostNameKey);
    return;
  }
  localStorage.setItem(hostNameKey, trimmed);
}

function requireHostName() {
  const name = safeTrim(elements.newHostName?.value);
  if (!name) {
    setStatus("Enter your host name to start.", "error");
    elements.newHostName?.focus();
    return null;
  }
  return name;
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function generateGameName() {
  const adjective = pickRandom(gameNameAdjectives);
  const noun = pickRandom(gameNameNouns);
  return `${adjective} ${noun}`;
}

function initGameName() {
  if (!elements.newGameName) return;
  if (!safeTrim(elements.newGameName.value)) {
    elements.newGameName.value = generateGameName();
  }
}

function isDeletePinAuthorized() {
  return localStorage.getItem(deletePinKey) === "true";
}

async function ensureDeletePin() {
  if (isDeletePinAuthorized()) return true;
  const input = window.prompt("Enter delete PIN");
  if (input === null) return false;
  if (safeTrim(input) === deletePin) {
    localStorage.setItem(deletePinKey, "true");
    return true;
  }
  setStatus("Incorrect PIN.", "error");
  return false;
}

async function refreshRecentGames() {
  if (!elements.recentGames) return;
  if (!supabase) {
    renderRecentGames();
    return;
  }

  const { data, error } = await supabase
    .from("games")
    .select("code,name,created_at,ended_at,group_id,groups(name)")
    .order("created_at", { ascending: false });

  if (error) {
    renderRecentGames();
    return;
  }

  const normalized = (data || []).map((game) => ({
    ...game,
    group_name: game.group_name || game.groups?.name || null
  }));

  renderRecentGames(normalized);
}

function renderGroupList() {
  if (!elements.groupList) return;
  elements.groupList.innerHTML = "";

  if (!state.groups.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No groups yet. Create one for your recurring table.";
    elements.groupList.appendChild(empty);
    return;
  }

  state.groups.forEach((group) => {
    const row = document.createElement("div");
    row.className = "group-item";
    row.dataset.action = "open-group";
    row.dataset.id = group.id;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.innerHTML = `
      <strong>${group.name}</strong>
    `;
    elements.groupList.appendChild(row);
  });
}

function buildGroupOptions(selectEl, includeEmpty) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  if (includeEmpty) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No group (one-off)";
    selectEl.appendChild(empty);
  } else {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.groups.length ? "Select group" : "No groups yet";
    selectEl.appendChild(placeholder);
  }
  state.groups.forEach((group) => {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.name;
    selectEl.appendChild(option);
  });
}

function renderGroupSelects() {
  buildGroupOptions(elements.gameGroup, true);
  buildGroupOptions(elements.summaryGroup, false);
  const lastGroup = loadLastGroup();
  if (lastGroup && elements.gameGroup) {
    elements.gameGroup.value = lastGroup;
  }
  if (lastGroup && elements.summaryGroup) {
    elements.summaryGroup.value = lastGroup;
  }
  if (elements.summaryGroup) {
    elements.summaryGroup.disabled = state.groups.length === 0;
  }
  if (elements.openSummary) {
    elements.openSummary.disabled = state.groups.length === 0;
  }
}

async function refreshGroups() {
  if (!supabase) return;
  const { data, error } = await supabase.from("groups").select("*").order("created_at", {
    ascending: false
  });
  if (error) {
    state.groups = [];
    renderGroupList();
    renderGroupSelects();
    return;
  }
  state.groups = data || [];
  renderGroupList();
  renderGroupSelects();
}

async function createGroup(name) {
  if (!supabase) return null;
  const trimmed = safeTrim(name);
  if (!trimmed) {
    setStatus("Enter a group name.", "error");
    return null;
  }

  const { data, error } = await supabase.from("groups").insert({ name: trimmed }).select().single();
  if (error) {
    setStatus("Could not create group", "error");
    return null;
  }

  state.groups = [data, ...state.groups.filter((group) => group.id !== data.id)];
  renderGroupList();
  renderGroupSelects();
  if (elements.gameGroup) {
    elements.gameGroup.value = data.id;
  }
  if (elements.summaryGroup) {
    elements.summaryGroup.value = data.id;
  }
  saveLastGroup(data.id);
  setStatus("Group created");
  return data;
}

async function fetchGroupPlayers(groupId) {
  if (!supabase || !groupId) return [];
  const { data, error } = await supabase
    .from("group_players")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });
  if (error) {
    setStatus("Could not load group players", "error");
    return [];
  }
  return data || [];
}

function renderGroupPlayers() {
  if (!elements.groupPlayerList) return;
  elements.groupPlayerList.innerHTML = "";

  if (!state.groupPlayers.length) {
    elements.groupPlayerList.classList.add("hidden");
    return;
  }

  elements.groupPlayerList.classList.remove("hidden");

  state.groupPlayers.forEach((player) => {
    const row = document.createElement("div");
    row.className = "group-player-row";
    row.innerHTML = `
      <div>
        <strong>${player.name}</strong>
        <span>Added ${formatShortDate(player.created_at)}</span>
      </div>
      <button class="ghost small" data-action="delete-group-player" data-id="${player.id}">
        ✕
      </button>
    `;
    elements.groupPlayerList.appendChild(row);
  });
}

async function openGroupModal(groupId) {
  if (!elements.groupModal) return;
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) return;
  state.activeGroupId = groupId;
  if (elements.groupModalTitle) {
    elements.groupModalTitle.textContent = group.name;
  }
  state.groupPlayers = await fetchGroupPlayers(groupId);
  renderGroupPlayers();
  elements.groupModal.classList.remove("hidden");
}

function closeGroupModal() {
  if (!elements.groupModal) return;
  elements.groupModal.classList.add("hidden");
  state.activeGroupId = null;
}

function openCreateGroupModal() {
  if (!elements.createGroupModal) return;
  elements.createGroupName.value = "";
  elements.createGroupModal.classList.remove("hidden");
  elements.createGroupName.focus();
}

function closeCreateGroupModal() {
  if (!elements.createGroupModal) return;
  elements.createGroupModal.classList.add("hidden");
}

function renderRosterList() {
  if (!elements.rosterList) return;
  elements.rosterList.innerHTML = "";

  if (!state.roster.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No players in this group yet.";
    elements.rosterList.appendChild(empty);
    return;
  }

  state.roster.forEach((player) => {
    const row = document.createElement("div");
    row.className = "roster-row";
    if (!player.active) {
      row.classList.add("inactive");
    }
    row.dataset.playerId = player.id;

    row.innerHTML = `
      <div>
        <strong>${player.name}</strong>
      </div>
      <div class="roster-actions">
        ${
          player.isHost
            ? `<span class="host-check">✓ Host</span>`
            : `<button class="ghost small" data-action="toggle">${player.active ? "✕" : "Undo"}</button>`
        }
      </div>
    `;

    elements.rosterList.appendChild(row);
  });
}

async function openRosterModal(groupId) {
  if (!elements.rosterModal) return;
  const hostName = requireHostName();
  if (!hostName) return;

  await getOrCreateGroupPlayer(groupId, hostName);
  const groupPlayers = await fetchGroupPlayers(groupId);
  const hostNormalized = normalizeName(hostName);

  const group = state.groups.find((item) => item.id === groupId);
  if (elements.rosterTitle) {
    elements.rosterTitle.textContent = group ? `${group.name} roster` : "Who's playing?";
  }

  state.roster = groupPlayers.map((player) => ({
    id: player.id,
    name: player.name,
    isHost: normalizeName(player.name) === hostNormalized,
    active: true
  }));

  if (!state.roster.some((player) => player.isHost)) {
    state.roster.unshift({
      id: `host:${hostNormalized}`,
      name: hostName,
      isHost: true,
      active: true
    });
  }

  renderRosterList();
  elements.rosterModal.classList.remove("hidden");
}

function closeRosterModal() {
  if (!elements.rosterModal) return;
  elements.rosterModal.classList.add("hidden");
  state.roster = [];
}

function recordRecentGame(game) {
  if (!game) return;
  const groupName =
    game.group_name ||
    game.groups?.name ||
    state.groups.find((group) => group.id === game.group_id)?.name ||
    null;
  const list = loadRecentGames();
  const next = [
    {
      code: game.code,
      name: game.name,
      created_at: game.created_at,
      ended_at: game.ended_at || null,
      group_id: game.group_id || null,
      group_name: groupName
    },
    ...list.filter((item) => item.code !== game.code)
  ];
  saveRecentGames(next);
  renderRecentGames(next);
}

function getGameDate(game) {
  const value = game.ended_at || game.created_at;
  const date = value ? new Date(value) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function renderRecentGames(list = loadRecentGames()) {
  if (!elements.recentGames) return;
  elements.recentGames.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No recent games yet.";
    elements.recentGames.appendChild(empty);
    return;
  }

  const sorted = list
    .slice()
    .sort((a, b) => getGameDate(b).getTime() - getGameDate(a).getTime());

  const groups = new Map();
  sorted.forEach((game) => {
    const hasGroup = Boolean(game.group_id);
    const key = hasGroup ? game.group_id : "ungrouped";
    const label = hasGroup ? game.group_name || "Unknown group" : "One-off games";
    if (!groups.has(key)) {
      groups.set(key, { label, games: [] });
    }
    groups.get(key).games.push(game);
  });

  const groupEntries = Array.from(groups.entries()).sort((a, b) => {
    if (a[0] === "ungrouped") return 1;
    if (b[0] === "ungrouped") return -1;
    return a[1].label.localeCompare(b[1].label);
  });

  groupEntries.forEach(([key, group], index) => {
    const details = document.createElement("details");
    details.className = "recent-group";
    if (index === 0) details.open = true;

    const summary = document.createElement("summary");
    summary.className = "recent-summary";
    summary.innerHTML = `
      <span>${group.label}</span>
      <strong>${group.games.length}</strong>
    `;
    details.appendChild(summary);

    const listWrap = document.createElement("div");
    listWrap.className = "recent-group-list";

    group.games.forEach((game) => {
      const row = document.createElement("div");
      row.className = "recent-item";
      const dateLabel = formatShortDate(game.ended_at || game.created_at);
      const canDelete = isLocalHostForGame(game.code);
      row.innerHTML = `
        <div>
          <strong>${game.name || "Home Game"}</strong>
          <span>${dateLabel} · ${game.code}</span>
        </div>
        <div class="recent-actions">
          <button class="ghost" data-action="open" data-code="${game.code}">Open</button>
          ${canDelete ? `<button class="danger-outline" data-action="delete" data-code="${game.code}">Delete</button>` : ""}
        </div>
      `;
      listWrap.appendChild(row);
    });

    details.appendChild(listWrap);
    elements.recentGames.appendChild(details);
  });
}

function setStatus(text, tone = "info") {
  elements.saveStatus.textContent = text;
  elements.saveStatus.dataset.tone = tone;
}

function setConnection(status) {
  elements.connectionStatus.textContent = status;
}

function formatCurrency(amount) {
  const currency = state.game?.currency || "$";
  const numeric = Number(amount) || 0;
  return `${currency}${numeric.toFixed(2)}`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString();
}

function formatShortDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function buildQuarterOptions() {
  if (!elements.summaryQuarter) return;
  const now = new Date();
  const currentQuarterStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  const options = [];
  for (let i = 0; i < 8; i += 1) {
    const date = new Date(currentQuarterStart);
    date.setUTCMonth(date.getUTCMonth() - i * 3);
    const year = date.getUTCFullYear();
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    const value = `${year}-Q${quarter}`;
    const label = `Q${quarter} ${year}`;
    options.push({ value, label });
  }

  elements.summaryQuarter.innerHTML = "";
  options.forEach((option) => {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    elements.summaryQuarter.appendChild(node);
  });
}

function parseQuarterValue(value) {
  const match = /^(\d{4})-Q([1-4])$/.exec(value || "");
  if (!match) return null;
  return { year: Number(match[1]), quarter: Number(match[2]) };
}

function getQuarterRange(year, quarter) {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 1));
  return { start, end };
}

function isGameSettled() {
  return Boolean(state.game?.ended_at);
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getJoinLink() {
  if (!state.game) return "";
  const url = new URL(window.location.href);
  url.searchParams.set("code", state.game.code);
  url.searchParams.delete("host");
  return url.toString();
}

function getHostLink() {
  if (!state.game) return "";
  const url = new URL(window.location.href);
  url.searchParams.set("code", state.game.code);
  url.searchParams.set("host", "1");
  return url.toString();
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus("Join link copied.");
    return true;
  } catch (err) {
    const temp = document.createElement("textarea");
    temp.value = value;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
    setStatus("Join link copied.");
    return true;
  }
}

function applyHostMode() {
  elements.hostModeToggle.checked = state.isHost;
  const toggleWrap = elements.hostModeToggle.closest(".toggle");
  if (toggleWrap) {
    toggleWrap.classList.toggle("hidden", !state.canHost);
  }
  if (elements.hostLayout) {
    elements.hostLayout.classList.toggle("hidden", !state.isHost);
  }
  elements.hostPanel.classList.toggle("hidden", !state.isHost);
  if (elements.playerPanel) {
    elements.playerPanel.classList.toggle("hidden", state.isHost);
  }
  if (elements.copyLink) {
    elements.copyLink.classList.toggle("hidden", !state.isHost);
  }
  if (elements.openLink) {
    elements.openLink.classList.toggle("hidden", !state.isHost);
  }
  if (elements.leaveGame) {
    elements.leaveGame.classList.toggle("hidden", !state.isHost);
  }
  elements.gameName.disabled = !state.isHost;
  elements.currency.disabled = !state.isHost;
  elements.defaultBuyIn.disabled = !state.isHost;
  elements.hostPlayerName.disabled = !state.isHost;
  elements.hostAddPlayer.disabled = !state.isHost;
  if (elements.settlementSummary) {
    elements.settlementSummary.classList.toggle("hidden", !state.isHost || !isGameSettled());
  }
  if (elements.playerSettledSummary) {
    elements.playerSettledSummary.classList.toggle("hidden", state.isHost || !isGameSettled());
  }
  if (elements.playerPanelHeading && elements.playerPanelSubtitle) {
    if (isGameSettled() && !state.isHost) {
      elements.playerPanelHeading.textContent = "Summary";
      elements.playerPanelSubtitle.textContent = "Final results for this game.";
    } else if (!state.isHost) {
      elements.playerPanelHeading.textContent = "Player";
      elements.playerPanelSubtitle.textContent = "";
    } else {
      elements.playerPanelHeading.textContent = "Player";
      elements.playerPanelSubtitle.textContent = "Join once, tap to add buy-ins.";
    }
  }
}

function applyGameStatus() {
  if (!state.game) return;
  const settledAt = state.game.ended_at;
  const settled = Boolean(settledAt);

  if (elements.gameStatusChip) {
    elements.gameStatusChip.textContent = settled ? "Settled" : "Live";
    elements.gameStatusChip.dataset.state = settled ? "settled" : "live";
  }

  elements.settledNotice.classList.toggle("hidden", !settled);
  if (settled && elements.settledAt) {
    elements.settledAt.textContent = formatDateTime(settledAt);
  }

  if (elements.openSettle) {
    elements.openSettle.classList.toggle("hidden", !state.isHost || settled);
  }

  const disableBuyins = settled;
  elements.playerAddDefault.disabled = disableBuyins;
  elements.playerName.disabled = disableBuyins;
  elements.joinAsPlayer.disabled = disableBuyins;
  elements.playerNotice.classList.toggle("hidden", !settled);
  elements.playerJoinNotice.classList.toggle("hidden", !settled);
  elements.hostPlayerName.disabled = !state.isHost || settled;
  elements.hostAddPlayer.disabled = !state.isHost || settled;
  if (elements.settleModal && settled) {
    elements.settleModal.classList.add("hidden");
  }
}

function hydrateInputs() {
  if (!state.game) return;
  elements.gameTitle.textContent = state.game.name || "Untitled Game";
  elements.gameCode.textContent = state.game.code || "—";
  elements.gameName.value = state.game.name || "";
  elements.currency.value = state.game.currency || "$";
  elements.defaultBuyIn.value = state.game.default_buyin || 0;
  const joinLink = getJoinLink();
  elements.joinLink.value = joinLink;

  QRCode.toCanvas(
    elements.qrCanvas,
    joinLink,
    { width: 140, margin: 1, color: { dark: "#1b140c", light: "#ffffff" } },
    () => {}
  );
}

function computeSummary() {
  const totalBuyins = state.buyins.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const buyinCount = state.buyins.length;
  const playersCount = state.players.length;
  const average = playersCount ? totalBuyins / playersCount : 0;
  const settledTotal = state.settlements.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  return { totalBuyins, buyinCount, playersCount, average, settledTotal };
}

function buildBuyinMap() {
  const map = new Map();
  state.buyins.forEach((buyin) => {
    const list = map.get(buyin.player_id) || [];
    list.push(buyin);
    map.set(buyin.player_id, list);
  });
  return map;
}

function buildBuyinTotals() {
  const totals = new Map();
  state.buyins.forEach((buyin) => {
    const next = (totals.get(buyin.player_id) || 0) + Number(buyin.amount || 0);
    totals.set(buyin.player_id, next);
  });
  return totals;
}

function getDefaultBuyinValue() {
  return Number(state.game?.default_buyin) || 0;
}

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function formatNumberValue(value) {
  return Number(value || 0).toFixed(2);
}

function showAdjustHint(tile, message) {
  if (!tile) return;
  const hint = tile.querySelector(".adjust-hint");
  if (!hint) return;
  hint.textContent = message;
  hint.classList.remove("hidden");
  clearTimeout(hint._timer);
  hint._timer = setTimeout(() => {
    hint.classList.add("hidden");
  }, 2000);
}

async function setPlayerBuyinCount(playerId, targetCount) {
  if (!supabase || !state.game) return;
  const defaultBuyin = getDefaultBuyinValue();
  if (defaultBuyin <= 0) {
    setStatus("Default buy-in must be greater than 0.", "error");
    return;
  }

  const desired = normalizeCount(targetCount);
  if (desired === null) return;

  const playerBuyins = state.buyins.filter((buyin) => buyin.player_id === playerId);
  const currentCount = playerBuyins.length;
  const diff = desired - currentCount;
  if (diff === 0) return;

  setStatus("Updating buy-ins…");
  let error = null;

  if (diff > 0) {
    const rows = Array.from({ length: diff }, () => ({
      game_id: state.game.id,
      player_id: playerId,
      amount: defaultBuyin
    }));
    ({ error } = await supabase.from("buyins").insert(rows));
  } else {
    const idsToRemove = playerBuyins
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, Math.abs(diff))
      .map((buyin) => buyin.id);
    if (idsToRemove.length) {
      ({ error } = await supabase.from("buyins").delete().in("id", idsToRemove));
    }
  }

  if (error) {
    setStatus("Update failed", "error");
    return;
  }

  await refreshData();
  setStatus("Buy-ins updated");
}

function handleEditCommit(event) {
  if (!state.isHost || isGameSettled()) return;
  const role = event.target.dataset.role;
  if (!["edit-count", "edit-total"].includes(role)) return;
  const tile = event.target.closest(".player-tile");
  if (!tile) return;
  const playerId = tile.dataset.playerId;
  const defaultBuyin = getDefaultBuyinValue();
  if (defaultBuyin <= 0) {
    setStatus("Default buy-in must be greater than 0.", "error");
    return;
  }

  const currentCount = state.buyins.filter((buyin) => buyin.player_id === playerId).length;
  const currentTotal = currentCount * defaultBuyin;

  if (role === "edit-count") {
    const count = normalizeCount(event.target.value);
    if (count === null) {
      event.target.value = currentCount;
      return;
    }
    if (count === currentCount) return;
    const totalInput = tile.querySelector("[data-role='edit-total']");
    if (totalInput) totalInput.value = formatNumberValue(count * defaultBuyin);
    setPlayerBuyinCount(playerId, count);
    return;
  }

  const totalValue = Number(event.target.value);
  if (!Number.isFinite(totalValue) || totalValue < 0) {
    event.target.value = formatNumberValue(currentTotal);
    return;
  }

  const count = Math.max(0, Math.round(totalValue / defaultBuyin));
  const adjustedTotal = count * defaultBuyin;

  if (count === currentCount) {
    event.target.value = formatNumberValue(adjustedTotal);
    return;
  }

  const countInput = tile.querySelector("[data-role='edit-count']");
  if (countInput) countInput.value = count;
  event.target.value = formatNumberValue(adjustedTotal);
  if (Math.abs(adjustedTotal - totalValue) > 0.001) {
    showAdjustHint(tile, "Adjusted to nearest buy-in.");
  }
  setPlayerBuyinCount(playerId, count);
}

function renderSummary() {
  const { totalBuyins, buyinCount, playersCount, average, settledTotal } = computeSummary();
  const cards = [
    { label: "Total pot", value: formatCurrency(totalBuyins) },
    { label: "Total buy-ins", value: buyinCount },
    { label: "Players", value: playersCount },
    { label: "Avg per player", value: formatCurrency(average) }
  ];

  if (isGameSettled() && state.settlements.length) {
    cards.splice(1, 0, { label: "Settled total", value: formatCurrency(settledTotal) });
  }

  elements.summary.innerHTML = "";
  cards.forEach((card) => {
    const node = document.createElement("div");
    node.className = "summary-card";
    node.innerHTML = `<span>${card.label}</span><strong>${card.value}</strong>`;
    elements.summary.appendChild(node);
  });
}

function renderPlayers() {
  const buyinMap = buildBuyinMap();
  const buyinLocked = isGameSettled();
  elements.players.innerHTML = "";

  if (state.players.length === 0) {
    const empty = document.createElement("div");
    empty.className = "player-tile";
    empty.innerHTML = "<strong>No players yet.</strong><p>Add players or let them join by link.</p>";
    elements.players.appendChild(empty);
    return;
  }

  state.players.forEach((player) => {
    const buyins = buyinMap.get(player.id) || [];
    const total = buyins.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const card = document.createElement("div");
    card.className = "player-tile";
    card.dataset.playerId = player.id;

    card.innerHTML = `
      <div class="player-header">
        <h4>${player.name}</h4>
        <div class="player-header-actions">
          <button data-action="edit" class="ghost">Edit</button>
          <button data-action="remove" class="ghost">Remove</button>
        </div>
      </div>
      <div class="player-stats">
        <label class="stat-field">
          <span>Buy-ins</span>
          <input data-role="edit-count" type="number" min="0" step="1" value="${buyins.length}" />
        </label>
        <label class="stat-field">
          <span>Total</span>
          <input data-role="edit-total" type="number" min="0" step="1" value="${Number(total).toFixed(2)}" />
        </label>
      </div>
      <span class="adjust-hint hidden">Adjusted to nearest buy-in.</span>
      <div class="player-actions">
        <button class="primary" data-action="add-default">Add buy-in (${formatCurrency(
          state.game?.default_buyin || 0
        )})</button>
      </div>
    `;

    elements.players.appendChild(card);

    if (buyinLocked) {
      card.querySelector("[data-action='add-default']").disabled = true;
      card.querySelector("[data-role='edit-count']").disabled = true;
      card.querySelector("[data-role='edit-total']").disabled = true;
      const editButton = card.querySelector("[data-action='edit']");
      const removeButton = card.querySelector("[data-action='remove']");
      if (editButton) editButton.disabled = true;
      if (removeButton) removeButton.disabled = true;
    }
  });
}

function renderPlayerSeat() {
  if (isGameSettled()) {
    elements.playerJoin.classList.add("hidden");
    elements.playerSeat.classList.add("hidden");
    if (elements.playerSettledSummary) {
      elements.playerSettledSummary.classList.remove("hidden");
    }
    return;
  }
  const player = state.players.find((item) => item.id === state.playerId);
  if (!player) {
    if (state.playerId && state.game) {
      clearStoredPlayer(state.game.code);
      state.playerId = null;
    }
    if (elements.playerMatchList) {
      elements.playerMatchList.classList.add("hidden");
      elements.playerMatchList.innerHTML = "";
    }
    elements.playerJoin.classList.remove("hidden");
    elements.playerSeat.classList.add("hidden");
    elements.playerBuyins.classList.add("hidden");
    if (elements.playerSettledSummary) {
      elements.playerSettledSummary.classList.add("hidden");
    }
    return;
  }

  const buyins = state.buyins.filter((item) => item.player_id === player.id);
  const total = buyins.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  elements.playerJoin.classList.add("hidden");
  elements.playerSeat.classList.remove("hidden");
  elements.playerBuyins.classList.add("hidden");
  if (elements.playerSettledSummary) {
    elements.playerSettledSummary.classList.add("hidden");
  }
  elements.playerCard.innerHTML = `
    <strong>${player.name}</strong>
    <div class="player-metrics">
      <div>
        <span>Buy-ins</span>
        <strong>${buyins.length}</strong>
      </div>
      <div>
        <span>Total</span>
        <strong>${formatCurrency(total)}</strong>
      </div>
    </div>
  `;

  elements.playerAddDefault.textContent = `Add buy-in (${formatCurrency(
    state.game?.default_buyin || 0
  )})`;
}

function renderLog() {
  const playerLookup = new Map(state.players.map((player) => [player.id, player.name]));
  const rows = state.buyins
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  elements.logTable.innerHTML = "";

  const header = document.createElement("div");
  header.className = "table-row header";
  header.innerHTML = "<div>Time</div><div>Player</div><div>Amount</div><div>Buy-in #</div>";
  elements.logTable.appendChild(header);

  if (rows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "table-row";
    empty.innerHTML = "<div>No buy-ins yet.</div>";
    elements.logTable.appendChild(empty);
    return;
  }

  const buyinIndexById = new Map();
  const perPlayerCount = new Map();
  state.buyins
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .forEach((buyin) => {
      const next = (perPlayerCount.get(buyin.player_id) || 0) + 1;
      perPlayerCount.set(buyin.player_id, next);
      buyinIndexById.set(buyin.id, next);
    });

  rows.forEach((buyin) => {
    const row = document.createElement("div");
    row.className = "table-row";
    row.innerHTML = `
      <div>${formatDateTime(buyin.created_at)}</div>
      <div>${playerLookup.get(buyin.player_id) || "Unknown"}</div>
      <div>${formatCurrency(buyin.amount)}</div>
      <div>${buyinIndexById.get(buyin.id) || 1}</div>
    `;
    elements.logTable.appendChild(row);
  });
}

function renderSettlementSummary() {
  const settled = isGameSettled();
  const containers = [
    { node: elements.settlementSummary, visible: settled && state.isHost, title: "Settlement", showHome: true },
    { node: elements.playerSettledSummary, visible: settled && !state.isHost, title: "Game settled", showHome: true }
  ];

  const playerLookup = new Map(state.players.map((player) => [player.id, player.name]));
  const rows = state.settlements
    .slice()
    .sort((a, b) => (playerLookup.get(a.player_id) || "").localeCompare(playerLookup.get(b.player_id) || ""));

  containers.forEach(({ node, visible, title, showHome }) => {
    if (!node) return;
    node.innerHTML = "";
    node.classList.toggle("hidden", !visible);
    if (!visible) return;

    const header = document.createElement("div");
    header.className = "panel-title";
    if (showHome) {
      header.innerHTML = `
        <div class="summary-header">
          <div>
            <h2>${title}</h2>
            <p>Final chips on hand by player.</p>
          </div>
          <button class="ghost" type="button" data-action="home">Home</button>
        </div>
      `;
    } else {
      header.innerHTML = `<h2>${title}</h2><p>Final chips on hand by player.</p>`;
    }
    node.appendChild(header);

    if (!rows.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No settlement data saved.";
      node.appendChild(empty);
      return;
    }

    const list = document.createElement("div");
    list.className = "settlement-list";
    let total = 0;
    rows.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "settlement-row";
      total += Number(entry.amount || 0);
      row.innerHTML = `
        <span>${playerLookup.get(entry.player_id) || "Unknown"}</span>
        <strong>${formatCurrency(entry.amount)}</strong>
      `;
      list.appendChild(row);
    });

    const totalRow = document.createElement("div");
    totalRow.className = "settlement-total";
    totalRow.innerHTML = `<span>Total chips</span><strong>${formatCurrency(total)}</strong>`;

    node.appendChild(list);
    node.appendChild(totalRow);
  });
}

function renderQuarterSummary({ groupName, label, rows, transfers }) {
  if (!elements.summaryBreakdown || !elements.summaryTransfers) return;
  elements.summaryTitle.textContent = "Quarterly Summary";
  elements.summarySubtitle.textContent = `${groupName} · ${label}`;

  elements.summaryBreakdown.innerHTML = "";
  elements.summaryTransfers.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No settled games in this quarter.";
    elements.summaryBreakdown.appendChild(empty);
    return;
  }

  const table = document.createElement("div");
  table.className = "summary-table";
  table.innerHTML = `
    <div class="summary-row header">
      <div>Player</div>
      <div>Games</div>
      <div>Buy-ins</div>
      <div>Cash-out</div>
      <div>Net</div>
    </div>
  `;

  rows.forEach((row) => {
    const node = document.createElement("div");
    node.className = "summary-row";
    node.innerHTML = `
      <div>${row.name}</div>
      <div>${row.games}</div>
      <div>${formatCurrency(row.buyins)}</div>
      <div>${formatCurrency(row.cashout)}</div>
      <div>${formatCurrency(row.net)}</div>
    `;
    table.appendChild(node);
  });

  elements.summaryBreakdown.appendChild(table);

  const transfersHeader = document.createElement("div");
  transfersHeader.className = "panel-title";
  transfersHeader.innerHTML = "<h3>Who pays who</h3><p>Direct transfers to settle up.</p>";
  elements.summaryTransfers.appendChild(transfersHeader);

  if (!transfers.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Everyone is settled.";
    elements.summaryTransfers.appendChild(empty);
    return;
  }

  transfers.forEach((transfer) => {
    const row = document.createElement("div");
    row.className = "transfer-row";
    row.innerHTML = `
      <span>${transfer.from} → ${transfer.to}</span>
      <strong>${formatCurrency(transfer.amount)}</strong>
    `;
    elements.summaryTransfers.appendChild(row);
  });
}

function computeTransfers(rows) {
  const winners = rows
    .filter((row) => row.net > 0.01)
    .map((row) => ({ ...row }))
    .sort((a, b) => b.net - a.net);
  const losers = rows
    .filter((row) => row.net < -0.01)
    .map((row) => ({ ...row }))
    .sort((a, b) => a.net - b.net);

  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < winners.length && j < losers.length) {
    const winner = winners[i];
    const loser = losers[j];
    const amount = Math.min(winner.net, Math.abs(loser.net));
    if (amount <= 0.01) break;
    transfers.push({ from: loser.name, to: winner.name, amount });
    winner.net -= amount;
    loser.net += amount;
    if (winner.net <= 0.01) i += 1;
    if (loser.net >= -0.01) j += 1;
  }
  return transfers;
}

async function loadQuarterSummary() {
  if (!supabase) return;
  const groupId = safeTrim(elements.summaryGroup?.value);
  if (!groupId) {
    setStatus("Select a group for summary.", "error");
    return;
  }

  const quarterValue = safeTrim(elements.summaryQuarter?.value);
  const parsed = parseQuarterValue(quarterValue);
  if (!parsed) return;

  const group = state.groups.find((item) => item.id === groupId);
  const groupName = group?.name || "Group";
  const { start, end } = getQuarterRange(parsed.year, parsed.quarter);
  const label = `Q${parsed.quarter} ${parsed.year}`;

  const { data: games, error: gameError } = await supabase
    .from("games")
    .select("id,ended_at")
    .eq("group_id", groupId)
    .not("ended_at", "is", null)
    .gte("ended_at", start.toISOString())
    .lt("ended_at", end.toISOString());

  if (gameError) {
    setStatus("Could not load summary", "error");
    return;
  }

  if (!games || games.length === 0) {
    renderQuarterSummary({ groupName, label, rows: [], transfers: [] });
    return;
  }

  const gameIds = games.map((game) => game.id);

  const [playersRes, buyinsRes, settlementsRes, groupPlayersRes] = await Promise.all([
    supabase.from("players").select("id,name,game_id,group_player_id").in("game_id", gameIds),
    supabase.from("buyins").select("game_id,player_id,amount").in("game_id", gameIds),
    supabase.from("settlements").select("game_id,player_id,amount").in("game_id", gameIds),
    supabase.from("group_players").select("id,name").eq("group_id", groupId)
  ]);

  if (settlementsRes.error && settlementsRes.error.code === "42P01") {
    setStatus("Settlement table missing. Run the README SQL.", "error");
    renderQuarterSummary({ groupName, label, rows: [], transfers: [] });
    return;
  }

  if (playersRes.error || buyinsRes.error || settlementsRes.error || groupPlayersRes.error) {
    setStatus("Could not load summary", "error");
    return;
  }

  const groupPlayerMap = new Map(
    (groupPlayersRes.data || []).map((player) => [player.id, player.name])
  );
  const playerById = new Map((playersRes.data || []).map((player) => [player.id, player]));

  const ledger = new Map();
  const gamesByKey = new Map();

  function getKey(player) {
    if (player.group_player_id && groupPlayerMap.has(player.group_player_id)) {
      return {
        key: `gp:${player.group_player_id}`,
        name: groupPlayerMap.get(player.group_player_id)
      };
    }
    const normalized = normalizeName(player.name || "Player");
    return { key: `name:${normalized}`, name: player.name || "Player" };
  }

  function ensureEntry(key, name) {
    if (!ledger.has(key)) {
      ledger.set(key, { name, buyins: 0, cashout: 0, games: 0, net: 0 });
    }
    if (!gamesByKey.has(key)) {
      gamesByKey.set(key, new Set());
    }
  }

  (buyinsRes.data || []).forEach((buyin) => {
    const player = playerById.get(buyin.player_id);
    if (!player) return;
    const { key, name } = getKey(player);
    ensureEntry(key, name);
    ledger.get(key).buyins += Number(buyin.amount || 0);
    gamesByKey.get(key).add(player.game_id);
  });

  (settlementsRes.data || []).forEach((settlement) => {
    const player = playerById.get(settlement.player_id);
    if (!player) return;
    const { key, name } = getKey(player);
    ensureEntry(key, name);
    ledger.get(key).cashout += Number(settlement.amount || 0);
    gamesByKey.get(key).add(player.game_id);
  });

  ledger.forEach((entry, key) => {
    const gamesPlayed = gamesByKey.get(key);
    entry.games = gamesPlayed ? gamesPlayed.size : 0;
    entry.net = entry.cashout - entry.buyins;
  });

  const rows = Array.from(ledger.values()).sort((a, b) => b.net - a.net);
  const transfers = computeTransfers(rows);
  renderQuarterSummary({ groupName, label, rows, transfers });
}

async function deleteGameByCode(code) {
  if (!code) return;
  if (!isLocalHostForGame(code)) {
    setStatus("Only the host can delete this game.", "error");
    return;
  }

  const localList = loadRecentGames();
  const item = localList.find((game) => game.code === code);
  const label = item?.name ? `${item.name} (${code})` : code;
  const currentGame = state.game?.code === code;
  const message = currentGame
    ? "This will close the current game and delete it for everyone. Continue?"
    : `Delete ${label}? This cannot be undone.`;

  if (!window.confirm(message)) return;

  if (currentGame) {
    clearCurrentGame();
  }

  if (supabase) {
    const { error } = await supabase.from("games").delete().eq("code", code);
    if (error) {
      setStatus("Delete failed", "error");
      return;
    }
  }

  const next = loadRecentGames().filter((game) => game.code !== code);
  saveRecentGames(next);
  await refreshRecentGames();
  setStatus("Game deleted");
}

async function deleteAllGames() {
  if (!supabase) return;
  const authorized = await ensureDeletePin();
  if (!authorized) return;

  if (!window.confirm("Delete ALL games? This cannot be undone.")) return;

  setStatus("Deleting all games…");

  if (state.game) {
    clearCurrentGame();
  }

  const localList = loadRecentGames();
  localList.forEach((game) => {
    if (game?.code) {
      localStorage.removeItem(hostKey(game.code));
      clearStoredPlayer(game.code);
    }
  });
  saveRecentGames([]);

  const { error } = await supabase
    .from("games")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) {
    setStatus("Delete failed", "error");
    return;
  }

  await refreshRecentGames();
  setStatus("All games deleted");
}

function renderAll() {
  if (!state.game) return;
  elements.landing.classList.add("hidden");
  if (elements.sessionsPanel) elements.sessionsPanel.classList.add("hidden");
  elements.gamePanel.classList.remove("hidden");
  hydrateInputs();
  applyHostMode();
  applyGameStatus();
  renderSummary();
  renderPlayers();
  renderPlayerSeat();
  renderLog();
  renderSettlementSummary();
}

async function refreshData() {
  if (!supabase || !state.game) return;
  try {
    const [gameRes, playersRes, buyinsRes, settlementsRes] = await Promise.all([
      supabase.from("games").select("*").eq("id", state.game.id).single(),
      supabase.from("players").select("*").eq("game_id", state.game.id).order("created_at"),
      supabase.from("buyins").select("*").eq("game_id", state.game.id).order("created_at", { ascending: false }),
      supabase
        .from("settlements")
        .select("*")
        .eq("game_id", state.game.id)
        .order("created_at", { ascending: false })
    ]);

    if (gameRes.error) throw gameRes.error;
    if (playersRes.error) throw playersRes.error;
    if (buyinsRes.error) throw buyinsRes.error;
    if (settlementsRes.error && settlementsRes.error.code !== "42P01") {
      throw settlementsRes.error;
    }

    state.game = gameRes.data;
    state.players = playersRes.data || [];
    state.buyins = buyinsRes.data || [];
    state.settlementsAvailable = !settlementsRes.error || settlementsRes.error.code !== "42P01";
    state.settlements = settlementsRes.error ? [] : settlementsRes.data || [];
    if (settlementsRes.error && settlementsRes.error.code === "42P01") {
      setStatus("Settlement table missing. Run the README SQL.", "error");
    }
    if (state.isHost) {
      recordRecentGame(state.game);
    }
    renderAll();
    setStatus("Synced");
  } catch (err) {
    setStatus("Sync failed", "error");
  }
}

async function startRealtime() {
  if (!supabase || !state.game) return;
  if (state.channel) {
    await supabase.removeChannel(state.channel);
  }

  const channel = supabase
    .channel(`game-${state.game.id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "games", filter: `id=eq.${state.game.id}` },
      refreshData
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "players", filter: `game_id=eq.${state.game.id}` },
      refreshData
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "buyins", filter: `game_id=eq.${state.game.id}` },
      refreshData
    );

  if (state.settlementsAvailable) {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "settlements", filter: `game_id=eq.${state.game.id}` },
      refreshData
    );
  }

  state.channel = channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      setConnection("Live");
    } else if (status === "CHANNEL_ERROR") {
      setConnection("Disconnected");
    }
  });
}

async function loadGameByCode(code) {
  if (!supabase) return;
  const trimmed = safeTrim(code).toUpperCase();
  if (!trimmed) return;

  const { data, error } = await supabase.from("games").select("*").eq("code", trimmed).single();
  if (error || !data) {
    setStatus("Game not found", "error");
    return null;
  }

  state.game = data;
  const storedPlayer = loadStoredPlayer(state.game.code);
  const storedHost = localStorage.getItem(hostKey(state.game.code)) === "true";
  state.playerId = storedPlayer?.id || null;
  state.canHost = storedHost;
  state.isHost = state.canHost;
  saveLastGroup(state.game.group_id || "");
  history.replaceState({}, "", state.isHost ? getHostLink() : getJoinLink());
  if (!state.isHost && storedPlayer?.name) {
    elements.playerName.value = storedPlayer.name;
  }
  if (state.isHost) {
    recordRecentGame(state.game);
  }

  renderAll();
  await refreshData();
  await startRealtime();
  return data;
}

async function createGame(options = {}) {
  if (!supabase) return;
  const hostName = requireHostName();
  if (!hostName) return;

  const name = safeTrim(elements.newGameName.value) || generateGameName();
  const currency = "$";
  const defaultBuyIn = Number(elements.newBuyIn.value) || 10;
  const groupId = safeTrim(elements.gameGroup?.value) || null;
  const roster = options.roster || null;
  let code = generateCode();

  let result = await supabase
    .from("games")
    .insert({ code, name, currency, default_buyin: defaultBuyIn, group_id: groupId })
    .select()
    .single();

  if (result.error && result.error.code === "23505") {
    code = generateCode();
    result = await supabase
      .from("games")
      .insert({ code, name, currency, default_buyin: defaultBuyIn, group_id: groupId })
      .select()
      .single();
  }

  if (result.error) {
    setStatus("Could not create game", "error");
    return;
  }

  state.game = result.data;
  state.isHost = true;
  state.canHost = true;
  localStorage.setItem(hostKey(state.game.code), "true");
  history.replaceState({}, "", getHostLink());
  recordRecentGame(state.game);
  saveLastGroup(state.game.group_id || "");
  saveHostName(hostName);

  if (roster && roster.length) {
    const hostEntry = roster.find((player) => player.isHost) || null;
    const playersPayload = roster.map((player) => ({
      game_id: state.game.id,
      name: player.isHost ? `${player.name} (Host)` : player.name,
      group_player_id: player.id.startsWith("host:") ? null : player.id
    }));

    const { data: createdPlayers, error: playersError } = await supabase
      .from("players")
      .insert(playersPayload)
      .select();

    if (playersError || !createdPlayers) {
      setStatus("Could not add players", "error");
      return;
    }

    const buyinsPayload = createdPlayers.map((player) => ({
      game_id: state.game.id,
      player_id: player.id,
      amount: defaultBuyIn
    }));

    const { error: buyinError } = await supabase.from("buyins").insert(buyinsPayload);
    if (buyinError) {
      setStatus("Could not seed buy-ins", "error");
    }

    const hostPlayer =
      createdPlayers.find(
        (player) => hostEntry && player.group_player_id && player.group_player_id === hostEntry.id
      ) ||
      createdPlayers.find((player) => player.name?.includes("(Host)")) ||
      null;

    if (hostPlayer) {
      state.playerId = hostPlayer.id;
      saveStoredPlayer(state.game.code, { id: hostPlayer.id, name: hostPlayer.name });
    }
  } else {
    let groupPlayerId = null;
    if (state.game.group_id) {
      const groupPlayer = await getOrCreateGroupPlayer(state.game.group_id, hostName);
      groupPlayerId = groupPlayer?.id || null;
    }

    const displayName = `${hostName} (Host)`;

    const { data: hostPlayer, error: hostError } = await supabase
      .from("players")
      .insert({ game_id: state.game.id, name: displayName, group_player_id: groupPlayerId })
      .select()
      .single();

    if (!hostError && hostPlayer) {
      state.playerId = hostPlayer.id;
      saveStoredPlayer(state.game.code, { id: hostPlayer.id, name: hostPlayer.name });
    }
  }

  renderAll();
  await refreshData();
  await startRealtime();
  setStatus("Game created");
  initGameName();
}

async function joinAsPlayer() {
  if (!supabase || !state.game) return;
  if (isGameSettled()) {
    setStatus("Game settled. New players are closed.", "error");
    return;
  }
  const name = safeTrim(elements.playerName.value);
  if (!name) return;

  const normalized = normalizeName(name);
  const matches = state.players.filter((player) => normalizeName(player.name) === normalized);
  if (matches.length === 1) {
    state.playerId = matches[0].id;
    await ensurePlayerLinked(matches[0]);
    saveStoredPlayer(state.game.code, { id: matches[0].id, name: matches[0].name });
    elements.playerName.value = "";
    if (elements.playerMatchList) {
      elements.playerMatchList.classList.add("hidden");
      elements.playerMatchList.innerHTML = "";
    }
    await refreshData();
    return;
  }

  if (matches.length > 1) {
    if (elements.playerMatchList) {
      elements.playerMatchList.classList.remove("hidden");
      elements.playerMatchList.innerHTML = "<p class=\"muted\">Select your seat:</p>";
      matches.forEach((player) => {
        const button = document.createElement("button");
        button.className = "ghost match-button";
        const joined = formatTime(player.created_at);
        button.textContent = `${player.name} · joined ${joined}`;
        button.dataset.playerId = player.id;
        elements.playerMatchList.appendChild(button);
      });
    }
    setStatus("Choose your existing seat.", "info");
    return;
  }

  let groupPlayerId = null;
  if (state.game.group_id) {
    const groupPlayer = await getOrCreateGroupPlayer(state.game.group_id, name);
    groupPlayerId = groupPlayer?.id || null;
  }

  const { data, error } = await supabase
    .from("players")
    .insert({ game_id: state.game.id, name, group_player_id: groupPlayerId })
    .select()
    .single();

  if (error) {
    setStatus("Could not join", "error");
    return;
  }

  state.playerId = data.id;
  saveStoredPlayer(state.game.code, { id: data.id, name });
  elements.playerName.value = "";
  await refreshData();
}

async function getOrCreateGroupPlayer(groupId, name) {
  if (!supabase || !groupId) return null;
  const normalized = normalizeName(name);
  if (!normalized) return null;

  const { data: existing, error } = await supabase
    .from("group_players")
    .select("id,name,normalized_name")
    .eq("group_id", groupId)
    .eq("normalized_name", normalized)
    .maybeSingle();

  if (error) {
    setStatus("Could not load group players", "error");
    return null;
  }

  if (existing) return existing;

  const { data, error: insertError } = await supabase
    .from("group_players")
    .insert({ group_id: groupId, name, normalized_name: normalized })
    .select()
    .single();

  if (insertError) {
    setStatus("Could not save player directory", "error");
    return null;
  }

  return data;
}

async function ensurePlayerLinked(player) {
  if (!supabase || !state.game?.group_id || player.group_player_id) return;
  const groupPlayer = await getOrCreateGroupPlayer(state.game.group_id, player.name);
  if (!groupPlayer?.id) return;
  await supabase.from("players").update({ group_player_id: groupPlayer.id }).eq("id", player.id);
}

async function addPlayerByName(name) {
  if (!supabase || !state.game) return;
  if (isGameSettled()) {
    setStatus("Game settled. New players are closed.", "error");
    return;
  }
  const trimmed = safeTrim(name);
  if (!trimmed) return;

  let groupPlayerId = null;
  if (state.game.group_id) {
    const groupPlayer = await getOrCreateGroupPlayer(state.game.group_id, trimmed);
    groupPlayerId = groupPlayer?.id || null;
  }

  const { error } = await supabase
    .from("players")
    .insert({ game_id: state.game.id, name: trimmed, group_player_id: groupPlayerId });

  if (error) {
    setStatus("Could not add player", "error");
    return;
  }

  await refreshData();
}

async function addBuyin(playerId, amount) {
  if (!supabase || !state.game) return;
  if (isGameSettled()) {
    setStatus("Game settled. Buy-ins are locked.", "error");
    return;
  }
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) return;

  const { error } = await supabase
    .from("buyins")
    .insert({ game_id: state.game.id, player_id: playerId, amount: numeric });

  if (error) {
    setStatus("Buy-in failed", "error");
    return;
  }

  await refreshData();
}


async function removePlayer(playerId) {
  if (!supabase) return;
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;
  if (!window.confirm(`Remove ${player.name}?`)) return;

  const { error } = await supabase.from("players").delete().eq("id", playerId);
  if (error) {
    setStatus("Remove failed", "error");
    return;
  }

  if (state.playerId === playerId) {
    state.playerId = null;
    clearStoredPlayer(state.game.code);
  }

  await refreshData();
}

async function updateGameSettings() {
  if (!supabase || !state.game || !state.isHost) return;
  const name = safeTrim(elements.gameName.value) || "Home Game";
  const currency = safeTrim(elements.currency.value) || "$";
  const defaultBuyIn = Number(elements.defaultBuyIn.value) || 0;

  const { error } = await supabase
    .from("games")
    .update({ name, currency, default_buyin: defaultBuyIn })
    .eq("id", state.game.id);

  if (error) {
    setStatus("Update failed", "error");
    return;
  }

  await refreshData();
}

function renderSettleList() {
  if (!elements.settleList) return;
  elements.settleList.innerHTML = "";

  if (state.players.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Add players before settling.";
    elements.settleList.appendChild(empty);
    return;
  }

  const totals = buildBuyinTotals();
  state.players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "settle-row";
    row.dataset.playerId = player.id;
    const buyinTotal = totals.get(player.id) || 0;
    row.innerHTML = `
      <div>
        <strong>${player.name}</strong>
        <span>Buy-ins: ${formatCurrency(buyinTotal)}</span>
      </div>
      <input type="number" min="0" step="1" placeholder="Chips remaining" />
    `;
    elements.settleList.appendChild(row);
  });
}

function setSettleError(message = "") {
  if (!elements.settleError) return;
  const trimmed = safeTrim(message);
  if (!trimmed) {
    elements.settleError.classList.add("hidden");
    elements.settleError.textContent = "";
    return;
  }
  elements.settleError.textContent = trimmed;
  elements.settleError.classList.remove("hidden");
}

function openSettlePanel() {
  if (!state.isHost || !state.game) {
    setStatus("Enable host mode to settle.", "error");
    return;
  }
  if (isGameSettled()) {
    setStatus("Game already settled.", "error");
    return;
  }
  if (!state.settlementsAvailable) {
    setStatus("Settlement table missing. Run the README SQL.", "error");
    return;
  }
  if (state.players.length === 0) {
    setStatus("Add players before settling.", "error");
    return;
  }
  setSettleError("");
  if (elements.settleModal) {
    elements.settleModal.classList.remove("hidden");
  }
  renderSettleList();
}

function closeSettlePanel() {
  if (elements.settleModal) {
    elements.settleModal.classList.add("hidden");
  }
  setSettleError("");
}

function openSummaryModal() {
  if (!elements.summaryModal) return;
  const groupId = safeTrim(elements.summaryGroup?.value);
  if (!groupId) {
    setStatus("Select a group for summary.", "error");
    return;
  }
  elements.summaryModal.classList.remove("hidden");
  loadQuarterSummary();
}

function closeSummaryModal() {
  if (!elements.summaryModal) return;
  elements.summaryModal.classList.add("hidden");
}

function openSessionsPage() {
  if (!elements.sessionsPanel) return;
  elements.landing.classList.add("hidden");
  elements.gamePanel.classList.add("hidden");
  elements.sessionsPanel.classList.remove("hidden");
  refreshRecentGames();
  refreshGroups();
  setStatus("Ready");
}

function closeSessionsPage() {
  if (!elements.sessionsPanel) return;
  elements.sessionsPanel.classList.add("hidden");
  elements.landing.classList.remove("hidden");
}

function clearCurrentGame() {
  if (supabase && state.channel) {
    supabase.removeChannel(state.channel);
    state.channel = null;
  }
  if (state.game?.code) {
    clearStoredPlayer(state.game.code);
    localStorage.removeItem(hostKey(state.game.code));
  }
  state.game = null;
  state.players = [];
  state.buyins = [];
  state.settlements = [];
  state.isHost = false;
  state.canHost = false;
  state.playerId = null;
  elements.gamePanel.classList.add("hidden");
  if (elements.sessionsPanel) elements.sessionsPanel.classList.add("hidden");
  if (elements.settledNotice) elements.settledNotice.classList.add("hidden");
  if (elements.settleModal) elements.settleModal.classList.add("hidden");
  if (elements.settlementSummary) elements.settlementSummary.classList.add("hidden");
  if (elements.playerSettledSummary) elements.playerSettledSummary.classList.add("hidden");
  elements.landing.classList.remove("hidden");
  history.replaceState({}, "", window.location.pathname);
  refreshRecentGames();
  refreshGroups();
  setConnection("Offline");
}

async function submitSettlement(event) {
  event.preventDefault();
  if (!supabase || !state.game || !state.isHost) return;
  if (isGameSettled()) {
    setStatus("Game already settled.", "error");
    return;
  }

  const rows = Array.from(elements.settleList.querySelectorAll(".settle-row"));
  const entries = [];
  let settledTotal = 0;
  for (const row of rows) {
    const input = row.querySelector("input");
    const playerId = row.dataset.playerId;
    const amount = Number(input.value);
    if (!Number.isFinite(amount) || amount < 0) {
      setSettleError("Enter valid chip totals for every player.");
      setStatus("Enter valid chip totals for every player.", "error");
      input.focus();
      return;
    }
    settledTotal += amount;
    entries.push({ game_id: state.game.id, player_id: playerId, amount });
  }

  const { totalBuyins } = computeSummary();
  if (Math.abs(settledTotal - totalBuyins) > 0.01) {
    const message = `Count error: settlement ${formatCurrency(
      settledTotal
    )} does not match pot ${formatCurrency(totalBuyins)}.`;
    setSettleError(message);
    setStatus(message, "error");
    return;
  }

  const { error: settlementError } = await supabase.from("settlements").insert(entries);
  if (settlementError) {
    setSettleError("Settlement failed. Please try again.");
    setStatus("Settlement failed", "error");
    return;
  }

  const settledAt = new Date().toISOString();
  const { error: gameError } = await supabase
    .from("games")
    .update({ ended_at: settledAt })
    .eq("id", state.game.id);

  if (gameError) {
    setStatus("Could not close game", "error");
    return;
  }

  state.game.ended_at = settledAt;
  recordRecentGame(state.game);
  setStatus("Settlement saved");
  closeSettlePanel();
  clearCurrentGame();
}

  if (!configMissing) {
    const params = new URLSearchParams(window.location.search);
    const incomingCode = safeTrim(params.get("code"));
    if (incomingCode) {
      loadGameByCode(incomingCode);
    } else {
      refreshRecentGames();
      refreshGroups();
    }
  } else {
    renderRecentGames();
  }

buildQuarterOptions();
initTheme();
initHostName();
initGameName();

// Event listeners

if (elements.themeToggle) {
  elements.themeToggle.addEventListener("click", () => {
    const isDark = document.body.classList.contains("theme-dark");
    const next = isDark ? "light" : "dark";
    localStorage.setItem(themeKey, next);
    applyTheme(next);
  });
}

elements.createGame.addEventListener("click", () => {
  if (configMissing) return;
  const groupId = safeTrim(elements.gameGroup?.value);
  if (groupId) {
    openRosterModal(groupId);
    return;
  }
  createGame();
});

if (elements.newHostName) {
  elements.newHostName.addEventListener("change", () => {
    const value = safeTrim(elements.newHostName.value);
    if (value) saveHostName(value);
  });
}

if (elements.joinGame) {
  elements.joinGame.addEventListener("click", () => {
    if (configMissing) return;
    loadGameByCode(elements.joinCode.value);
  });
}

if (elements.openSessions) {
  elements.openSessions.addEventListener("click", () => {
    if (configMissing) return;
    openSessionsPage();
  });
}

if (elements.sessionsBack) {
  elements.sessionsBack.addEventListener("click", () => {
    closeSessionsPage();
  });
}

if (elements.groupList) {
  elements.groupList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-action='open-group']");
    if (!row) return;
    const groupId = row.dataset.id;
    openGroupModal(groupId);
  });

  elements.groupList.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-action='open-group']");
    if (!row) return;
    event.preventDefault();
    openGroupModal(row.dataset.id);
  });
}

if (elements.createGroup) {
  elements.createGroup.addEventListener("click", () => {
    if (configMissing) return;
    openCreateGroupModal();
  });
}

if (elements.createGroupClose) {
  elements.createGroupClose.addEventListener("click", closeCreateGroupModal);
}

if (elements.createGroupCancel) {
  elements.createGroupCancel.addEventListener("click", closeCreateGroupModal);
}

if (elements.createGroupForm) {
  elements.createGroupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const created = await createGroup(elements.createGroupName?.value);
    if (created) {
      closeCreateGroupModal();
    }
  });
}

if (elements.groupModalClose) {
  elements.groupModalClose.addEventListener("click", closeGroupModal);
}

if (elements.groupPlayerForm) {
  elements.groupPlayerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.activeGroupId) return;
    const name = safeTrim(elements.groupPlayerName?.value);
    if (!name) return;
    await getOrCreateGroupPlayer(state.activeGroupId, name);
    elements.groupPlayerName.value = "";
    state.groupPlayers = await fetchGroupPlayers(state.activeGroupId);
    renderGroupPlayers();
    setStatus("Player added");
  });
}

if (elements.gameGroup) {
  elements.gameGroup.addEventListener("change", () => {
    saveLastGroup(elements.gameGroup.value);
  });
}

if (elements.summaryGroup) {
  elements.summaryGroup.addEventListener("change", () => {
    saveLastGroup(elements.summaryGroup.value);
    if (elements.summaryModal && !elements.summaryModal.classList.contains("hidden")) {
      loadQuarterSummary();
    }
  });
}

if (elements.summaryQuarter) {
  elements.summaryQuarter.addEventListener("change", () => {
    if (elements.summaryModal && !elements.summaryModal.classList.contains("hidden")) {
      loadQuarterSummary();
    }
  });
}

if (elements.recentGames) {
  elements.recentGames.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, code } = button.dataset;
    if (action === "open") {
      loadGameByCode(code);
      return;
    }
    if (action === "delete") {
      deleteGameByCode(code);
    }
  });
}

if (elements.deleteAllGames) {
  elements.deleteAllGames.addEventListener("click", () => {
    if (configMissing) return;
    deleteAllGames();
  });
}

if (elements.openSummary) {
  elements.openSummary.addEventListener("click", () => {
    if (configMissing) return;
    openSummaryModal();
  });
}

if (elements.summaryClose) {
  elements.summaryClose.addEventListener("click", closeSummaryModal);
}

if (elements.summaryModal) {
  elements.summaryModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      closeSummaryModal();
    }
  });
}

if (elements.groupModal) {
  elements.groupModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      closeGroupModal();
    }
  });
}

if (elements.createGroupModal) {
  elements.createGroupModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      closeCreateGroupModal();
    }
  });
}

if (elements.groupPlayerList) {
  elements.groupPlayerList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action='delete-group-player']");
    if (!button) return;
    const playerId = button.dataset.id;
    if (!playerId || !state.activeGroupId) return;
    if (!window.confirm("Remove this player from the group?")) return;
    const { error } = await supabase.from("group_players").delete().eq("id", playerId);
    if (error) {
      setStatus("Could not delete player", "error");
      return;
    }
    state.groupPlayers = await fetchGroupPlayers(state.activeGroupId);
    renderGroupPlayers();
    setStatus("Player removed");
  });
}

if (elements.rosterClose) {
  elements.rosterClose.addEventListener("click", closeRosterModal);
}

if (elements.rosterCancel) {
  elements.rosterCancel.addEventListener("click", closeRosterModal);
}

if (elements.rosterList) {
  elements.rosterList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='toggle']");
    if (!button) return;
    const row = button.closest(".roster-row");
    if (!row) return;
    const playerId = row.dataset.playerId;
    const player = state.roster.find((entry) => entry.id === playerId);
    if (!player || player.isHost) return;
    player.active = !player.active;
    renderRosterList();
  });
}

if (elements.rosterStart) {
  elements.rosterStart.addEventListener("click", async () => {
    const activeRoster = state.roster.filter((player) => player.active || player.isHost);
    if (!activeRoster.length) {
      setStatus("Select at least one player.", "error");
      return;
    }
    closeRosterModal();
    await createGame({ roster: activeRoster });
  });
}

if (elements.copyLink) {
  elements.copyLink.addEventListener("click", () => {
    if (!state.game) return;
    copyText(getJoinLink());
  });
}

if (elements.copyLinkInline) {
  elements.copyLinkInline.addEventListener("click", async () => {
    if (!state.game) return;
    const button = elements.copyLinkInline;
    const original = button.textContent;
    const ok = await copyText(getJoinLink());
    if (!ok) return;
    button.textContent = "Copied!";
    button.disabled = true;
    clearTimeout(button._copyTimer);
    button._copyTimer = setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1600);
  });
}

if (elements.openLink) {
  elements.openLink.addEventListener("click", () => {
    if (!state.game) return;
    window.open(getJoinLink(), "_blank");
  });
}

if (elements.leaveGame) {
  elements.leaveGame.addEventListener("click", () => {
    if (!state.game) return;
    if (!window.confirm("Leave this game and return home?")) return;
    clearCurrentGame();
    setStatus("Ready");
  });
}

if (elements.openSettle) {
  elements.openSettle.addEventListener("click", openSettlePanel);
}
if (elements.settleCancel) {
  elements.settleCancel.addEventListener("click", closeSettlePanel);
}
if (elements.settleForm) {
  elements.settleForm.addEventListener("submit", submitSettlement);
}

if (elements.settleModal) {
  elements.settleModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      closeSettlePanel();
    }
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (elements.settleModal && !elements.settleModal.classList.contains("hidden")) {
    closeSettlePanel();
  }
  if (elements.summaryModal && !elements.summaryModal.classList.contains("hidden")) {
    closeSummaryModal();
  }
  if (elements.groupModal && !elements.groupModal.classList.contains("hidden")) {
    closeGroupModal();
  }
  if (elements.createGroupModal && !elements.createGroupModal.classList.contains("hidden")) {
    closeCreateGroupModal();
  }
  if (elements.rosterModal && !elements.rosterModal.classList.contains("hidden")) {
    closeRosterModal();
  }
});

elements.hostModeToggle.addEventListener("change", () => {
  if (!state.game) return;
  state.isHost = elements.hostModeToggle.checked;
  if (state.isHost) {
    state.canHost = true;
    localStorage.setItem(hostKey(state.game.code), "true");
  }
  applyHostMode();
  applyGameStatus();
});

elements.hostAddPlayer.addEventListener("click", async () => {
  if (!state.isHost) return;
  const name = safeTrim(elements.hostPlayerName.value);
  if (!name) return;
  elements.hostPlayerName.value = "";
  await addPlayerByName(name);
});

elements.hostPlayerName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    elements.hostAddPlayer.click();
  }
});

elements.players.addEventListener("click", (event) => {
  if (!state.isHost) return;
  if (isGameSettled()) return;
  const action = event.target.dataset.action;
  if (!action) return;
  const tile = event.target.closest(".player-tile");
  if (!tile) return;
  const playerId = tile.dataset.playerId;

  if (action === "remove") {
    removePlayer(playerId);
    return;
  }

  if (action === "edit") {
    tile.classList.toggle("editing");
    const countInput = tile.querySelector("[data-role='edit-count']");
    if (countInput) countInput.focus();
    return;
  }

  if (action === "add-default") {
    addBuyin(playerId, state.game?.default_buyin || 0);
    return;
  }
});

elements.players.addEventListener("change", handleEditCommit);
elements.players.addEventListener("blur", handleEditCommit, true);

elements.players.addEventListener("keydown", (event) => {
  if (!state.isHost) return;
  if (isGameSettled()) return;
  if (event.key !== "Enter") return;
  if (!["edit-count", "edit-total"].includes(event.target.dataset.role)) return;
  event.preventDefault();
  handleEditCommit(event);
});

elements.joinAsPlayer.addEventListener("click", () => {
  joinAsPlayer();
});

if (elements.playerMatchList) {
  elements.playerMatchList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-player-id]");
    if (!button) return;
    const playerId = button.dataset.playerId;
    const player = state.players.find((item) => item.id === playerId);
    if (!player || !state.game) return;
    state.playerId = player.id;
    await ensurePlayerLinked(player);
    saveStoredPlayer(state.game.code, { id: player.id, name: player.name });
    elements.playerMatchList.classList.add("hidden");
    elements.playerMatchList.innerHTML = "";
    elements.playerName.value = "";
    await refreshData();
  });
}

if (elements.playerSettledSummary) {
  elements.playerSettledSummary.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='home']");
    if (!button) return;
    clearCurrentGame();
    setStatus("Ready");
  });
}

if (elements.settlementSummary) {
  elements.settlementSummary.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='home']");
    if (!button) return;
    clearCurrentGame();
    setStatus("Ready");
  });
}

elements.playerName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinAsPlayer();
  }
});

elements.playerName.addEventListener("input", () => {
  if (elements.playerMatchList) {
    elements.playerMatchList.classList.add("hidden");
    elements.playerMatchList.innerHTML = "";
  }
});

elements.playerAddDefault.addEventListener("click", () => {
  if (!state.playerId) return;
  addBuyin(state.playerId, state.game?.default_buyin || 0);
});

elements.gameName.addEventListener("change", updateGameSettings);

elements.currency.addEventListener("change", updateGameSettings);

elements.defaultBuyIn.addEventListener("change", updateGameSettings);

window.addEventListener("online", () => setConnection("Online"));
window.addEventListener("offline", () => setConnection("Offline"));
