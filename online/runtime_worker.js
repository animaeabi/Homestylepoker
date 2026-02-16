import { fileURLToPath } from "node:url";
import { settleShowdownFromState } from "./settle_showdown.js";

const STREET_STATES = new Set(["preflop", "flop", "turn", "river"]);

function ensure(value, name) {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required value: ${name}`);
  }
  return String(value).trim();
}

function normalizeBaseUrl(url) {
  const value = ensure(url, "supabaseUrl");
  return value.replace(/\/+$/, "");
}

function buildHeaders(apiKey) {
  const key = ensure(apiKey, "supabaseApiKey");
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json"
  };
}

async function decodeErrorBody(response) {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const json = JSON.parse(text);
    if (json?.message) return `${response.status} ${json.message}`;
    return `${response.status} ${text}`;
  } catch {
    return `${response.status} ${text}`;
  }
}

export function createSupabaseRestClient({ supabaseUrl, supabaseApiKey, fetchImpl = fetch }) {
  const baseUrl = normalizeBaseUrl(supabaseUrl);
  const headers = buildHeaders(supabaseApiKey);

  async function request(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(await decodeErrorBody(response));
    }

    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  return {
    async listProcessableHands(limit = 50) {
      const capped = Math.max(1, Math.min(Number(limit) || 50, 200));
      return (
        (await request(
          `/rest/v1/online_hands?select=id,table_id,state,action_seat,last_action_at` +
            `&state=in.(preflop,flop,turn,river,showdown)` +
            `&order=last_action_at.asc.nullslast` +
            `&limit=${capped}`
        )) || []
      );
    },

    async advanceHand({ handId, actorGroupPlayerId = null, reason = "allin_progress" }) {
      return request(`/rest/v1/rpc/online_advance_hand`, {
        method: "POST",
        body: {
          p_hand_id: handId,
          p_actor_group_player_id: actorGroupPlayerId,
          p_reason: reason
        }
      });
    },

    async getHandState({ handId, sinceSeq = null }) {
      return request(`/rest/v1/rpc/online_get_hand_state`, {
        method: "POST",
        body: {
          p_hand_id: handId,
          p_since_seq: sinceSeq
        }
      });
    },

    async settleShowdown({ handId, payouts, actorGroupPlayerId = null, note = null }) {
      return request(`/rest/v1/rpc/online_settle_showdown`, {
        method: "POST",
        body: {
          p_hand_id: handId,
          p_payouts: payouts,
          p_actor_group_player_id: actorGroupPlayerId,
          p_note: note
        }
      });
    }
  };
}

export async function processHandForRuntime(
  onlineClient,
  hand,
  { maxAdvancePerHand = 3, actorGroupPlayerId = null, settleNote = "runtime_auto_showdown" } = {}
) {
  const handId = hand?.id;
  if (!handId) return { handId: null, advanced: 0, settled: false, skipped: true, reason: "missing_hand_id" };

  let currentState = hand.state;
  let actionSeat = hand.action_seat;
  let advanced = 0;
  let settled = false;

  if (currentState === "showdown") {
    await settleShowdownFromState({
      onlineClient,
      handId,
      actorGroupPlayerId,
      note: settleNote
    });
    settled = true;
    return { handId, state: "settled", advanced, settled, skipped: false };
  }

  if (!STREET_STATES.has(currentState) || actionSeat != null) {
    return {
      handId,
      state: currentState,
      advanced,
      settled,
      skipped: true,
      reason: "hand_not_auto_advanceable"
    };
  }

  for (let i = 0; i < maxAdvancePerHand; i += 1) {
    const next = await onlineClient.advanceHand({
      handId,
      actorGroupPlayerId,
      reason: "allin_progress"
    });

    advanced += 1;
    currentState = next?.state || currentState;
    actionSeat = next?.action_seat;

    if (currentState === "showdown") {
      await settleShowdownFromState({
        onlineClient,
        handId,
        actorGroupPlayerId,
        note: settleNote
      });
      settled = true;
      currentState = "settled";
      break;
    }

    if (currentState === "settled" || actionSeat != null || !STREET_STATES.has(currentState)) {
      break;
    }
  }

  return { handId, state: currentState, advanced, settled, skipped: false };
}

export async function runRuntimeTick(
  onlineClient,
  { limit = 50, maxAdvancePerHand = 3, actorGroupPlayerId = null, settleNote = "runtime_auto_showdown" } = {}
) {
  const hands = await onlineClient.listProcessableHands(limit);
  const report = {
    scanned: hands.length,
    advanced: 0,
    settled: 0,
    skipped: 0,
    errors: []
  };

  for (const hand of hands) {
    try {
      const result = await processHandForRuntime(onlineClient, hand, {
        maxAdvancePerHand,
        actorGroupPlayerId,
        settleNote
      });
      report.advanced += result.advanced || 0;
      report.settled += result.settled ? 1 : 0;
      report.skipped += result.skipped ? 1 : 0;
    } catch (error) {
      report.errors.push({ handId: hand?.id || null, message: error.message || String(error) });
    }
  }

  return report;
}

export function startRuntimeWorker(onlineClient, options = {}) {
  const intervalMs = Math.max(Number(options.intervalMs) || 2500, 500);
  let timer = null;
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const report = await runRuntimeTick(onlineClient, options);
      if (report.advanced || report.settled || report.errors.length) {
        console.log("[online-runtime]", JSON.stringify(report));
      }
    } catch (error) {
      console.error("[online-runtime] fatal tick error:", error);
    } finally {
      running = false;
    }
  };

  run();
  timer = setInterval(run, intervalMs);

  return {
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}

async function main() {
  const client = createSupabaseRestClient({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseApiKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
  });

  const intervalMs = Number(process.env.ONLINE_RUNTIME_INTERVAL_MS || 2500);
  const limit = Number(process.env.ONLINE_RUNTIME_HAND_LIMIT || 50);
  const maxAdvancePerHand = Number(process.env.ONLINE_RUNTIME_MAX_ADVANCE || 3);

  console.log(
    `[online-runtime] started interval=${intervalMs}ms limit=${limit} maxAdvance=${maxAdvancePerHand}`
  );

  const runner = startRuntimeWorker(client, {
    intervalMs,
    limit,
    maxAdvancePerHand,
    settleNote: "runtime_auto_showdown"
  });

  const stop = () => {
    runner.stop();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  main().catch((error) => {
    console.error("[online-runtime] failed to start", error);
    process.exit(1);
  });
}
