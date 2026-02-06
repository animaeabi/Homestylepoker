import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.3";
import html2canvas from "https://esm.sh/html2canvas@1.4.1";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (selector) => document.querySelector(selector);

const elements = {
  landing: $("#landing"),
  letsDealCard: $("#letsDealCard"),
  letsDealToggle: $("#letsDealToggle"),
  letsDealBody: $("#letsDealBody"),
  toggleGroups: $("#toggleGroups"),
  groupsPanel: $("#groupsPanel"),
  newGameName: $("#newGameName"),
  newBuyIn: $("#newBuyIn"),
  newHostName: $("#newHostName"),
  gameGroup: $("#gameGroup"),
  createGame: $("#createGame"),
  joinPlayer: $("#joinPlayer"),
  joinCode: $("#joinCode"),
  joinGame: $("#joinGame"),
  openSessions: $("#openSessions"),
  homeTitle: $("#homeTitle"),
  brandIcon: $("#brandIcon"),
  qrButton: $("#qrButton"),
  qrModal: $("#qrModal"),
  qrClose: $("#qrClose"),
  qrCanvasLarge: $("#qrCanvasLarge"),
  groupList: $("#groupList"),
  createGroup: $("#createGroup"),
  groupModal: $("#groupModal"),
  groupModalTitle: $("#groupModalTitle"),
  groupModalClose: $("#groupModalClose"),
  groupRename: $("#groupRename"),
  groupDelete: $("#groupDelete"),
  groupLockStatus: $("#groupLockStatus"),
  groupLockSet: $("#groupLockSet"),
  groupLockRemove: $("#groupLockRemove"),
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
  joinPlayerModal: $("#joinPlayerModal"),
  joinPlayerClose: $("#joinPlayerClose"),
  joinPlayerName: $("#joinPlayerName"),
  joinPlayerContinue: $("#joinPlayerContinue"),
  joinPlayerStepName: $("#joinPlayerStepName"),
  joinPlayerStepList: $("#joinPlayerStepList"),
  joinPlayerStepCode: $("#joinPlayerStepCode"),
  joinPlayerListHint: $("#joinPlayerListHint"),
  joinPlayerGameList: $("#joinPlayerGameList"),
  joinPlayerUseCode: $("#joinPlayerUseCode"),
  joinPlayerCode: $("#joinPlayerCode"),
  joinPlayerCodeHint: $("#joinPlayerCodeHint"),
  joinPlayerBack: $("#joinPlayerBack"),
  joinPlayerSubmit: $("#joinPlayerSubmit"),
  rosterModal: $("#rosterModal"),
  lockPhraseModal: $("#lockPhraseModal"),
  lockPhraseHint: $("#lockPhraseHint"),
  lockPhraseInput: $("#lockPhraseInput"),
  lockPhraseClose: $("#lockPhraseClose"),
  lockPhraseCancel: $("#lockPhraseCancel"),
  lockPhraseSubmit: $("#lockPhraseSubmit"),
  confirmModal: $("#confirmModal"),
  confirmMessage: $("#confirmMessage"),
  confirmClose: $("#confirmClose"),
  confirmCancel: $("#confirmCancel"),
  confirmOk: $("#confirmOk"),
  rosterTitle: $("#rosterTitle"),
  rosterClose: $("#rosterClose"),
  rosterList: $("#rosterList"),
  rosterCancel: $("#rosterCancel"),
  rosterStart: $("#rosterStart"),
  summaryGroup: $("#summaryGroup"),
  summaryQuarter: $("#summaryQuarter"),
  summaryUseCustom: $("#summaryUseCustom"),
  summaryCustomRow: $("#summaryCustomRow"),
  summaryStart: $("#summaryStart"),
  summaryEnd: $("#summaryEnd"),
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
  settleRemaining: $("#settleRemaining"),
  settlementSummary: $("#settlementSummary"),
  summaryModal: $("#summaryModal"),
  summaryClose: $("#summaryClose"),
  summaryTitle: $("#summaryTitle"),
  summarySubtitle: $("#summarySubtitle"),
  summaryBreakdown: $("#summaryBreakdown"),
  summaryTransfers: $("#summaryTransfers"),
  statsModal: $("#statsModal"),
  statsClose: $("#statsClose"),
  statsTitle: $("#statsTitle"),
  statsSubtitle: $("#statsSubtitle"),
  statsRange: $("#statsRange"),
  statsSummary: $("#statsSummary"),
  statsLeaderboard: $("#statsLeaderboard"),
  hostModeToggle: $("#hostModeToggle"),
  openGuide: $("#openGuide"),
  guideModal: $("#guideModal"),
  guideClose: $("#guideClose"),
  hostPanel: $("#hostPanel"),
  summary: $("#summary"),
  hostAddToggle: $("#hostAddToggle"),
  hostAddForm: $("#hostAddForm"),
  hostPlayerName: $("#hostPlayerName"),
  hostAddPlayer: $("#hostAddPlayer"),
  players: $("#players"),
  recentGames: $("#recentGames"),
  deleteAllGames: $("#deleteAllGames"),
  sessionsSettings: $("#sessionsSettings"),
  settingsModal: $("#settingsModal"),
  settingsClose: $("#settingsClose"),
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
  playerSettle: $("#playerSettle"),
  playerSettleAmount: $("#playerSettleAmount"),
  playerSubmitChips: $("#playerSubmitChips"),
  playerSettleStatus: $("#playerSettleStatus"),
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
  unlockedGroups: new Set(),
  roster: [],
  isHost: false,
  canHost: false,
  playerId: null,
  channel: null,
  statsGroupId: null
};

const configMissing =
  !SUPABASE_URL ||
  SUPABASE_URL.startsWith("REPLACE") ||
  !SUPABASE_ANON_KEY ||
  SUPABASE_ANON_KEY.startsWith("REPLACE");

let statusTimer = null;
let joinFlowName = "";
let joinFlowHasList = false;
let lockResolve = null;
let confirmResolve = null;

