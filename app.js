import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.3";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (selector) => document.querySelector(selector);

const elements = {
  landing: $("#landing"),
  newGameName: $("#newGameName"),
  newCurrency: $("#newCurrency"),
  newBuyIn: $("#newBuyIn"),
  createGame: $("#createGame"),
  joinCode: $("#joinCode"),
  joinGame: $("#joinGame"),
  configNotice: $("#configNotice"),
  themeToggle: $("#themeToggle"),
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
  settlePanel: $("#settlePanel"),
  settleForm: $("#settleForm"),
  settleList: $("#settleList"),
  settleCancel: $("#settleCancel"),
  settlementSummary: $("#settlementSummary"),
  hostModeToggle: $("#hostModeToggle"),
  hostPanel: $("#hostPanel"),
  summary: $("#summary"),
  hostPlayerName: $("#hostPlayerName"),
  hostAddPlayer: $("#hostAddPlayer"),
  players: $("#players"),
  recentGames: $("#recentGames"),
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
  elements.joinGame.disabled = true;
  elements.joinAsPlayer.disabled = true;
  elements.hostAddPlayer.disabled = true;
  if (elements.openSettle) elements.openSettle.disabled = true;
}

const supabase = configMissing ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const playerKey = (code) => `poker_player_${code}`;
const hostKey = (code) => `poker_host_${code}`;
const recentGamesKey = "poker_recent_games";
const themeKey = "poker_theme";

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
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  applyTheme(prefersDark ? "dark" : "light");
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

