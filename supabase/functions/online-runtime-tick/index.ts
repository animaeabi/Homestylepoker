import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveShowdownPayouts } from "../_shared/showdown.ts";

const STREET_STATES = new Set(["preflop", "flop", "turn", "river"]);
const ACTIVE_RUNTIME_STATES = new Set(["preflop", "flop", "turn", "river", "showdown"]);
const DEFAULT_TURN_TIMEOUT_SECS = 25;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-client-info,apikey,content-type"
    }
  });
}

function parseNumber(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function asText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeSupabaseError(prefix: string, error: unknown) {
  if (!error) return new Error(prefix);
  const anyErr = error as { message?: string; code?: string };
  const msg = anyErr.message || String(error);
  return new Error(anyErr.code ? `${prefix}: ${msg} (${anyErr.code})` : `${prefix}: ${msg}`);
}

function createOnlineRpcClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env.");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const callRpc = async (fnName: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fnName, args);
    if (error) throw normalizeSupabaseError(`[rpc:${fnName}]`, error);
    return data;
  };

  return {
    async listProcessableHands({
      tableId,
      limit
    }: {
      tableId: string | null;
      limit: number;
    }) {
      return callRpc("online_runtime_processable_hands", {
        p_table_id: tableId,
        p_limit: limit
      });
    },

    async listAutoDealCandidates({ limit }: { limit: number }) {
      return callRpc("online_runtime_due_tables", {
        p_limit: limit
      });
    },

    async getActiveSeatByNumber({ tableId, seatNo }: { tableId: string; seatNo: number }) {
      const { data, error } = await client
        .from("online_table_seats")
        .select("group_player_id, seat_token")
        .eq("table_id", tableId)
        .eq("seat_no", seatNo)
        .is("left_at", null)
        .maybeSingle();
      if (error) throw normalizeSupabaseError("[getActiveSeatByNumber]", error);
      return data || null;
    },

    async submitAction({
      handId,
      actorGroupPlayerId,
      actionType,
      seatToken,
      amount = null,
      clientActionId = null
    }: {
      handId: string;
      actorGroupPlayerId: string;
      actionType: string;
      seatToken: string;
      amount?: number | null;
      clientActionId?: string | null;
    }) {
      return callRpc("online_submit_action", {
        p_hand_id: handId,
        p_actor_group_player_id: actorGroupPlayerId,
        p_action_type: actionType,
        p_amount: amount,
        p_client_action_id: clientActionId,
        p_seat_token: seatToken
      });
    },

    async advanceHand({
      handId,
      actorGroupPlayerId = null,
      reason = "allin_progress"
    }: {
      handId: string;
      actorGroupPlayerId?: string | null;
      reason?: string;
    }) {
      return callRpc("online_advance_hand", {
        p_hand_id: handId,
        p_actor_group_player_id: actorGroupPlayerId,
        p_reason: reason
      });
    },

    async getHandState({ handId, sinceSeq = null }: { handId: string; sinceSeq?: number | null }) {
      return callRpc("online_get_hand_state", {
        p_hand_id: handId,
        p_since_seq: sinceSeq
      });
    },

    async settleShowdown({
      handId,
      payouts,
      actorGroupPlayerId = null,
      note = null
    }: {
      handId: string;
      payouts: Array<{ seat_no: number; amount: number }>;
      actorGroupPlayerId?: string | null;
      note?: string | null;
    }) {
      return callRpc("online_settle_showdown", {
        p_hand_id: handId,
        p_payouts: payouts,
        p_actor_group_player_id: actorGroupPlayerId,
        p_note: note
      });
    },

    async runtimeStartHand({
      tableId,
      note = "edge_runtime_auto_deal"
    }: {
      tableId: string;
      note?: string;
    }) {
      return callRpc("online_runtime_start_hand", {
        p_table_id: tableId,
        p_note: note
      });
    }
  };
}

function buildShowdownPayoutsFromHandState(handState: any) {
  const hand = handState?.hand || {};
  const players = (handState?.players || []).map((p: any) => ({
    seatNo: Number(p.seat_no),
    folded: !!p.folded,
    committed: Number(p.committed || 0),
    holeCards: Array.isArray(p.hole_cards) ? p.hole_cards : []
  }));

  return resolveShowdownPayouts({
    boardCards: Array.isArray(hand.board_cards) ? hand.board_cards : [],
    players
  });
}

async function settleShowdownFromState({
  onlineClient,
  handId,
  actorGroupPlayerId = null,
  note = "edge_runtime_auto_showdown"
}: {
  onlineClient: ReturnType<typeof createOnlineRpcClient>;
  handId: string;
  actorGroupPlayerId?: string | null;
  note?: string;
}) {
  const state = await onlineClient.getHandState({ handId, sinceSeq: null });
  const payouts = buildShowdownPayoutsFromHandState(state);
  if (!payouts.length) {
    throw new Error("No payouts computed from showdown state.");
  }
  return onlineClient.settleShowdown({
    handId,
    payouts,
    actorGroupPlayerId,
    note
  });
}