if (configMissing) {
  elements.configNotice.classList.remove("hidden");
  elements.createGame.disabled = true;
  if (elements.joinPlayer) elements.joinPlayer.disabled = true;
  if (elements.joinGame) elements.joinGame.disabled = true;
  elements.joinAsPlayer.disabled = true;
  elements.hostAddPlayer.disabled = true;
  if (elements.hostAddToggle) elements.hostAddToggle.disabled = true;
  if (elements.openSettle) elements.openSettle.disabled = true;
  if (elements.playerSubmitChips) elements.playerSubmitChips.disabled = true;
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
const lightsOffKey = "poker_lights_off";
const deletePinKey = "poker_delete_pin_ok";
const deletePin = "2/7";
const lastGroupKey = "poker_last_group";
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
  "High-Stakes",
  "Neon",
  "Midnight",
  "Diamond",
  "Golden",
  "Velvet",
  "Whisper",
  "Big Blind",
  "Cold Deck",
  "Deep Stack",
  "Short Stack",
  "Buttoned",
  "Slick",
  "Smooth",
  "Stacked",
  "Final",
  "Backdoor"
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
const namePlaceholderLoading = "Generating name...";
let nameSuggestionTimer = null;

const safeTrim = (value) => (value || "").trim();

function normalizeName(name) {
  return safeTrim(name).replace(/\s+/g, " ").toLowerCase();
}

function applyTheme(theme) {
  const mode = theme === "light" ? "light" : "dark";
  document.body.classList.toggle("theme-light", mode === "light");
  document.body.classList.toggle("theme-dark", mode === "dark");
  if (elements.themeToggle) {
    elements.themeToggle.checked = mode === "light";
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

function applyLightsOff(isOff) {
  document.body.classList.toggle("lights-off", isOff);
  if (elements.brandIcon) {
    elements.brandIcon.setAttribute("aria-pressed", isOff ? "true" : "false");
  }
  if (!isOff) {
    restartHeaderAnimations();
  }
}

function initHeaderLights() {
  const stored = localStorage.getItem(lightsOffKey);
  applyLightsOff(stored === "1");
}

function restartHeaderAnimations() {
  document.body.classList.add("lights-reset");
  void document.body.offsetHeight;
  document.body.classList.remove("lights-reset");
}

function openLockPhraseModal(groupName) {
  if (!elements.lockPhraseModal) return;
  elements.lockPhraseHint.textContent = groupName ? `Locked group: ${groupName}` : "This group is locked.";
  elements.lockPhraseInput.value = "";
  elements.lockPhraseModal.classList.remove("hidden");
  setTimeout(() => elements.lockPhraseInput?.focus(), 0);
}

function closeLockPhraseModal() {
  if (!elements.lockPhraseModal) return;
  elements.lockPhraseModal.classList.add("hidden");
}

function promptLockPhrase(groupName) {
  return new Promise((resolve) => {
    if (lockResolve) lockResolve(null);
    lockResolve = resolve;
    openLockPhraseModal(groupName);
  });
}

function showJoinStep(step) {
  if (!elements.joinPlayerStepName) return;
  elements.joinPlayerStepName.classList.toggle("hidden", step !== "name");
  elements.joinPlayerStepList.classList.toggle("hidden", step !== "list");
  elements.joinPlayerStepCode.classList.toggle("hidden", step !== "code");
}

function openJoinPlayerModal() {
  if (!elements.joinPlayerModal) return;
  joinFlowName = "";
  joinFlowHasList = false;
  elements.joinPlayerGameList.innerHTML = "";
  elements.joinPlayerListHint.textContent = "";
  elements.joinPlayerCodeHint.textContent = "";
  elements.joinPlayerName.value = "";
  elements.joinPlayerCode.value = "";
  showJoinStep("name");
  elements.joinPlayerModal.classList.remove("hidden");
  setTimeout(() => elements.joinPlayerName?.focus(), 0);
}

function closeJoinPlayerModal() {
  if (!elements.joinPlayerModal) return;
  elements.joinPlayerModal.classList.add("hidden");
}

async function fetchActiveGamesByGroups(groupIds) {
  if (!supabase || !groupIds.length) return [];
  const { data, error } = await supabase
    .from("games")
    .select("id,code,name,group_id,created_at")
    .in("group_id", groupIds)
    .is("ended_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    setStatus("Could not load active games", "error");
    return [];
  }
  return data || [];
}

async function getGroupNameMap(groupIds) {
  const map = new Map();
  state.groups.forEach((group) => map.set(group.id, group.name));
  const missing = groupIds.filter((id) => !map.has(id));
  if (!missing.length || !supabase) return map;
  const { data, error } = await supabase.from("groups").select("id,name").in("id", missing);
  if (!error && data) {
    data.forEach((group) => map.set(group.id, group.name));
  }
  return map;
}

async function joinGameByCodeWithName(code, name) {
  const loaded = await loadGameByCode(code, { allowSettled: false });
  if (!loaded) return false;
  elements.playerName.value = name;
  await joinAsPlayer();
  closeJoinPlayerModal();
  return true;
}

async function handleJoinPlayerContinue() {
  if (!supabase) return;
  const name = safeTrim(elements.joinPlayerName.value);
  if (!name) {
    setStatus("Enter your name to continue.", "error");
    return;
  }
  joinFlowName = name;
  const normalized = normalizeName(name);
  const { data, error } = await supabase
    .from("group_players")
    .select("group_id")
    .eq("normalized_name", normalized);
  if (error) {
    setStatus("Could not check groups.", "error");
    return;
  }
  const groupIds = Array.from(new Set((data || []).map((row) => row.group_id))).filter(Boolean);
  if (!groupIds.length) {
    joinFlowHasList = false;
    elements.joinPlayerCodeHint.textContent = "No group match found. Enter a game code.";
    showJoinStep("code");
    return;
  }

  const activeGames = await fetchActiveGamesByGroups(groupIds);
  if (activeGames.length === 1) {
    await joinGameByCodeWithName(activeGames[0].code, name);
    return;
  }

  if (!activeGames.length) {
    joinFlowHasList = false;
    elements.joinPlayerCodeHint.textContent = "No active group game found. Enter a game code.";
    showJoinStep("code");
    return;
  }

  joinFlowHasList = true;
  const groupNameMap = await getGroupNameMap(groupIds);
  elements.joinPlayerListHint.textContent = "Select your active table.";
  elements.joinPlayerGameList.innerHTML = "";
  activeGames.forEach((game) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "join-player-item";
    const groupName = groupNameMap.get(game.group_id) || "Group";
    button.innerHTML = `
      <strong>${game.name || "Home Game"}</strong>
      <span>${groupName} · ${game.code}</span>
    `;
    button.addEventListener("click", () => joinGameByCodeWithName(game.code, joinFlowName));
    elements.joinPlayerGameList.appendChild(button);
  });
  showJoinStep("list");
}

function handleJoinPlayerBack() {
  if (joinFlowHasList) {
    showJoinStep("list");
  } else {
    showJoinStep("name");
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

function isGroupUnlocked(groupId) {
  if (!groupId) return false;
  return state.unlockedGroups.has(groupId);
}

function setGroupUnlocked(groupId, value) {
  if (!groupId) return;
  if (value) {
    state.unlockedGroups.add(groupId);
    return;
  }
  state.unlockedGroups.delete(groupId);
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

async function hashPhrase(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function generateGameName() {
  const adjective = pickRandom(gameNameAdjectives);
  const noun = pickRandom(gameNameNouns);
  return `${adjective} ${noun}`;
}

async function isGameNameTaken(name) {
  if (!supabase) return false;
  const { data, error } = await supabase.from("games").select("id").eq("name", name).limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

async function ensureUniqueGameName(seed) {
  let candidate = safeTrim(seed) || generateGameName();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!(await isGameNameTaken(candidate))) return candidate;
    candidate = generateGameName();
  }
  return `${generateGameName()} ${Math.floor(Math.random() * 90 + 10)}`;
}

async function initGameName() {
  if (!elements.newGameName) return;
  if (safeTrim(elements.newGameName.value)) return;
  elements.newGameName.placeholder = namePlaceholderLoading;
  if (nameSuggestionTimer) {
    clearTimeout(nameSuggestionTimer);
  }
  nameSuggestionTimer = setTimeout(async () => {
    if (!elements.newGameName || safeTrim(elements.newGameName.value)) return;
    const suggestion = await ensureUniqueGameName("");
    elements.newGameName.placeholder = suggestion;
    elements.newGameName.dataset.suggested = suggestion;
  }, 4000);
}

function isDeletePinAuthorized() {
  return localStorage.getItem(deletePinKey) === "true";
}

async function ensureDeletePin() {
  return true;
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
  const unlocked = await ensureGroupUnlocked(groupId);
  if (!unlocked) return;
  state.activeGroupId = groupId;
  if (elements.groupModalTitle) {
    elements.groupModalTitle.textContent = group.name;
  }
  if (elements.groupRename) {
    elements.groupRename.disabled = false;
  }
  if (elements.groupDelete) {
    elements.groupDelete.disabled = false;
  }
  updateGroupLockUI(group);
  state.groupPlayers = await fetchGroupPlayers(groupId);
  renderGroupPlayers();
  elements.groupModal.classList.remove("hidden");
}

function closeGroupModal() {
  if (!elements.groupModal) return;
  elements.groupModal.classList.add("hidden");
  if (state.activeGroupId) {
    setGroupUnlocked(state.activeGroupId, false);
  }
  state.activeGroupId = null;
}

function updateGroupLockUI(group) {
  if (!group) return;
  const locked = Boolean(group.lock_phrase_hash);
  const unlocked = isGroupUnlocked(group.id);
  if (elements.groupLockStatus) {
    elements.groupLockStatus.textContent = locked ? (unlocked ? "Unlocked" : "Locked") : "Open";
  }
  if (elements.groupLockSet) {
    elements.groupLockSet.disabled = locked && !unlocked;
    elements.groupLockSet.textContent = locked ? "Change phrase" : "Set phrase";
  }
  if (elements.groupLockRemove) {
    elements.groupLockRemove.disabled = !locked;
  }
}

function handleGroupLockError(error) {
  if (!error) return false;
  if (error.code === "42703") {
    setStatus("Lock phrase unavailable. Run the README SQL to add lock_phrase_hash.", "error");
    return true;
  }
  return false;
}

async function ensureGroupUnlocked(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group || !group.lock_phrase_hash) return true;
  if (isGroupUnlocked(groupId)) return true;

  const phrase = await promptLockPhrase(group.name);
  if (phrase === null) return false;
  if (!phrase.trim()) return false;

  const digest = await hashPhrase(phrase.trim());
  if (digest === group.lock_phrase_hash) {
    setGroupUnlocked(groupId, true);
    return true;
  }
  setStatus("Incorrect lock phrase.", "error");
  return false;
}

async function setGroupLockPhrase() {
  if (!supabase || !state.activeGroupId) return;
  const group = state.groups.find((item) => item.id === state.activeGroupId);
  if (!group) return;
  const phrase = window.prompt("Set lock phrase");
  if (phrase === null) return;
  if (!phrase.trim()) {
    setStatus("Enter a lock phrase.", "error");
    return;
  }
  const digest = await hashPhrase(phrase.trim());
  const { error } = await supabase
    .from("groups")
    .update({ lock_phrase_hash: digest })
    .eq("id", group.id);
  if (error) {
    if (handleGroupLockError(error)) return;
    setStatus("Could not set lock phrase", "error");
    return;
  }
  state.groups = state.groups.map((item) =>
    item.id === group.id ? { ...item, lock_phrase_hash: digest } : item
  );
  setGroupUnlocked(group.id, true);
  updateGroupLockUI({ ...group, lock_phrase_hash: digest });
  setStatus("Lock phrase set");
}

async function removeGroupLockPhrase() {
  if (!supabase || !state.activeGroupId) return;
  const group = state.groups.find((item) => item.id === state.activeGroupId);
  if (!group) return;
  if (!window.confirm("Remove lock phrase?")) return;
  const { error } = await supabase
    .from("groups")
    .update({ lock_phrase_hash: null })
    .eq("id", group.id);
  if (error) {
    if (handleGroupLockError(error)) return;
    setStatus("Could not remove lock phrase", "error");
    return;
  }
  state.groups = state.groups.map((item) =>
    item.id === group.id ? { ...item, lock_phrase_hash: null } : item
  );
  setGroupUnlocked(group.id, false);
  updateGroupLockUI({ ...group, lock_phrase_hash: null });
  setStatus("Lock phrase removed");
}

async function renameActiveGroup() {
  if (!supabase || !state.activeGroupId) return;
  const group = state.groups.find((item) => item.id === state.activeGroupId);
  if (!group) return;
  const unlocked = await ensureGroupUnlocked(group.id);
  if (!unlocked) return;
  const nextName = safeTrim(window.prompt("New group name", group.name));
  if (!nextName || nextName === group.name) return;
  const { error } = await supabase.from("groups").update({ name: nextName }).eq("id", group.id);
  if (error) {
    setStatus("Could not rename group", "error");
    return;
  }
  state.groups = state.groups.map((item) =>
    item.id === group.id ? { ...item, name: nextName } : item
  );
  renderGroupList();
  renderGroupSelects();
  if (elements.groupModalTitle) elements.groupModalTitle.textContent = nextName;
  setStatus("Group renamed");
}

async function deleteActiveGroup() {
  if (!supabase || !state.activeGroupId) return;
  const group = state.groups.find((item) => item.id === state.activeGroupId);
  if (!group) return;
  const unlocked = await ensureGroupUnlocked(group.id);
  if (!unlocked) return;
  if (!window.confirm(`Delete group "${group.name}"? This will remove all its players.`)) return;
  const { error } = await supabase.from("groups").delete().eq("id", group.id);
  if (error) {
    setStatus("Could not delete group", "error");
    return;
  }
  state.groups = state.groups.filter((item) => item.id !== group.id);
  renderGroupList();
  renderGroupSelects();
  setGroupUnlocked(group.id, false);
  closeGroupModal();
  setStatus("Group deleted");
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

  const group = state.groups.find((item) => item.id === groupId);
  const hostNormalized = normalizeName(hostName);
  let hostExists = false;

  if (supabase && groupId) {
    const { data, error } = await supabase
      .from("group_players")
      .select("id")
      .eq("group_id", groupId)
      .eq("normalized_name", hostNormalized)
      .maybeSingle();
    if (error) {
      setStatus("Could not check group membership", "error");
      return;
    }
    hostExists = Boolean(data);
  }

  if (!hostExists && group?.lock_phrase_hash) {
    const unlocked = await ensureGroupUnlocked(groupId);
    if (!unlocked) return;
  }

  await getOrCreateGroupPlayer(groupId, hostName);
  const groupPlayers = await fetchGroupPlayers(groupId);
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
  const groupId = safeTrim(elements.gameGroup?.value);
  if (groupId) {
    setGroupUnlocked(groupId, false);
  }
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

    const summary = document.createElement("summary");
    summary.className = "recent-summary";
    summary.innerHTML = `
      <span>${group.label}</span>
    `;
    details.appendChild(summary);

    const listWrap = document.createElement("div");
    listWrap.className = "recent-group-list";
    if (group.games.length > 3) {
      listWrap.classList.add("scrollable");
    }

    if (key !== "ungrouped") {
      const actions = document.createElement("div");
      actions.className = "recent-group-actions";
      actions.innerHTML = `<button class="ghost small stats-btn" data-action="stats" data-group-id="${key}">Leaderboard</button>`;
      listWrap.appendChild(actions);
    }

    group.games.forEach((game) => {
      const row = document.createElement("div");
      row.className = "recent-item";
      const dateLabel = formatShortDate(game.ended_at || game.created_at);
      row.innerHTML = `
        <div>
          <strong>${game.name || "Home Game"}</strong>
          <span>${dateLabel}</span>
        </div>
        <div class="recent-actions">
          <button class="ghost" data-action="open" data-code="${game.code}" data-group-id="${game.group_id || ""}">Open</button>
          <button class="danger-outline" data-action="delete" data-code="${game.code}" data-group-id="${game.group_id || ""}">Delete</button>
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
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
  if (!text) return;
  const duration = tone === "error" ? 5000 : 2000;
  statusTimer = setTimeout(() => {
    elements.saveStatus.textContent = "";
    elements.saveStatus.dataset.tone = "";
  }, duration);
}

function setConnection(status) {
  elements.connectionStatus.textContent = status === "Live" ? "Live" : "";
}

function formatCurrency(amount) {
  const currency = state.game?.currency || "$";
  const numeric = Number(amount) || 0;
  return `${currency}${numeric.toFixed(2)}`;
}

function formatSkillScore(score) {
  const numeric = Number(score) || 0;
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${(numeric * 100).toFixed(1)}%`;
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

function initTitleFlicker() {
  const title = document.querySelector(".brand h1");
  if (!title || title.dataset.flicker === "true") return;
  const text = title.textContent || "";
  title.dataset.flicker = "true";
  title.setAttribute("aria-label", text);
  title.textContent = "";
  [...text].forEach((char) => {
    const span = document.createElement("span");
    span.className = "neon-letter";
    span.textContent = char;
    span.style.setProperty("--flicker-delay", `${(Math.random() * 0.8).toFixed(2)}s`);
    span.style.setProperty("--flicker-duration", `${(1.6 + Math.random() * 1.2).toFixed(2)}s`);
    title.appendChild(span);
  });
}

function buildStatsRanges() {
  if (!elements.statsRange) return;
  elements.statsRange.innerHTML = "";
  const options = [
    { value: "all", label: "All time" },
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
    { value: "ytd", label: "Year to date" },
    { value: "this-quarter", label: "This quarter" },
    { value: "last-quarter", label: "Last quarter" },
    { value: "12m", label: "Last 12 months" }
  ];
  options.forEach((opt) => {
    const node = document.createElement("option");
    node.value = opt.value;
    node.textContent = opt.label;
    elements.statsRange.appendChild(node);
  });
  elements.statsRange.value = "all";
}

function getRangeBounds(range) {
  if (range === "all") return null;
  const now = new Date();
  if (range === "30d") {
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    return { start, end: now };
  }
  if (range === "90d") {
    const start = new Date(now);
    start.setDate(now.getDate() - 90);
    return { start, end: now };
  }
  if (range === "12m") {
    const start = new Date(now);
    start.setFullYear(now.getFullYear() - 1);
    return { start, end: now };
  }
  if (range === "ytd") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return { start, end: now };
  }
  const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  if (range === "this-quarter") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
    return { start, end: now };
  }
  if (range === "last-quarter") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth - 3, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
    return { start, end };
  }
  return null;
}

async function openStatsModal(groupId) {
  if (!elements.statsModal) return;
  state.statsGroupId = groupId;
  const group = state.groups.find((item) => item.id === groupId);
  elements.statsTitle.textContent = group ? `${group.name} stats` : "Group stats";
  elements.statsSubtitle.textContent = "";
  elements.statsSummary.innerHTML = "";
  elements.statsLeaderboard.innerHTML = "";
  elements.statsModal.classList.remove("hidden");
  await loadGroupStats();
}

function closeStatsModal() {
  if (!elements.statsModal) return;
  elements.statsModal.classList.add("hidden");
  state.statsGroupId = null;
}

async function loadGroupStats() {
  if (!supabase || !state.statsGroupId) return;
  const range = safeTrim(elements.statsRange?.value) || "all";
  const bounds = getRangeBounds(range);
  const { data: games, error: gamesError } = await supabase
    .from("games")
    .select("id,ended_at,created_at,default_buyin")
    .eq("group_id", state.statsGroupId)
    .not("ended_at", "is", null);
  if (gamesError) {
    setStatus("Could not load stats", "error");
    return;
  }

  const filteredGames = (games || []).filter((game) => {
    if (!bounds) return true;
    const stamp = game.ended_at || game.created_at;
    const date = stamp ? new Date(stamp) : null;
    if (!date) return false;
    if (bounds.start && date < bounds.start) return false;
    if (bounds.end && date > bounds.end) return false;
    return true;
  });

  if (!filteredGames.length) {
    elements.statsSubtitle.textContent = "No settled games in this range.";
    return;
  }

  const gameIds = filteredGames.map((game) => game.id);
  const [playersRes, buyinsRes, settlementsRes, groupPlayersRes] = await Promise.all([
    supabase.from("players").select("id,game_id,name,group_player_id").in("game_id", gameIds),
    supabase.from("buyins").select("player_id,amount,game_id").in("game_id", gameIds),
    supabase.from("settlements").select("player_id,amount,game_id").in("game_id", gameIds),
    supabase.from("group_players").select("id,name,normalized_name").eq("group_id", state.statsGroupId)
  ]);

  if (playersRes.error || buyinsRes.error || settlementsRes.error || groupPlayersRes.error) {
    setStatus("Could not load stats", "error");
    return;
  }

  const groupPlayers = groupPlayersRes.data || [];
  const groupNameById = new Map(groupPlayers.map((row) => [row.id, row.name]));
  const groupIdByNormalized = new Map(groupPlayers.map((row) => [row.normalized_name, row.id]));
  const playerKeyById = new Map();
  const ledger = new Map();
  const gamesSet = new Set();

  (playersRes.data || []).forEach((player) => {
    gamesSet.add(player.game_id);
    const normalized = normalizeName(player.name.replace(/\s*\(Host\)$/i, ""));
    const mappedGroupId = groupIdByNormalized.get(normalized) || null;
    const key = player.group_player_id || mappedGroupId || normalized;
    playerKeyById.set(player.id, key);
    if (!ledger.has(key)) {
      const displayName =
        groupNameById.get(player.group_player_id) ||
        groupNameById.get(mappedGroupId) ||
        player.name.replace(/\s*\(Host\)$/i, "");
      ledger.set(key, {
        name: displayName,
        buyinCount: 0,
        buyinTotal: 0,
        cashout: 0
      });
    }
  });

  (buyinsRes.data || []).forEach((buyin) => {
    const key = playerKeyById.get(buyin.player_id);
    if (!key || !ledger.has(key)) return;
    const entry = ledger.get(key);
    entry.buyinCount += 1;
    entry.buyinTotal += Number(buyin.amount || 0);
  });

  (settlementsRes.data || []).forEach((settlement) => {
    const key = playerKeyById.get(settlement.player_id);
    if (!key || !ledger.has(key)) return;
    const entry = ledger.get(key);
    entry.cashout += Number(settlement.amount || 0);
  });

  const rows = Array.from(ledger.values()).map((entry) => {
    const net = entry.cashout - entry.buyinTotal;
    return { ...entry, net };
  });

  const totalBuyins = rows.reduce((sum, row) => sum + row.buyinTotal, 0);
  const totalCashout = rows.reduce((sum, row) => sum + row.cashout, 0);
  const totalNet = totalCashout - totalBuyins;

  rows.forEach((row) => {
    row.skillScore = row.buyinTotal ? row.net / row.buyinTotal : 0;
  });

  rows.sort((a, b) => b.net - a.net || b.skillScore - a.skillScore);

  elements.statsSubtitle.textContent = `${rows.length} players · ${gamesSet.size} games`;

  elements.statsSummary.innerHTML = "";
  [
    { label: "Games", value: gamesSet.size },
    { label: "Total buy-ins", value: formatCurrency(totalBuyins) },
    { label: "Total cash-out", value: formatCurrency(totalCashout) },
    { label: "Net", value: formatCurrency(totalNet) }
  ].forEach((card) => {
    const node = document.createElement("div");
    node.className = "summary-card";
    node.innerHTML = `<span>${card.label}</span><strong>${card.value}</strong>`;
    elements.statsSummary.appendChild(node);
  });

  elements.statsLeaderboard.innerHTML = "";
  const header = document.createElement("div");
  header.className = "stats-row header";
  header.innerHTML = `<span>Player</span><span>Net</span><span>Buy-ins</span><span>Skill</span>`;
  elements.statsLeaderboard.appendChild(header);

  rows.forEach((row) => {
    const netClass = row.net >= 0 ? "money-pos" : "money-neg";
    const rowEl = document.createElement("div");
    rowEl.className = "stats-row";
    rowEl.innerHTML = `
      <span>${row.name}</span>
      <strong class="${netClass}">${formatCurrency(row.net)}</strong>
      <span>${row.buyinCount}</span>
      <strong>${formatSkillScore(row.skillScore)}</strong>
    `;
    elements.statsLeaderboard.appendChild(rowEl);
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

function parseDateInput(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
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

function isSettleOpen() {
  return Boolean(state.game?.settle_open);
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

function downloadShareImage(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setSummaryActionsHidden(node, hidden) {
  const actions = node?.querySelector(".summary-actions");
  if (!actions) return;
  if (hidden) {
    actions.dataset.prevVisibility = actions.style.visibility || "";
    actions.style.visibility = "hidden";
    actions.style.pointerEvents = "none";
  } else {
    actions.style.visibility = actions.dataset.prevVisibility || "";
    actions.style.pointerEvents = "";
    delete actions.dataset.prevVisibility;
  }
}

function buildSummaryShareCanvas() {
  const isLight = document.body.classList.contains("theme-light");
  const bg = isLight ? "#efe7da" : "#0f1712";
  const ink = isLight ? "#1f3b33" : "#f3e6c8";
  const muted = isLight ? "#4c6a5f" : "#c5b18a";
  const line = isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.15)";
  const pos = isLight ? "#1f6f5c" : "#76e3c7";
  const neg = isLight ? "#a23a2a" : "#b24a3b";

  const buyinTotals = new Map();
  state.buyins.forEach((buyin) => {
    const current = buyinTotals.get(buyin.player_id) || 0;
    buyinTotals.set(buyin.player_id, current + Number(buyin.amount || 0));
  });
  const settlementTotals = new Map();
  state.settlements.forEach((settlement) => {
    const current = settlementTotals.get(settlement.player_id) || 0;
    settlementTotals.set(settlement.player_id, current + Number(settlement.amount || 0));
  });

  const rows = state.players
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((player) => {
      const moneyIn = buyinTotals.get(player.id) || 0;
      const moneyOut = settlementTotals.get(player.id) || 0;
      return { name: player.name || "Player", moneyIn, moneyOut, net: moneyOut - moneyIn };
    });

  const width = 1080;
  const padding = 72;
  const rowHeight = 56;
  const headerHeight = 200;
  const footerHeight = 90;
  const height = headerHeight + rows.length * rowHeight + footerHeight;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = ink;
  ctx.font = "700 44px Cinzel, Georgia, serif";
  ctx.fillText(state.game?.name || "Poker Nights", padding, 78);
  ctx.font = "500 22px 'Manrope', Arial, sans-serif";
  ctx.fillStyle = muted;
  ctx.fillText("Settlement summary", padding, 118);
  if (state.game?.ended_at) {
    ctx.font = "500 18px 'Manrope', Arial, sans-serif";
    ctx.fillText(`Settled ${formatDateTime(state.game.ended_at)}`, padding, 146);
  }

  ctx.fillStyle = muted;
  ctx.font = "700 18px 'Manrope', Arial, sans-serif";
  const headerY = headerHeight - 20;
  const colNet = width - padding;
  const colOut = colNet - 160;
  const colIn = colOut - 160;

  ctx.fillText("Player", padding, headerY);
  ctx.fillText("In", colIn - 20, headerY);
  ctx.fillText("Out", colOut - 20, headerY);
  ctx.fillText("Net", colNet - 20, headerY);

  ctx.strokeStyle = line;
  ctx.beginPath();
  ctx.moveTo(padding, headerY + 12);
  ctx.lineTo(width - padding, headerY + 12);
  ctx.stroke();

  const drawRight = (text, x, y) => {
    const w = ctx.measureText(text).width;
    ctx.fillText(text, x - w, y);
  };

  let y = headerHeight + 24;
  let totalIn = 0;
  let totalOut = 0;

  rows.forEach((row) => {
    totalIn += row.moneyIn;
    totalOut += row.moneyOut;
    ctx.fillStyle = ink;
    ctx.font = "600 24px 'Manrope', Arial, sans-serif";
    ctx.fillText(row.name, padding, y);
    ctx.font = "500 22px 'Manrope', Arial, sans-serif";
    ctx.fillStyle = muted;
    drawRight(formatCurrency(row.moneyIn), colIn, y);
    drawRight(formatCurrency(row.moneyOut), colOut, y);
    ctx.fillStyle = row.net >= 0 ? pos : neg;
    const netText = `${row.net < 0 ? "-" : ""}${formatCurrency(Math.abs(row.net))}`;
    drawRight(netText, colNet, y);
    y += rowHeight;
  });

  ctx.strokeStyle = line;
  ctx.beginPath();
  ctx.moveTo(padding, y - 18);
  ctx.lineTo(width - padding, y - 18);
  ctx.stroke();

  ctx.fillStyle = ink;
  ctx.font = "700 22px 'Manrope', Arial, sans-serif";
  ctx.fillText("Total", padding, y + 12);
  ctx.fillStyle = muted;
  drawRight(formatCurrency(totalIn), colIn, y + 12);
  drawRight(formatCurrency(totalOut), colOut, y + 12);
  const netTotal = totalOut - totalIn;
  ctx.fillStyle = netTotal >= 0 ? pos : neg;
  drawRight(
    `${netTotal < 0 ? "-" : ""}${formatCurrency(Math.abs(netTotal))}`,
    colNet,
    y + 12
  );

  return canvas;
}

async function shareSummary(node) {
  if (!node) return;
  const isLight = document.body.classList.contains("theme-light");
  setSummaryActionsHidden(node, true);
  try {
    setStatus("Preparing share…");
    let canvas = null;
    try {
      canvas = await html2canvas(node, {
        backgroundColor: isLight ? "#f2ede3" : "#0f1712",
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true
      });
    } catch (err) {
      canvas = buildSummaryShareCanvas();
    }
    if (!canvas) {
      canvas = buildSummaryShareCanvas();
    }
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      const dataUrl = canvas.toDataURL("image/png");
      const res = await fetch(dataUrl);
      blob = await res.blob();
    }
    if (!blob) throw new Error("Share failed");
    const file = new File([blob], `poker-night-summary-${state.game?.code || "game"}.png`, {
      type: "image/png"
    });
    const canNativeShare =
      navigator.share &&
      (!navigator.canShare || navigator.canShare({ files: [file] })) &&
      window.isSecureContext;
    if (canNativeShare) {
      await navigator.share({ files: [file], title: "Poker Nights Summary" });
      setStatus("Share sheet opened");
      return;
    }
    downloadShareImage(blob, file.name);
    setStatus("Image downloaded");
  } catch (err) {
    setStatus("Share failed", "error");
  } finally {
    setSummaryActionsHidden(node, false);
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
  if (elements.hostAddToggle) elements.hostAddToggle.disabled = !state.isHost;
  if (elements.settlementSummary) {
    elements.settlementSummary.classList.toggle("hidden", !state.isHost || !isGameSettled());
  }
  if (elements.playerSettledSummary) {
    elements.playerSettledSummary.classList.toggle("hidden", state.isHost || !isGameSettled());
  }
  if (elements.playerPanelHeading && elements.playerPanelSubtitle) {
    if (isGameSettled() && !state.isHost) {
      elements.playerPanelHeading.textContent = "Summary";
      elements.playerPanelSubtitle.textContent = "";
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
  const settling = !settled && isSettleOpen();

  if (elements.gamePanel) {
    elements.gamePanel.classList.toggle("settled-view", settled);
  }
  if (elements.hostPanel) {
    elements.hostPanel.classList.toggle("settled-only", settled);
  }
  if (elements.joinPanel) {
    elements.joinPanel.classList.toggle("hidden", settled);
  }
  if (elements.logPanel) {
    elements.logPanel.classList.toggle("hidden", settled);
  }

  if (elements.gameStatusChip) {
    elements.gameStatusChip.textContent = settled ? "Settled" : settling ? "Settling" : "Live";
    elements.gameStatusChip.dataset.state = settled ? "settled" : settling ? "settling" : "live";
  }

  elements.settledNotice.classList.toggle("hidden", !settled);
  if (settled && elements.settledAt) {
    elements.settledAt.textContent = formatDateTime(settledAt);
  }

  if (elements.openSettle) {
    elements.openSettle.classList.toggle("hidden", !state.isHost || settled);
  }

  const disableBuyins = settled || settling;
  elements.playerAddDefault.disabled = disableBuyins;
  elements.playerName.disabled = disableBuyins;
  elements.joinAsPlayer.disabled = disableBuyins;
  elements.playerNotice.classList.toggle("hidden", !settled);
  elements.playerJoinNotice.classList.toggle("hidden", !settled);
  elements.hostPlayerName.disabled = !state.isHost || settled || settling;
  elements.hostAddPlayer.disabled = !state.isHost || settled || settling;
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

  const qrSmall = elements.qrCanvas;
  const qrLarge = elements.qrCanvasLarge;
  if (qrSmall) {
    QRCode.toCanvas(
      qrSmall,
      joinLink,
      { width: 64, margin: 1, color: { dark: "#1b140c", light: "#ffffff" } },
      () => {}
    );
  }
  if (qrLarge) {
    QRCode.toCanvas(
      qrLarge,
      joinLink,
      { width: 240, margin: 1, color: { dark: "#1b140c", light: "#ffffff" } },
      () => {}
    );
  }
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
  if (!state.isHost || isGameSettled() || isSettleOpen()) return;
  const role = event.target.dataset.role;
  if (!["edit-count", "edit-total", "edit-name"].includes(role)) return;
  const tile = event.target.closest(".player-tile");
  if (!tile) return;
  const playerId = tile.dataset.playerId;
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;

  if (role === "edit-name") {
    const nextName = safeTrim(event.target.value);
    if (!nextName) {
      event.target.value = player.name;
      return;
    }
    if (nextName === player.name) return;
    updatePlayerName(playerId, nextName);
    return;
  }
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
    const displayCount = tile.querySelector("[data-role='count-display']");
    const displayTotal = tile.querySelector("[data-role='total-display']");
    if (displayCount) displayCount.textContent = count;
    if (displayTotal) displayTotal.textContent = formatCurrency(count * defaultBuyin);
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
  const displayCount = tile.querySelector("[data-role='count-display']");
  const displayTotal = tile.querySelector("[data-role='total-display']");
  if (displayCount) displayCount.textContent = count;
  if (displayTotal) displayTotal.textContent = formatCurrency(adjustedTotal);
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
  const buyinLocked = isGameSettled() || isSettleOpen();
  elements.players.innerHTML = "";

  if (state.players.length === 0) {
    const empty = document.createElement("div");
    empty.className = "player-tile";
    empty.innerHTML = "<strong>No players yet.</strong><p>Add players or let them join by link.</p>";
    elements.players.appendChild(empty);
    return;
  }

  const orderedPlayers = state.players.slice().sort((a, b) => {
    const aHost = a.name?.includes("(Host)");
    const bHost = b.name?.includes("(Host)");
    if (aHost && !bHost) return -1;
    if (!aHost && bHost) return 1;
    return 0;
  });

  orderedPlayers.forEach((player) => {
    const buyins = buyinMap.get(player.id) || [];
    const total = buyins.reduce((sum, item) => sum + Number(item.amount || 0), 0);

    const card = document.createElement("div");
    card.className = "player-tile";
    card.dataset.playerId = player.id;
    const isHostPlayer = player.name?.includes("(Host)");

    card.innerHTML = `
      <div class="player-header">
        <div class="player-name">
          <h4 data-role="name-display">${player.name}</h4>
          <input data-role="edit-name" type="text" value="${player.name}" disabled />
        </div>
        <div class="player-header-actions">
          <button data-action="edit" class="ghost">Edit</button>
          <button data-action="remove" class="ghost icon-btn ${isHostPlayer ? "hidden" : ""}" aria-label="Remove player">✕</button>
        </div>
      </div>
      <div class="player-stats">
        <label class="stat-field">
          <span>Buy-ins</span>
          <strong class="stat-value" data-role="count-display">${buyins.length}</strong>
          <input data-role="edit-count" type="number" min="0" step="1" value="${buyins.length}" disabled />
        </label>
        <label class="stat-field">
          <span>Total</span>
          <strong class="stat-value" data-role="total-display">${formatCurrency(total)}</strong>
          <input data-role="edit-total" type="number" min="0" step="1" value="${Number(total).toFixed(2)}" disabled />
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
  const settling = isSettleOpen();
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
    if (elements.playerSettle) {
      elements.playerSettle.classList.add("hidden");
    }
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
  if (elements.playerSettle) {
    elements.playerSettle.classList.toggle("hidden", !settling);
  }
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

  if (elements.playerSettleAmount && elements.playerSettleStatus) {
    const currentValue = elements.playerSettleAmount.value;
    const settledTotal = state.settlements
      .filter((settlement) => settlement.player_id === player.id)
      .reduce((sum, settlement) => sum + Number(settlement.amount || 0), 0);
    if (settling && settledTotal > 0) {
      elements.playerSettleAmount.value = formatNumberValue(settledTotal);
      elements.playerSettleStatus.textContent = "Submitted — waiting for host to finalize.";
    } else if (settling) {
      elements.playerSettleAmount.value = currentValue || "";
      elements.playerSettleStatus.textContent = "Enter your remaining chips.";
    } else {
      elements.playerSettleAmount.value = "";
      elements.playerSettleStatus.textContent = "";
    }
  }
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
  const buyinTotals = new Map();
  state.buyins.forEach((buyin) => {
    const current = buyinTotals.get(buyin.player_id) || 0;
    buyinTotals.set(buyin.player_id, current + Number(buyin.amount || 0));
  });
  const settlementTotals = new Map();
  state.settlements.forEach((settlement) => {
    const current = settlementTotals.get(settlement.player_id) || 0;
    settlementTotals.set(settlement.player_id, current + Number(settlement.amount || 0));
  });
  const rows = state.players
    .slice()
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map((player) => {
      const moneyIn = buyinTotals.get(player.id) || 0;
      const moneyOut = settlementTotals.get(player.id) || 0;
      return { id: player.id, name: player.name, moneyIn, moneyOut, net: moneyOut - moneyIn };
    });

  const settledAtText = state.game?.ended_at ? formatDateTime(state.game.ended_at) : "";
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
            ${settledAtText ? `<p class="settled-meta">Settled ${settledAtText}</p>` : ""}
          </div>
          <div class="summary-actions">
            <button class="ghost icon-button" type="button" data-action="home" aria-label="Home">
              <span aria-hidden="true">⌂</span>
            </button>
            <button class="ghost icon-button" type="button" data-action="share" aria-label="Share summary">
              <span aria-hidden="true">⤴︎</span>
              <span>Share</span>
            </button>
            <button class="ghost icon-button" type="button" data-action="history" aria-label="Back to history">
              <span aria-hidden="true">←</span>
              <span>History</span>
            </button>
          </div>
        </div>
      `;
    } else {
      header.innerHTML = `
        <div>
          <h2>${title}</h2>
          ${settledAtText ? `<p class="settled-meta">Settled ${settledAtText}</p>` : ""}
        </div>
      `;
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
    let totalIn = 0;
    let totalOut = 0;

    const headerRow = document.createElement("div");
    headerRow.className = "settlement-row header";
    headerRow.innerHTML = `
      <span>Player</span>
      <span>In</span>
      <span>Out</span>
      <span>Net</span>
    `;
    list.appendChild(headerRow);

    rows.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "settlement-row";
      totalIn += entry.moneyIn;
      totalOut += entry.moneyOut;
      const netClass = entry.net >= 0 ? "money-pos" : "money-neg";
      row.innerHTML = `
        <span>${entry.name || "Unknown"}</span>
        <strong>${formatCurrency(entry.moneyIn)}</strong>
        <strong>${formatCurrency(entry.moneyOut)}</strong>
        <strong class="${netClass}">${formatCurrency(entry.net)}</strong>
      `;
      list.appendChild(row);
    });

    const totalRow = document.createElement("div");
    totalRow.className = "settlement-total";
    const totalNet = totalOut - totalIn;
    const totalClass = totalNet >= 0 ? "money-pos" : "money-neg";
    totalRow.innerHTML = `
      <span>Total</span>
      <strong>${formatCurrency(totalIn)}</strong>
      <strong>${formatCurrency(totalOut)}</strong>
      <strong class="${totalClass}">${formatCurrency(totalNet)}</strong>
    `;

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

  const group = state.groups.find((item) => item.id === groupId);
  const groupName = group?.name || "Group";
  const useCustom = Boolean(elements.summaryUseCustom?.checked);
  const startInput = safeTrim(elements.summaryStart?.value);
  const endInput = safeTrim(elements.summaryEnd?.value);
  let start;
  let end;
  let label;

  if (useCustom) {
    if (!startInput || !endInput) {
      setStatus("Select both start and end dates for custom range.", "error");
      return;
    }
    const parsedStart = parseDateInput(startInput);
    const parsedEnd = parseDateInput(endInput);
    if (!parsedStart || !parsedEnd) {
      setStatus("Invalid custom date range.", "error");
      return;
    }
    if (parsedEnd < parsedStart) {
      setStatus("End date must be after start date.", "error");
      return;
    }
    start = parsedStart;
    end = new Date(parsedEnd);
    end.setDate(end.getDate() + 1);
    label = `${formatShortDate(parsedStart)} – ${formatShortDate(parsedEnd)}`;
  } else {
    const quarterValue = safeTrim(elements.summaryQuarter?.value);
    const parsed = parseQuarterValue(quarterValue);
    if (!parsed) return;
    const range = getQuarterRange(parsed.year, parsed.quarter);
    start = range.start;
    end = range.end;
    label = `Q${parsed.quarter} ${parsed.year}`;
  }

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
    supabase.from("group_players").select("id,name,normalized_name").eq("group_id", groupId)
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

  const groupPlayers = groupPlayersRes.data || [];
  const groupPlayerMap = new Map(groupPlayers.map((player) => [player.id, player.name]));
  const groupIdByNormalized = new Map(
    groupPlayers.map((player) => [player.normalized_name, player.id])
  );
  const playerById = new Map((playersRes.data || []).map((player) => [player.id, player]));

  const ledger = new Map();
  const gamesByKey = new Map();

  function getKey(player) {
    const cleanedName = (player.name || "Player").replace(/\s*\(Host\)$/i, "");
    const normalized = normalizeName(cleanedName);
    const mappedGroupId = groupIdByNormalized.get(normalized) || null;
    const resolvedGroupId = player.group_player_id || mappedGroupId;
    if (resolvedGroupId && groupPlayerMap.has(resolvedGroupId)) {
      return {
        key: `gp:${resolvedGroupId}`,
        name: groupPlayerMap.get(resolvedGroupId)
      };
    }
    return { key: `name:${normalized}`, name: cleanedName };
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
    const authorized = await ensureDeletePin();
    if (!authorized) return;
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
  closeSettingsModal();
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
  if (elements.settleModal && !elements.settleModal.classList.contains("hidden")) {
    renderSettleList();
  }
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

async function loadGameByCode(code, options = {}) {
  if (!supabase) return;
  const trimmed = safeTrim(code).toUpperCase();
  if (!trimmed) return;
  const { allowSettled = false } = options;

  const { data, error } = await supabase.from("games").select("*").eq("code", trimmed).single();
  if (error || !data) {
    setStatus("Game not found", "error");
    return null;
  }
  if (data.ended_at && !allowSettled && !isLocalHostForGame(trimmed)) {
    setStatus("Game settled. Only live games can be joined by code.", "error");
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

  const typedName = safeTrim(elements.newGameName.value);
  const placeholder = elements.newGameName.placeholder;
  const seed = placeholder === namePlaceholderLoading ? "" : placeholder;
  const name = typedName || (await ensureUniqueGameName(seed));
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
      if (!state.game.group_id) {
        const { error: hostBuyinError } = await supabase.from("buyins").insert({
          game_id: state.game.id,
          player_id: hostPlayer.id,
          amount: defaultBuyIn
        });
        if (hostBuyinError) {
          setStatus("Could not seed host buy-in", "error");
        }
      }
    }
  }

  renderAll();
  await refreshData();
  await startRealtime();
  setStatus("Game created");
  if (elements.newGameName) {
    elements.newGameName.value = "";
    elements.newGameName.dataset.suggested = "";
  }
  await initGameName();
}

async function joinAsPlayer() {
  if (!supabase || !state.game) return;
  if (isGameSettled()) {
    setStatus("Game settled. New players are closed.", "error");
    return;
  }
  if (isSettleOpen()) {
    setStatus("Settlement in progress. New players are closed.", "error");
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
  if (!state.game.group_id) {
    const { error: buyinError } = await supabase.from("buyins").insert({
      game_id: state.game.id,
      player_id: data.id,
      amount: state.game.default_buyin || 10
    });
    if (buyinError) {
      setStatus("Could not add buy-in", "error");
    }
  }
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
  if (isSettleOpen()) {
    setStatus("Settlement in progress. New players are closed.", "error");
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

async function updatePlayerName(playerId, name) {
  if (!supabase || !state.game) return;
  const { error } = await supabase.from("players").update({ name }).eq("id", playerId);
  if (error) {
    setStatus("Could not update name", "error");
    return;
  }
  if (state.playerId === playerId && state.game?.code) {
    saveStoredPlayer(state.game.code, { id: playerId, name });
  }
  await refreshData();
  setStatus("Player updated");
}

async function addBuyin(playerId, amount) {
  if (!supabase || !state.game) return;
  if (isGameSettled()) {
    setStatus("Game settled. Buy-ins are locked.", "error");
    return;
  }
  if (isSettleOpen()) {
    setStatus("Settlement in progress. Buy-ins are locked.", "error");
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

async function saveSettlementForPlayer(playerId, amount) {
  if (!supabase || !state.game) return false;
  const { error: deleteError } = await supabase
    .from("settlements")
    .delete()
    .eq("game_id", state.game.id)
    .eq("player_id", playerId);
  if (deleteError) {
    setStatus("Could not update chips", "error");
    return false;
  }
  const { error } = await supabase
    .from("settlements")
    .insert({ game_id: state.game.id, player_id: playerId, amount });
  if (error) {
    setStatus("Could not update chips", "error");
    return false;
  }
  await refreshData();
  return true;
}

async function submitPlayerChips() {
  if (!supabase || !state.game || !state.playerId) return;
  if (isGameSettled()) {
    setStatus("Game settled. Chips are locked.", "error");
    return;
  }
  if (!isSettleOpen()) {
    setStatus("Settlement has not started yet.", "error");
    return;
  }
  const amount = Number(elements.playerSettleAmount?.value);
  if (!Number.isFinite(amount) || amount < 0) {
    setStatus("Enter a valid chip total.", "error");
    return;
  }
  const ok = await saveSettlementForPlayer(state.playerId, amount);
  if (ok && elements.playerSettleStatus) {
    elements.playerSettleStatus.textContent = "Submitted — waiting for host to finalize.";
  }
  if (ok) setStatus("Chips submitted");
}


async function removePlayer(playerId) {
  if (!supabase) return;
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return;
  const confirmed = await openConfirmModal(`Remove ${player.name}?`, "Remove");
  if (!confirmed) return;

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
  const existingValues = new Map();
  if (elements.settleModal && !elements.settleModal.classList.contains("hidden")) {
    elements.settleList.querySelectorAll(".settle-row").forEach((row) => {
      const input = row.querySelector("input");
      const value = input?.value;
      if (value !== undefined && value !== "") {
        existingValues.set(row.dataset.playerId, value);
      }
    });
  }

  elements.settleList.innerHTML = "";

  if (state.players.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Add players before settling.";
    elements.settleList.appendChild(empty);
    return;
  }

  const totals = buildBuyinTotals();
  const settlementTotals = new Map();
  state.settlements.forEach((settlement) => {
    const current = settlementTotals.get(settlement.player_id) || 0;
    settlementTotals.set(settlement.player_id, current + Number(settlement.amount || 0));
  });
  state.players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "settle-row";
    row.dataset.playerId = player.id;
    const buyinTotal = totals.get(player.id) || 0;
    const preset =
      existingValues.get(player.id) ??
      (settlementTotals.has(player.id) ? formatNumberValue(settlementTotals.get(player.id)) : "");
    row.innerHTML = `
      <div class="settle-meta">
        <strong>${player.name}</strong>
        <span>Buy-ins: ${formatCurrency(buyinTotal)}</span>
      </div>
      <div class="settle-input">
        <span>Chips remaining</span>
        <input type="number" min="0" step="1" placeholder="0" />
      </div>
    `;
    const input = row.querySelector("input");
    if (input && preset !== "") {
      input.value = preset;
    }
    elements.settleList.appendChild(row);
  });
  updateSettleRemaining();
}

function updateSettleRemaining() {
  if (!elements.settleRemaining) return;
  const { totalBuyins } = computeSummary();
  let submitted = 0;
  if (elements.settleList) {
    elements.settleList.querySelectorAll("input").forEach((input) => {
      const value = Number(input.value);
      if (Number.isFinite(value)) submitted += value;
    });
  }
  let remaining = submitted - totalBuyins;
  if (Math.abs(remaining) < 0.01) remaining = 0;
  const display =
    remaining < 0 ? `-${formatCurrency(Math.abs(remaining))}` : formatCurrency(remaining);
  elements.settleRemaining.textContent = display;
  elements.settleRemaining.dataset.state = remaining < 0 ? "neg" : remaining > 0 ? "pos" : "zero";
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

async function setSettleOpen(next) {
  if (!supabase || !state.game || !state.isHost) return false;
  if (!("settle_open" in state.game)) {
    setStatus("Add settle_open column in Supabase to enable settle flow.", "error");
    return false;
  }
  const { error } = await supabase
    .from("games")
    .update({ settle_open: next })
    .eq("id", state.game.id);
  if (error) {
    setStatus("Could not update settle status", "error");
    return false;
  }
  state.game.settle_open = next;
  renderAll();
  return true;
}

async function openSettlePanel() {
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
  await setSettleOpen(true);
  setSettleError("");
  if (elements.settleModal) {
    elements.settleModal.classList.remove("hidden");
  }
  renderSettleList();
}

async function closeSettlePanel() {
  if (!isGameSettled()) {
    await setSettleOpen(false);
  }
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
  ensureGroupUnlocked(groupId).then((unlocked) => {
    if (!unlocked) return;
    elements.summaryModal.classList.remove("hidden");
    loadQuarterSummary();
  });
  return;
}

function closeSummaryModal() {
  if (!elements.summaryModal) return;
  elements.summaryModal.classList.add("hidden");
  const groupId = safeTrim(elements.summaryGroup?.value);
  if (groupId) {
    setGroupUnlocked(groupId, false);
  }
}

function openSettingsModal() {
  if (!elements.settingsModal) return;
  elements.settingsModal.classList.remove("hidden");
}

function closeSettingsModal() {
  if (!elements.settingsModal) return;
  elements.settingsModal.classList.add("hidden");
}

function openConfirmModal(message, confirmLabel = "Confirm") {
  if (!elements.confirmModal) return Promise.resolve(false);
  elements.confirmMessage.textContent = message;
  elements.confirmOk.textContent = confirmLabel;
  elements.confirmModal.classList.remove("hidden");
  return new Promise((resolve) => {
    confirmResolve = resolve;
  });
}

function closeConfirmModal(result) {
  if (elements.confirmModal) elements.confirmModal.classList.add("hidden");
  if (confirmResolve) {
    confirmResolve(result);
    confirmResolve = null;
  }
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
  history.replaceState({}, "", window.location.pathname);
}

function setLetsDealOpen(open) {
  if (!elements.letsDealBody || !elements.letsDealToggle) return;
  elements.letsDealBody.classList.toggle("hidden", !open);
  elements.letsDealToggle.setAttribute("aria-expanded", open ? "true" : "false");
  elements.letsDealCard?.classList.toggle("is-open", open);
  const shouldDisable = open || configMissing;
  if (elements.joinPlayer) elements.joinPlayer.disabled = shouldDisable;
  if (elements.openSessions) elements.openSessions.disabled = shouldDisable;
  if (elements.toggleGroups) elements.toggleGroups.disabled = shouldDisable;
  if (open) {
    setGroupsOpen(false);
  }
}

function setGroupsOpen(open) {
  if (!elements.groupsPanel || !elements.toggleGroups) return;
  elements.groupsPanel.classList.toggle("hidden", !open);
  elements.toggleGroups.setAttribute("aria-expanded", open ? "true" : "false");
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
  if (elements.qrModal) elements.qrModal.classList.add("hidden");
  if (elements.confirmModal) elements.confirmModal.classList.add("hidden");
  if (elements.settlementSummary) elements.settlementSummary.classList.add("hidden");
  if (elements.playerSettledSummary) elements.playerSettledSummary.classList.add("hidden");
  elements.landing.classList.remove("hidden");
  history.replaceState({}, "", window.location.pathname);
  refreshRecentGames();
  refreshGroups();
  setConnection("");
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

  const { error: clearError } = await supabase
    .from("settlements")
    .delete()
    .eq("game_id", state.game.id);
  if (clearError) {
    setSettleError("Settlement failed. Please try again.");
    setStatus("Settlement failed", "error");
    return;
  }

  const { error: settlementError } = await supabase.from("settlements").insert(entries);
  if (settlementError) {
    setSettleError("Settlement failed. Please try again.");
    setStatus("Settlement failed", "error");
    return;
  }

  const settledAt = new Date().toISOString();
  const updatePayload = { ended_at: settledAt };
  if ("settle_open" in state.game) {
    updatePayload.settle_open = false;
  }
  const { error: gameError } = await supabase.from("games").update(updatePayload).eq("id", state.game.id);

  if (gameError) {
    setStatus("Could not close game", "error");
    return;
  }

  state.game.ended_at = settledAt;
  state.settlements = entries;
  recordRecentGame(state.game);
  setStatus("Settlement saved");
  await closeSettlePanel();
  renderAll();
  await refreshData();
}

  if (!configMissing) {
    const params = new URLSearchParams(window.location.search);
    const incomingCode = safeTrim(params.get("code"));
    if (incomingCode) {
      loadGameByCode(incomingCode, { allowSettled: isLocalHostForGame(incomingCode) });
    } else {
      refreshRecentGames();
      refreshGroups();
    }
  } else {
    renderRecentGames();
  }

buildQuarterOptions();
buildStatsRanges();
initTheme();
initHeaderLights();
void initGameName();
initTitleFlicker();

// Event listeners
if (elements.themeToggle) {
  elements.themeToggle.addEventListener("change", () => {
    const next = elements.themeToggle.checked ? "light" : "dark";
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

if (elements.joinGame) {
  elements.joinGame.addEventListener("click", () => {
    if (configMissing) return;
    loadGameByCode(elements.joinCode.value, { allowSettled: false });
  });
}

if (elements.openSessions) {
  elements.openSessions.addEventListener("click", () => {
    if (configMissing) return;
    openSessionsPage();
  });
}

if (elements.qrButton) {
  elements.qrButton.addEventListener("click", () => {
    if (elements.qrModal) elements.qrModal.classList.remove("hidden");
  });
}

if (elements.qrClose) {
  elements.qrClose.addEventListener("click", () => {
    if (elements.qrModal) elements.qrModal.classList.add("hidden");
  });
}

if (elements.qrModal) {
  elements.qrModal.addEventListener("click", (event) => {
    if (event.target?.classList.contains("modal-backdrop")) {
      elements.qrModal.classList.add("hidden");
    }
  });
}

if (elements.confirmClose) {
  elements.confirmClose.addEventListener("click", () => closeConfirmModal(false));
}

if (elements.confirmCancel) {
  elements.confirmCancel.addEventListener("click", () => closeConfirmModal(false));
}

if (elements.confirmOk) {
  elements.confirmOk.addEventListener("click", () => closeConfirmModal(true));
}

if (elements.confirmModal) {
  elements.confirmModal.addEventListener("click", (event) => {
    if (event.target?.classList.contains("modal-backdrop")) {
      closeConfirmModal(false);
    }
  });
}

if (elements.letsDealToggle) {
  elements.letsDealToggle.addEventListener("click", () => {
    const isOpen = !elements.letsDealBody?.classList.contains("hidden");
    setLetsDealOpen(!isOpen);
  });
}

if (elements.toggleGroups) {
  elements.toggleGroups.addEventListener("click", () => {
    const isOpen = !elements.groupsPanel?.classList.contains("hidden");
    setGroupsOpen(!isOpen);
  });
}

setLetsDealOpen(false);

if (elements.sessionsBack) {
  elements.sessionsBack.addEventListener("click", () => {
    closeSessionsPage();
  });
}

if (elements.homeTitle) {
  elements.homeTitle.addEventListener("click", () => {
    clearCurrentGame();
    closeSessionsPage();
  });
}

if (elements.brandIcon) {
  elements.brandIcon.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOff = !document.body.classList.contains("lights-off");
    applyLightsOff(isOff);
    localStorage.setItem(lightsOffKey, isOff ? "1" : "0");
  });

  elements.brandIcon.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    const isOff = !document.body.classList.contains("lights-off");
    applyLightsOff(isOff);
    localStorage.setItem(lightsOffKey, isOff ? "1" : "0");
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

if (elements.groupRename) {
  elements.groupRename.addEventListener("click", renameActiveGroup);
}

if (elements.groupDelete) {
  elements.groupDelete.addEventListener("click", deleteActiveGroup);
}

if (elements.groupLockSet) {
  elements.groupLockSet.addEventListener("click", setGroupLockPhrase);
}

if (elements.groupLockRemove) {
  elements.groupLockRemove.addEventListener("click", removeGroupLockPhrase);
}

if (elements.groupPlayerForm) {
  elements.groupPlayerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.activeGroupId) return;
    const unlocked = await ensureGroupUnlocked(state.activeGroupId);
    if (!unlocked) return;
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

if (elements.summaryUseCustom && elements.summaryCustomRow) {
  elements.summaryUseCustom.addEventListener("change", () => {
    const open = elements.summaryUseCustom.checked;
    elements.summaryCustomRow.classList.toggle("hidden", !open);
    if (!open) {
      if (elements.summaryStart) elements.summaryStart.value = "";
      if (elements.summaryEnd) elements.summaryEnd.value = "";
    }
    if (elements.summaryModal && !elements.summaryModal.classList.contains("hidden")) {
      loadQuarterSummary();
    }
  });
}

if (elements.summaryStart) {
  elements.summaryStart.addEventListener("change", () => {
    if (elements.summaryModal && !elements.summaryModal.classList.contains("hidden")) {
      loadQuarterSummary();
    }
  });
}

if (elements.summaryEnd) {
  elements.summaryEnd.addEventListener("change", () => {
    if (elements.summaryModal && !elements.summaryModal.classList.contains("hidden")) {
      loadQuarterSummary();
    }
  });
}

if (elements.recentGames) {
  elements.recentGames.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const { action, code, groupId } = button.dataset;
    if (action === "open") {
      const open = async () => {
        if (groupId) {
          const unlocked = await ensureGroupUnlocked(groupId);
          if (!unlocked) return;
        }
        loadGameByCode(code, { allowSettled: true });
      };
      open();
      return;
    }
    if (action === "stats") {
      event.preventDefault();
      event.stopPropagation();
      const open = async () => {
        if (groupId) {
          const unlocked = await ensureGroupUnlocked(groupId);
          if (!unlocked) return;
        }
        await openStatsModal(groupId);
      };
      open();
      return;
    }
    if (action === "delete") {
      const run = async () => {
        if (groupId) {
          const unlocked = await ensureGroupUnlocked(groupId);
          if (!unlocked) return;
        }
        await deleteGameByCode(code);
      };
      run();
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

if (elements.openGuide) {
  elements.openGuide.addEventListener("click", () => {
    if (elements.guideModal) elements.guideModal.classList.remove("hidden");
  });
}

if (elements.joinPlayer) {
  elements.joinPlayer.addEventListener("click", () => {
    if (configMissing) return;
    openJoinPlayerModal();
  });
}

if (elements.joinPlayerClose) {
  elements.joinPlayerClose.addEventListener("click", closeJoinPlayerModal);
}

if (elements.joinPlayerModal) {
  elements.joinPlayerModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      closeJoinPlayerModal();
    }
  });
}

if (elements.lockPhraseModal) {
  elements.lockPhraseModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      closeLockPhraseModal();
      if (lockResolve) lockResolve(null);
      lockResolve = null;
    }
  });
}

if (elements.joinPlayerContinue) {
  elements.joinPlayerContinue.addEventListener("click", handleJoinPlayerContinue);
}

if (elements.joinPlayerName) {
  elements.joinPlayerName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handleJoinPlayerContinue();
    }
  });
}

if (elements.joinPlayerUseCode) {
  elements.joinPlayerUseCode.addEventListener("click", () => {
    elements.joinPlayerCodeHint.textContent = "Enter a game code.";
    showJoinStep("code");
  });
}

if (elements.joinPlayerSubmit) {
  elements.joinPlayerSubmit.addEventListener("click", () => {
    const code = safeTrim(elements.joinPlayerCode.value);
    if (!code) {
      setStatus("Enter a game code.", "error");
      return;
    }
    joinGameByCodeWithName(code, joinFlowName);
  });
}

if (elements.joinPlayerBack) {
  elements.joinPlayerBack.addEventListener("click", handleJoinPlayerBack);
}

if (elements.joinPlayerCode) {
  elements.joinPlayerCode.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.joinPlayerSubmit?.click();
    }
  });
}

if (elements.lockPhraseClose) {
  elements.lockPhraseClose.addEventListener("click", () => {
    closeLockPhraseModal();
    if (lockResolve) lockResolve(null);
    lockResolve = null;
  });
}

if (elements.lockPhraseCancel) {
  elements.lockPhraseCancel.addEventListener("click", () => {
    closeLockPhraseModal();
    if (lockResolve) lockResolve(null);
    lockResolve = null;
  });
}

if (elements.lockPhraseSubmit) {
  elements.lockPhraseSubmit.addEventListener("click", () => {
    const value = safeTrim(elements.lockPhraseInput?.value);
    closeLockPhraseModal();
    if (lockResolve) lockResolve(value || null);
    lockResolve = null;
  });
}

if (elements.lockPhraseInput) {
  elements.lockPhraseInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.lockPhraseSubmit?.click();
    }
  });
}

if (elements.guideClose) {
  elements.guideClose.addEventListener("click", () => {
    if (elements.guideModal) elements.guideModal.classList.add("hidden");
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

if (elements.statsClose) {
  elements.statsClose.addEventListener("click", closeStatsModal);
}

if (elements.statsModal) {
  elements.statsModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      closeStatsModal();
    }
  });
}

if (elements.statsRange) {
  elements.statsRange.addEventListener("change", () => {
    if (elements.statsModal && !elements.statsModal.classList.contains("hidden")) {
      loadGroupStats();
    }
  });
}

if (elements.sessionsSettings) {
  elements.sessionsSettings.addEventListener("click", openSettingsModal);
}

if (elements.settingsClose) {
  elements.settingsClose.addEventListener("click", closeSettingsModal);
}

if (elements.settingsModal) {
  elements.settingsModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      closeSettingsModal();
    }
  });
}

if (elements.guideModal) {
  elements.guideModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      elements.guideModal.classList.add("hidden");
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
    const unlocked = await ensureGroupUnlocked(state.activeGroupId);
    if (!unlocked) return;
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
  elements.openSettle.addEventListener("click", () => {
    void openSettlePanel();
  });
}
if (elements.settleCancel) {
  elements.settleCancel.addEventListener("click", () => {
    void closeSettlePanel();
  });
}
if (elements.settleForm) {
  elements.settleForm.addEventListener("submit", submitSettlement);
}
if (elements.settleList) {
  elements.settleList.addEventListener("input", (event) => {
    if (event.target && event.target.tagName === "INPUT") {
      updateSettleRemaining();
    }
  });
}

if (elements.settleModal) {
  elements.settleModal.addEventListener("click", (event) => {
    if (event.target.dataset.action === "close") {
      void closeSettlePanel();
    }
  });
}

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (elements.settleModal && !elements.settleModal.classList.contains("hidden")) {
    void closeSettlePanel();
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
  if (elements.guideModal && !elements.guideModal.classList.contains("hidden")) {
    elements.guideModal.classList.add("hidden");
  }
  if (elements.rosterModal && !elements.rosterModal.classList.contains("hidden")) {
    closeRosterModal();
  }
  if (elements.joinPlayerModal && !elements.joinPlayerModal.classList.contains("hidden")) {
    closeJoinPlayerModal();
  }
  if (elements.statsModal && !elements.statsModal.classList.contains("hidden")) {
    closeStatsModal();
  }
  if (elements.lockPhraseModal && !elements.lockPhraseModal.classList.contains("hidden")) {
    closeLockPhraseModal();
    if (lockResolve) lockResolve(null);
    lockResolve = null;
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
  if (elements.hostAddForm) elements.hostAddForm.classList.add("hidden");
});

elements.hostPlayerName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    elements.hostAddPlayer.click();
  }
});