function recordRecentGame(game) {
  if (!game) return;
  const list = loadRecentGames();
  const next = [
    {
      code: game.code,
      name: game.name,
      created_at: game.created_at,
      ended_at: game.ended_at || null
    },
    ...list.filter((item) => item.code !== game.code)
  ].slice(0, 8);
  saveRecentGames(next);
  renderRecentGames(next);
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

  list.forEach((game) => {
    const row = document.createElement("div");
    row.className = "recent-item";
    const dateLabel = formatShortDate(game.ended_at || game.created_at);
    row.innerHTML = `
      <div>
        <strong>${game.name || "Home Game"}</strong>
        <span>${dateLabel} · ${game.code}</span>
      </div>
      <button class="ghost" data-action="open" data-code="${game.code}">Open</button>
    `;
    elements.recentGames.appendChild(row);
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
  } catch (err) {
    const temp = document.createElement("textarea");
    temp.value = value;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
    setStatus("Join link copied.");
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
  if (elements.settlePanel && settled) {
    elements.settlePanel.classList.add("hidden");
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
    { width: 180, margin: 1, color: { dark: "#1b140c", light: "#ffffff" } },
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
  if (elements.playerSettledSummary) {
    elements.playerSettledSummary.classList.add("hidden");
  }
  return;
}

  const buyins = state.buyins.filter((item) => item.player_id === player.id);
  const total = buyins.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  elements.playerJoin.classList.add("hidden");
  elements.playerSeat.classList.remove("hidden");
  if (elements.playerSettledSummary) {
    elements.playerSettledSummary.classList.add("hidden");
  }
  elements.playerCard.innerHTML = `
    <strong>${player.name}</strong>
    <div>Buy-ins: ${buyins.length} · ${formatCurrency(total)}</div>
  `;

  elements.playerAddDefault.textContent = `Add buy-in (${formatCurrency(
    state.game?.default_buyin || 0
  )})`;

  elements.playerBuyins.innerHTML = "";
  if (buyins.length === 0) {
    const chip = document.createElement("span");
    chip.className = "buyin-chip";
    chip.textContent = "No buy-ins yet";
    elements.playerBuyins.appendChild(chip);
    return;
  }

  buyins
    .slice()
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 6)
    .forEach((buyin) => {
      const chip = document.createElement("span");
      chip.className = "buyin-chip";
      chip.textContent = `${formatCurrency(buyin.amount)} · ${formatTime(buyin.created_at)}`;
      elements.playerBuyins.appendChild(chip);
    });
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
    { node: elements.settlementSummary, visible: settled && state.isHost, title: "Settlement" },
    { node: elements.playerSettledSummary, visible: settled && !state.isHost, title: "Game settled" }
  ];

  const playerLookup = new Map(state.players.map((player) => [player.id, player.name]));
  const rows = state.settlements
    .slice()
    .sort((a, b) => (playerLookup.get(a.player_id) || "").localeCompare(playerLookup.get(b.player_id) || ""));

  containers.forEach(({ node, visible, title }) => {
    if (!node) return;
    node.innerHTML = "";
    node.classList.toggle("hidden", !visible);
    if (!visible) return;

    const header = document.createElement("div");
    header.className = "panel-title";
    header.innerHTML = `<h2>${title}</h2><p>Final chips on hand by player.</p>`;
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

function renderAll() {
  if (!state.game) return;
  elements.landing.classList.add("hidden");
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
  const hostParam = new URLSearchParams(window.location.search).get("host");
  state.playerId = storedPlayer?.id || null;
  state.canHost = hostParam === "1" || storedHost;
  state.isHost = state.canHost;
  if (hostParam === "1") {
    localStorage.setItem(hostKey(state.game.code), "true");
  }
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

async function createGame() {
  if (!supabase) return;
  const name = safeTrim(elements.newGameName.value) || "Home Game";
  const currency = safeTrim(elements.newCurrency.value) || "$";
  const defaultBuyIn = Number(elements.newBuyIn.value) || 20;
  let code = generateCode();

  let result = await supabase
    .from("games")
    .insert({ code, name, currency, default_buyin: defaultBuyIn })
    .select()
    .single();

  if (result.error && result.error.code === "23505") {
    code = generateCode();
    result = await supabase
      .from("games")
      .insert({ code, name, currency, default_buyin: defaultBuyIn })
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

  renderAll();
  await refreshData();
  await startRealtime();
  setStatus("Game created");
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

  const { data, error } = await supabase
    .from("players")
    .insert({ game_id: state.game.id, name })
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

async function addPlayerByName(name) {
  if (!supabase || !state.game) return;
  if (isGameSettled()) {
    setStatus("Game settled. New players are closed.", "error");
    return;
  }
  const trimmed = safeTrim(name);
  if (!trimmed) return;

  const { error } = await supabase.from("players").insert({ game_id: state.game.id, name: trimmed });

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
  elements.settlePanel.classList.remove("hidden");
  renderSettleList();
  elements.settlePanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeSettlePanel() {
  elements.settlePanel.classList.add("hidden");
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
  if (elements.settledNotice) elements.settledNotice.classList.add("hidden");
  if (elements.settlePanel) elements.settlePanel.classList.add("hidden");
  if (elements.settlementSummary) elements.settlementSummary.classList.add("hidden");
  if (elements.playerSettledSummary) elements.playerSettledSummary.classList.add("hidden");
  elements.landing.classList.remove("hidden");
  history.replaceState({}, "", window.location.pathname);
  renderRecentGames();
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
  for (const row of rows) {
    const input = row.querySelector("input");
    const playerId = row.dataset.playerId;
    const amount = Number(input.value);
    if (!Number.isFinite(amount) || amount < 0) {
      setStatus("Enter valid chip totals for every player.", "error");
      input.focus();
      return;
    }
    entries.push({ game_id: state.game.id, player_id: playerId, amount });
  }

  const { error: settlementError } = await supabase.from("settlements").insert(entries);
  if (settlementError) {
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
    renderRecentGames();
  }
} else {
  renderRecentGames();
}

initTheme();

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
  createGame();
});

elements.joinGame.addEventListener("click", () => {
  if (configMissing) return;
  loadGameByCode(elements.joinCode.value);
});

if (elements.recentGames) {
  elements.recentGames.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action='open']");
    if (!button) return;
    loadGameByCode(button.dataset.code);
  });
}

elements.copyLink.addEventListener("click", () => {
  if (!state.game) return;
  copyText(getJoinLink());
});

elements.copyLinkInline.addEventListener("click", () => {
  if (!state.game) return;
  copyText(getJoinLink());
});

elements.openLink.addEventListener("click", () => {
  if (!state.game) return;
  window.open(getJoinLink(), "_blank");
});

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
    saveStoredPlayer(state.game.code, { id: player.id, name: player.name });
    elements.playerMatchList.classList.add("hidden");
    elements.playerMatchList.innerHTML = "";
    elements.playerName.value = "";
    await refreshData();
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
