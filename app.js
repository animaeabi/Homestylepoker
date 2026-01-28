import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import QRCode from "https://esm.sh/qrcode@1.5.3";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (selector) => document.querySelector(selector);

const elements = {
  newGameName: $("#newGameName"),
  newCurrency: $("#newCurrency"),
  newBuyIn: $("#newBuyIn"),
  createGame: $("#createGame"),
  joinCode: $("#joinCode"),
  joinGame: $("#joinGame"),
  configNotice: $("#configNotice"),
  gamePanel: $("#gamePanel"),
  gameTitle: $("#gameTitle"),
  gameCode: $("#gameCode"),
  gameName: $("#gameName"),
  currency: $("#currency"),
  defaultBuyIn: $("#defaultBuyIn"),
  copyLink: $("#copyLink"),
  copyLinkInline: $("#copyLinkInline"),
  openLink: $("#openLink"),
  joinLink: $("#joinLink"),
  qrCanvas: $("#qrCanvas"),
  hostModeToggle: $("#hostModeToggle"),
  hostPanel: $("#hostPanel"),
  summary: $("#summary"),
  hostPlayerName: $("#hostPlayerName"),
  hostAddPlayer: $("#hostAddPlayer"),
  players: $("#players"),
  playerPanel: $("#playerPanel"),
  playerJoin: $("#playerJoin"),
  playerName: $("#playerName"),
  joinAsPlayer: $("#joinAsPlayer"),
  playerSeat: $("#playerSeat"),
  playerCard: $("#playerCard"),
  playerAddDefault: $("#playerAddDefault"),
  playerCustomAmount: $("#playerCustomAmount"),
  playerAddCustom: $("#playerAddCustom"),
  playerBuyins: $("#playerBuyins"),
  logTable: $("#logTable"),
  connectionStatus: $("#connectionStatus"),
  saveStatus: $("#saveStatus")
};

const state = {
  game: null,
  players: [],
  buyins: [],
  isHost: false,
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
}

const supabase = configMissing ? null : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const playerKey = (code) => `poker_player_${code}`;
const hostKey = (code) => `poker_host_${code}`;

const safeTrim = (value) => (value || "").trim();

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
  elements.hostPanel.classList.toggle("hidden", !state.isHost);
  elements.gameName.disabled = !state.isHost;
  elements.currency.disabled = !state.isHost;
  elements.defaultBuyIn.disabled = !state.isHost;
  elements.hostPlayerName.disabled = !state.isHost;
  elements.hostAddPlayer.disabled = !state.isHost;
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

  return { totalBuyins, buyinCount, playersCount, average };
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

function renderSummary() {
  const { totalBuyins, buyinCount, playersCount, average } = computeSummary();
  const cards = [
    { label: "Total pot", value: formatCurrency(totalBuyins) },
    { label: "Total buy-ins", value: buyinCount },
    { label: "Players", value: playersCount },
    { label: "Avg per player", value: formatCurrency(average) }
  ];

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
    const net = (Number(player.cashout) || 0) - total;

    const card = document.createElement("div");
    card.className = "player-tile";
    card.dataset.playerId = player.id;

    card.innerHTML = `
      <div class="player-header">
        <h4>${player.name}</h4>
        <button data-action="remove">Remove</button>
      </div>
      <div class="player-stats">
        <div><strong>${buyins.length}</strong>Buy-ins</div>
        <div><strong>${formatCurrency(total)}</strong>Total</div>
        <div><strong>${formatCurrency(player.cashout || 0)}</strong>Cash out</div>
        <div><strong>${formatCurrency(net)}</strong>Net</div>
      </div>
      <div class="player-actions">
        <button class="primary" data-action="add-default">Add buy-in · ${formatCurrency(
          state.game?.default_buyin || 0
        )}</button>
        <div class="row">
          <input data-role="custom" type="number" min="1" step="1" placeholder="Custom amount" />
          <button class="ghost" data-action="add-custom">Add</button>
        </div>
        <label class="field">
          <span>Cash out</span>
          <input data-role="cashout" type="number" min="0" step="1" value="${
            Number(player.cashout) || 0
          }" />
        </label>
      </div>
    `;

    elements.players.appendChild(card);
  });
}