if (elements.hostAddToggle) {
  elements.hostAddToggle.addEventListener("click", () => {
    if (!elements.hostAddForm) return;
    const isHidden = elements.hostAddForm.classList.contains("hidden");
    elements.hostAddForm.classList.toggle("hidden", !isHidden);
    if (isHidden) elements.hostPlayerName.focus();
  });
}

elements.players.addEventListener("click", (event) => {
  if (!state.isHost) return;
  if (isGameSettled() || isSettleOpen()) return;
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
    const isEditing = tile.classList.toggle("editing");
    tile.querySelectorAll("[data-role='edit-name'], [data-role='edit-count'], [data-role='edit-total']").forEach((input) => {
      input.disabled = !isEditing;
    });
    const nameInput = tile.querySelector("[data-role='edit-name']");
    if (isEditing && nameInput) nameInput.focus();
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
  if (isGameSettled() || isSettleOpen()) return;
  if (event.key !== "Enter") return;
  if (!["edit-count", "edit-total", "edit-name"].includes(event.target.dataset.role)) return;
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
    if (button) {
      clearCurrentGame();
      setStatus("Ready");
      return;
    }
    const shareButton = event.target.closest("button[data-action='share']");
    if (shareButton) {
      shareSummary(elements.playerSettledSummary);
      return;
    }
    const historyButton = event.target.closest("button[data-action='history']");
    if (!historyButton) return;
    clearCurrentGame();
    openSessionsPage();
  });
}

if (elements.settlementSummary) {
  elements.settlementSummary.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='home']");
    if (button) {
      clearCurrentGame();
      setStatus("Ready");
      return;
    }
    const shareButton = event.target.closest("button[data-action='share']");
    if (shareButton) {
      shareSummary(elements.settlementSummary);
      return;
    }
    const historyButton = event.target.closest("button[data-action='history']");
    if (!historyButton) return;
    clearCurrentGame();
    openSessionsPage();
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

if (elements.playerSubmitChips) {
  elements.playerSubmitChips.addEventListener("click", () => {
    submitPlayerChips();
  });
}

if (elements.playerSettleAmount) {
  elements.playerSettleAmount.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitPlayerChips();
    }
  });
}

elements.gameName.addEventListener("change", updateGameSettings);

elements.currency.addEventListener("change", updateGameSettings);

elements.defaultBuyIn.addEventListener("change", updateGameSettings);

window.addEventListener("online", () => setConnection(""));
window.addEventListener("offline", () => setConnection(""));