async function processHandForRuntime({
  onlineClient,
  hand,
  maxAdvancePerHand = 3,
  actorGroupPlayerId = null,
  settleNote = "edge_runtime_auto_showdown"
}: {
  onlineClient: ReturnType<typeof createOnlineRpcClient>;
  hand: any;
  maxAdvancePerHand?: number;
  actorGroupPlayerId?: string | null;
  settleNote?: string;
}) {
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

  if (STREET_STATES.has(currentState) && actionSeat != null) {
    const lastActionAtMs = hand.last_action_at ? Date.parse(hand.last_action_at) : NaN;
    const turnTimeoutSecs = Math.max(10, Number(hand.decision_time_secs || DEFAULT_TURN_TIMEOUT_SECS));
    const elapsedSecs = Number.isFinite(lastActionAtMs)
      ? Math.max(0, (Date.now() - lastActionAtMs) / 1000)
      : turnTimeoutSecs + 1;

    if (elapsedSecs < turnTimeoutSecs) {
      return {
        handId,
        state: currentState,
        advanced,
        settled,
        skipped: true,
        reason: "awaiting_actor_action"
      };
    }

    const actingSeat = await onlineClient.getActiveSeatByNumber({
      tableId: hand.table_id,
      seatNo: actionSeat
    });

    if (!actingSeat?.group_player_id || !actingSeat?.seat_token) {
      return {
        handId,
        state: currentState,
        advanced,
        settled,
        skipped: true,
        reason: "timeout_actor_missing_seat_token"
      };
    }

    await onlineClient.submitAction({
      handId,
      actorGroupPlayerId: actingSeat.group_player_id,
      actionType: "fold",
      seatToken: actingSeat.seat_token,
      clientActionId: `runtime_timeout_fold:${handId}:${Date.now()}`
    });

    const postFoldState = await onlineClient.getHandState({ handId, sinceSeq: null });
    currentState = postFoldState?.hand?.state || currentState;

    if (currentState === "showdown") {
      await settleShowdownFromState({
        onlineClient,
        handId,
        actorGroupPlayerId,
        note: settleNote
      });
      settled = true;
      currentState = "settled";
    }

    return {
      handId,
      state: currentState,
      advanced,
      settled,
      skipped: false
    };
  }

  if (!STREET_STATES.has(currentState)) {
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

async function runRuntimeTick({
  onlineClient,
  tableId,
  limit,
  maxAdvancePerHand,
  actorGroupPlayerId = null,
  settleNote = "edge_runtime_auto_showdown"
}: {
  onlineClient: ReturnType<typeof createOnlineRpcClient>;
  tableId: string | null;
  limit: number;
  maxAdvancePerHand: number;
  actorGroupPlayerId?: string | null;
  settleNote?: string;
}) {
  const hands = await onlineClient.listProcessableHands({ tableId, limit });
  const report = {
    scanned: hands.length,
    advanced: 0,
    settled: 0,
    started: 0,
    skipped: 0,
    errors: [] as Array<{ handId: string | null; message: string }>
  };

  for (const hand of hands) {
    try {
      const result = await processHandForRuntime({
        onlineClient,
        hand,
        maxAdvancePerHand,
        actorGroupPlayerId,
        settleNote
      });
      report.advanced += result.advanced || 0;
      report.settled += result.settled ? 1 : 0;
      report.skipped += result.skipped ? 1 : 0;
    } catch (error) {
      report.errors.push({
        handId: hand?.id || null,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  let dueTables = await onlineClient.listAutoDealCandidates({ limit });
  if (tableId) {
    dueTables = (dueTables || []).filter((entry: any) => entry?.table_id === tableId);
  }

  for (const entry of dueTables || []) {
    const dueTableId = entry?.table_id || null;
    if (!dueTableId) continue;
    try {
      await onlineClient.runtimeStartHand({
        tableId: dueTableId,
        note: "edge_runtime_auto_deal"
      });
      report.started += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("online_hand_already_active") ||
        message.includes("not_enough_active_players") ||
        message.includes("runtime_no_active_human_host")
      ) {
        continue;
      }
      report.errors.push({
        handId: null,
        message: `[table:${dueTableId}] ${message}`
      });
    }
  }

  return report;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const payload = await req.json().catch(() => ({}));
    const tableId = asText(payload?.table_id);
    const limit = parseNumber(payload?.limit, 50, 1, 200);
    const maxAdvancePerHand = parseNumber(payload?.max_advance_per_hand, 3, 1, 10);
    const actorGroupPlayerId = asText(payload?.actor_group_player_id);
    const settleNote = asText(payload?.settle_note) || "edge_runtime_auto_showdown";

    const onlineClient = createOnlineRpcClient();
    const report = await runRuntimeTick({
      onlineClient,
      tableId,
      limit,
      maxAdvancePerHand,
      actorGroupPlayerId,
      settleNote
    });

    return json({ ok: true, report }, 200);
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
});