function renderPlayerSeat() {
  const player = state.players.find((item) => item.id === state.playerId);
  if (!player) {
    if (state.playerId && state.game) {
      localStorage.removeItem(playerKey(state.game.code));
      state.playerId = null;
    }
    elements.playerJoin.classList.remove("hidden");
    elements.playerSeat.classList.add("hidden");
    return;
  }

  const buyins = state.buyins.filter((item) => item.player_id === player.id);
  const total = buyins.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  elements.playerJoin.classList.add("hidden");
  elements.playerSeat.classList.remove("hidden");
  elements.playerCard.innerHTML = `
    <strong>${player.name}</strong>
    <div>Buy-ins: ${buyins.length} · ${formatCurrency(total)}</div>
  `;

  elements.playerAddDefault.textContent = `Add default buy-in · ${formatCurrency(
    state.game?.default_buyin || 0
  )}`;

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

function renderAll() {
  if (!state.game) return;
  elements.gamePanel.classList.remove("hidden");
  hydrateInputs();
  applyHostMode();
  renderSummary();
  renderPlayers();
  renderPlayerSeat();
  renderLog();
}

async function refreshData() {
  if (!supabase || !state.game) return;
  try {
    const [gameRes, playersRes, buyinsRes] = await Promise.all([
      supabase.from("games").select("*").eq("id", state.game.id).single(),
      supabase.from("players").select("*").eq("game_id", state.game.id).order("created_at"),
      supabase.from("buyins").select("*").eq("game_id", state.game.id).order("created_at", { ascending: false })
    ]);

    if (gameRes.error) throw gameRes.error;
    if (playersRes.error) throw playersRes.error;
    if (buyinsRes.error) throw buyinsRes.error;

    state.game = gameRes.data;
    state.players = playersRes.data || [];
    state.buyins = buyinsRes.data || [];
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

  state.channel = supabase
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
    )
    .subscribe((status) => {
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
  const storedPlayerId = localStorage.getItem(playerKey(state.game.code));
  const storedHost = localStorage.getItem(hostKey(state.game.code)) === "true";
  const hostParam = new URLSearchParams(window.location.search).get("host");
  state.playerId = storedPlayerId || null;
  state.isHost = hostParam === "1" || storedHost;
  if (hostParam === "1") {
    localStorage.setItem(hostKey(state.game.code), "true");
  }
  history.replaceState({}, "", state.isHost ? getHostLink() : getJoinLink());

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
  localStorage.setItem(hostKey(state.game.code), "true");
  history.replaceState({}, "", getHostLink());

  renderAll();
  await refreshData();
  await startRealtime();
  setStatus("Game created");
}

async function joinAsPlayer() {
  if (!supabase || !state.game) return;
  const name = safeTrim(elements.playerName.value);
  if (!name) return;

  const { data, error } = await supabase
    .from("players")
    .insert({ game_id: state.game.id, name, cashout: 0 })
    .select()
    .single();

  if (error) {
    setStatus("Could not join", "error");
    return;
  }

  state.playerId = data.id;
  localStorage.setItem(playerKey(state.game.code), data.id);
  elements.playerName.value = "";
  await refreshData();
}

async function addPlayerByName(name) {
  if (!supabase || !state.game) return;
  const trimmed = safeTrim(name);
  if (!trimmed) return;

  const { error } = await supabase
    .from("players")
    .insert({ game_id: state.game.id, name: trimmed, cashout: 0 });

  if (error) {
    setStatus("Could not add player", "error");
    return;
  }

  await refreshData();
}

async function addBuyin(playerId, amount) {
  if (!supabase || !state.game) return;
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

async function updateCashout(playerId, value) {
  if (!supabase) return;
  const numeric = Number(value);
  const { error } = await supabase
    .from("players")
    .update({ cashout: Number.isFinite(numeric) ? numeric : 0 })
    .eq("id", playerId);

  if (error) {
    setStatus("Cashout update failed", "error");
  }
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
    localStorage.removeItem(playerKey(state.game.code));
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

if (!configMissing) {
  const params = new URLSearchParams(window.location.search);
  const incomingCode = safeTrim(params.get("code"));
  if (incomingCode) {
    loadGameByCode(incomingCode);
  }
}

// Event listeners

elements.createGame.addEventListener("click", () => {
  if (configMissing) return;
  createGame();
});

elements.joinGame.addEventListener("click", () => {
  if (configMissing) return;
  loadGameByCode(elements.joinCode.value);
});

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

elements.hostModeToggle.addEventListener("change", () => {
  if (!state.game) return;
  state.isHost = elements.hostModeToggle.checked;
  localStorage.setItem(hostKey(state.game.code), String(state.isHost));
  applyHostMode();
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
  const action = event.target.dataset.action;
  if (!action) return;
  const tile = event.target.closest(".player-tile");
  if (!tile) return;
  const playerId = tile.dataset.playerId;

  if (action === "remove") {
    removePlayer(playerId);
    return;
  }

  if (action === "add-default") {
    addBuyin(playerId, state.game?.default_buyin || 0);
    return;
  }

  if (action === "add-custom") {
    const input = tile.querySelector("[data-role='custom']");
    if (!input) return;
    addBuyin(playerId, input.value);
    input.value = "";
  }
});

elements.players.addEventListener("change", (event) => {
  if (!state.isHost) return;
  if (event.target.dataset.role === "cashout") {
    const tile = event.target.closest(".player-tile");
    if (!tile) return;
    updateCashout(tile.dataset.playerId, event.target.value);
  }
});

elements.players.addEventListener("keydown", (event) => {
  if (!state.isHost) return;
  if (event.key !== "Enter") return;
  if (event.target.dataset.role !== "custom") return;
  const tile = event.target.closest(".player-tile");
  if (!tile) return;
  addBuyin(tile.dataset.playerId, event.target.value);
  event.target.value = "";
});

elements.joinAsPlayer.addEventListener("click", () => {
  joinAsPlayer();
});

elements.playerName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinAsPlayer();
  }
});

elements.playerAddDefault.addEventListener("click", () => {
  if (!state.playerId) return;
  addBuyin(state.playerId, state.game?.default_buyin || 0);
});

elements.playerAddCustom.addEventListener("click", () => {
  if (!state.playerId) return;
  addBuyin(state.playerId, elements.playerCustomAmount.value);
  elements.playerCustomAmount.value = "";
});

elements.playerCustomAmount.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  if (!state.playerId) return;
  addBuyin(state.playerId, event.target.value);
  event.target.value = "";
});

elements.gameName.addEventListener("change", updateGameSettings);

elements.currency.addEventListener("change", updateGameSettings);

elements.defaultBuyIn.addEventListener("change", updateGameSettings);

window.addEventListener("online", () => setConnection("Online"));
window.addEventListener("offline", () => setConnection("Offline"));
