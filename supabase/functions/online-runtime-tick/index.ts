import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveShowdownPayouts } from "../_shared/showdown.ts";
import { botThinkTimeMs, classifyOpponentProfile, combineOpponentProfiles, decideBotAction } from "../_shared/bot_engine.ts";

const STREET_STATES = new Set(["preflop", "flop", "turn", "river"]);
const ACTIVE_RUNTIME_STATES = new Set(["preflop", "flop", "turn", "river", "showdown"]);
const DEFAULT_TURN_TIMEOUT_SECS = 25;
const POST_ACTION_STREET_CLOSE_BREATH_MS = 950;
const POST_ACTION_SHOWDOWN_SETTLE_BREATH_MS = 1250;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-client-info,apikey,content-type,x-online-runtime-secret"
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

function hasValidRuntimeDispatchSecret(req: Request) {
  const expected = asText(Deno.env.get("ONLINE_RUNTIME_DISPATCH_SECRET"));
  if (!expected) {
    throw new Error("Missing ONLINE_RUNTIME_DISPATCH_SECRET in Edge Function env.");
  }
  const actual = asText(req.headers.get("x-online-runtime-secret"));
  return Boolean(actual && actual === expected);
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
        .select("id, group_player_id, seat_token, is_bot, bot_personality, bot_rebuy_count, chip_stack, auto_check_when_available")
        .eq("table_id", tableId)
        .eq("seat_no", seatNo)
        .is("left_at", null)
        .maybeSingle();
      if (error) throw normalizeSupabaseError("[getActiveSeatByNumber]", error);
      return data || null;
    },

    async listActiveBotSeats({ tableId }: { tableId: string }) {
      const { data, error } = await client
        .from("online_table_seats")
        .select("id, seat_no, group_player_id, seat_token, bot_personality, bot_rebuy_count, chip_stack")
        .eq("table_id", tableId)
        .eq("is_bot", true)
        .is("left_at", null)
        .not("group_player_id", "is", null)
        .order("seat_no", { ascending: true });
      if (error) throw normalizeSupabaseError("[listActiveBotSeats]", error);
      return data || [];
    },

    async getTableById({ tableId }: { tableId: string }) {
      const { data, error } = await client
        .from("online_tables")
        .select("id, big_blind, max_seats, decision_time_secs")
        .eq("id", tableId)
        .maybeSingle();
      if (error) throw normalizeSupabaseError("[getTableById]", error);
      return data || null;
    },

    async getBotOpponentProfiles({ tableId }: { tableId: string }) {
      return callRpc("online_get_bot_opponent_profiles", {
        p_table_id: tableId
      });
    },

    async updateBotSeat({
      seatId,
      patch
    }: {
      seatId: string;
      patch: Record<string, unknown>;
    }) {
      const { data, error } = await client
        .from("online_table_seats")
        .update(patch)
        .eq("id", seatId)
        .select("id")
        .maybeSingle();
      if (error) throw normalizeSupabaseError("[updateBotSeat]", error);
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
    },

    async rebuyChips({
      tableId,
      groupPlayerId,
      seatToken
    }: {
      tableId: string;
      groupPlayerId: string;
      seatToken: string;
    }) {
      return callRpc("online_rebuy_chips", {
        p_table_id: tableId,
        p_group_player_id: groupPlayerId,
        p_seat_token: seatToken,
        p_amount: null
      });
    },

    async leaveTable({
      tableId,
      groupPlayerId,
      seatToken
    }: {
      tableId: string;
      groupPlayerId: string;
      seatToken: string;
    }) {
      return callRpc("online_leave_table", {
        p_table_id: tableId,
        p_group_player_id: groupPlayerId,
        p_seat_token: seatToken
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

function didSeatAggressInCurrentHand(events: any[], groupPlayerId: string | null) {
  if (!groupPlayerId) return false;
  for (let i = (events || []).length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.event_type !== "action_taken") continue;
    if (ev?.actor_group_player_id !== groupPlayerId) continue;
    const action = String(ev?.payload?.action_type || "");
    if (action === "bet" || action === "raise" || action === "all_in") return true;
  }
  return false;
}

function summarizeStreetActionShape(events: any[], street: string, bigBlind: number) {
  let aggressionCount = 0;
  let limperCount = 0;
  for (const ev of events || []) {
    if (ev?.event_type !== "action_taken") continue;
    if (String(ev?.payload?.street || "") !== String(street || "")) continue;
    const action = String(ev?.payload?.action_type || "");
    if (action === "raise" || action === "bet" || action === "all_in") {
      aggressionCount += 1;
      continue;
    }
    if (
      street === "preflop"
      && action === "call"
      && Number(ev?.payload?.to_call_before || 0) <= Math.max(1, Number(bigBlind || 2)) * 1.05
    ) {
      limperCount += 1;
    }
  }
  return { aggressionCount, limperCount };
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function countActionablePlayers(players: any[]) {
  return (players || []).filter((player: any) =>
    !player?.folded &&
    !player?.all_in &&
    toNumber(player?.stack_end, 0) > 0
  ).length;
}

function effectiveStackBbForBot(botPlayer: any, players: any[], bigBlind: number) {
  const blind = Math.max(1, Number(bigBlind || 2));
  const botTotal = toNumber(botPlayer?.stack_end, 0) + toNumber(botPlayer?.committed, 0);
  const opponentTotals = (players || [])
    .filter((player: any) =>
      Number(player?.seat_no) !== Number(botPlayer?.seat_no) &&
      !player?.folded &&
      (toNumber(player?.stack_end, 0) + toNumber(player?.committed, 0)) > 0
    )
    .map((player: any) => toNumber(player?.stack_end, 0) + toNumber(player?.committed, 0));
  const maxOpponentTotal = opponentTotals.length ? Math.max(...opponentTotals) : botTotal;
  return Math.max(1, Math.min(botTotal, maxOpponentTotal) / blind);
}

function buildOpponentRead({
  profileRow,
  handPlayer,
  tableBigBlind,
  avgStackBb,
}: {
  profileRow: any;
  handPlayer: any;
  tableBigBlind: number;
  avgStackBb: number;
}) {
  return classifyOpponentProfile({
    seatNo: Number(profileRow?.seat_no || handPlayer?.seat_no || 0) || null,
    playerName: String(profileRow?.player_name || ""),
    stack: toNumber(handPlayer?.stack_end, profileRow?.chip_stack),
    bigBlind: tableBigBlind,
    avgStackBb,
    overall: profileRow?.overall || null,
    session: profileRow?.session || null,
  });
}

async function processBotAction({
  onlineClient,
  hand,
  actingSeat,
  actorGroupPlayerId = null,
  settleNote = "edge_runtime_auto_showdown"
}: {
  onlineClient: ReturnType<typeof createOnlineRpcClient>;
  hand: any;
  actingSeat: any;
  actorGroupPlayerId?: string | null;
  settleNote?: string;
}) {
  const handState = await onlineClient.getHandState({ handId: hand.id, sinceSeq: null });
  const liveHand = handState?.hand || hand;
  let currentState = liveHand?.state || hand.state;
  let settled = false;
  const table = await onlineClient.getTableById({ tableId: hand.table_id });
  const profileRows = await onlineClient.getBotOpponentProfiles({ tableId: hand.table_id });
  const players = Array.isArray(handState?.players) ? handState.players : [];
  const botPlayer = players.find((player: any) => Number(player.seat_no) === Number(liveHand?.action_seat || hand.action_seat));

  if (!botPlayer) {
    return { handId: hand.id, state: hand.state, advanced: 0, settled: false, skipped: true, reason: "bot_player_not_found" };
  }

  const liveOpponents = players.filter((player: any) =>
    Number(player.seat_no) !== Number(botPlayer.seat_no)
    && !player.folded
    && !player.all_in
    && toNumber(player.stack_end, 0) > 0
    && String(player.group_player_id || "")
  );
  const averageStackBb = liveOpponents.length
    ? liveOpponents.reduce((sum: number, player: any) => sum + (toNumber(player.stack_end, 0) / Math.max(1, Number(table?.big_blind || 2))), 0) / liveOpponents.length
    : (toNumber(botPlayer.stack_end, 0) / Math.max(1, Number(table?.big_blind || 2)));
  const activeHumanReads = liveOpponents
    .filter((player: any) => !player.is_bot)
    .map((player: any) => {
      const profileRow = Array.isArray(profileRows)
        ? profileRows.find((row: any) => String(row?.group_player_id || "") === String(player.group_player_id || ""))
        : null;
      return buildOpponentRead({
        profileRow,
        handPlayer: player,
        tableBigBlind: Math.max(1, Number(table?.big_blind || 2)),
        avgStackBb: averageStackBb,
      });
    })
    .filter(Boolean);
  const opponentProfile = combineOpponentProfiles(activeHumanReads);
  const streetActionShape = summarizeStreetActionShape(
    handState?.events || [],
    String(liveHand?.state || hand.state || "preflop"),
    Math.max(1, Number(table?.big_blind || 2))
  );
  const effectiveStackBb = effectiveStackBbForBot(
    botPlayer,
    players,
    Math.max(1, Number(table?.big_blind || 2))
  );

  const lastActionAt = liveHand?.last_action_at || hand.last_action_at || null;
  const elapsedMs = lastActionAt ? (Date.now() - Date.parse(lastActionAt)) : Number.MAX_SAFE_INTEGER;
  const turnTimeoutMs = Math.max(
    10,
    Number(table?.decision_time_secs || hand.decision_time_secs || DEFAULT_TURN_TIMEOUT_SECS)
  ) * 1000;
  const toCall = Math.max(0, Number(liveHand?.current_bet || 0) - Number(botPlayer.street_contribution || 0));
  const thinkMs = botThinkTimeMs({
    street: liveHand?.state || hand.state,
    toCall,
    pot: Number(liveHand?.pot_total || 0),
    currentBet: Number(liveHand?.current_bet || 0),
    activeSeatCount: players.filter((player: any) => !player.folded).length,
  });
  const shouldForceTimeoutAction = elapsedMs >= turnTimeoutMs;

  if (!shouldForceTimeoutAction && elapsedMs < thinkMs) {
    return { handId: hand.id, state: hand.state, advanced: 0, settled: false, skipped: true, reason: "awaiting_bot_think" };
  }

  if (!actingSeat?.group_player_id || !actingSeat?.seat_token) {
    if (toCall <= 0 && countActionablePlayers(players) <= 1) {
      const advancedState = await onlineClient.advanceHand({
        handId: hand.id,
        actorGroupPlayerId,
        reason: "allin_progress"
      });
      currentState = advancedState?.state || currentState;
      if (currentState === "showdown") {
        await settleShowdownFromState({
          onlineClient,
          handId: hand.id,
          actorGroupPlayerId,
          note: settleNote
        });
        settled = true;
        currentState = "settled";
      }
      return { handId: hand.id, state: currentState, advanced: 0, settled, skipped: false };
    }
    return { handId: hand.id, state: hand.state, advanced: 0, settled: false, skipped: true, reason: "bot_actor_missing_seat_token" };
  }

  const timeoutFallbackDecision = {
    actionType: toCall > 0 ? "fold" : "check",
    amount: null as number | null,
  };
  let decision = timeoutFallbackDecision;

  if (!shouldForceTimeoutAction) {
    try {
      decision = decideBotAction({
        personality: actingSeat.bot_personality || "TAG",
        holeCards: Array.isArray(botPlayer.hole_cards) ? botPlayer.hole_cards : [],
        boardCards: Array.isArray(liveHand?.board_cards) ? liveHand.board_cards : [],
        pot: Number(liveHand?.pot_total || 0),
        currentBet: Number(liveHand?.current_bet || 0),
        streetContribution: Number(botPlayer.street_contribution || 0),
        stackEnd: Number(botPlayer.stack_end || 0),
        bigBlind: Number(table?.big_blind || 2),
        street: String(liveHand?.state || hand.state || "preflop"),
        seatNo: Number(botPlayer.seat_no || 0),
        buttonSeat: Number(liveHand?.button_seat || 0),
        totalSeats: Number(table?.max_seats || 6),
        activeSeatCount: players.filter((player: any) => !player.folded).length,
        wasAggressor: didSeatAggressInCurrentHand(handState?.events || [], actingSeat.group_player_id),
        opponentProfile,
        streetAggressionCount: streetActionShape.aggressionCount,
        preflopLimperCount: streetActionShape.limperCount,
        effectiveStackBb,
        startingStackBb: Number(table?.starting_stack || 0) / Math.max(1, Number(table?.big_blind || 2)),
        averageOpponentStackBb: averageStackBb,
      });
    } catch (_error) {
      decision = timeoutFallbackDecision;
    }
  }

  try {
    await onlineClient.submitAction({
      handId: hand.id,
      actorGroupPlayerId: actingSeat.group_player_id,
      actionType: decision.actionType,
      amount: decision.amount,
      seatToken: actingSeat.seat_token,
      clientActionId: `${shouldForceTimeoutAction ? "runtime_bot_timeout" : "runtime_bot_action"}:${hand.id}:${actingSeat.id}:${Date.now()}`
    });
  } catch (error) {
    const alreadyUsingFallback =
      decision.actionType === timeoutFallbackDecision.actionType &&
      decision.amount == null;
    if (alreadyUsingFallback) {
      throw error;
    }
    decision = timeoutFallbackDecision;
    await onlineClient.submitAction({
      handId: hand.id,
      actorGroupPlayerId: actingSeat.group_player_id,
      actionType: decision.actionType,
      amount: decision.amount,
      seatToken: actingSeat.seat_token,
      clientActionId: `runtime_bot_timeout:${hand.id}:${actingSeat.id}:${Date.now()}`
    });
  }

  const postActionState = await onlineClient.getHandState({ handId: hand.id, sinceSeq: null });
  currentState = postActionState?.hand?.state || hand.state;
  const postActionAtMs = postActionState?.hand?.last_action_at
    ? Date.parse(postActionState.hand.last_action_at)
    : NaN;
  const postActionElapsedMs = Number.isFinite(postActionAtMs)
    ? (Date.now() - postActionAtMs)
    : Number.MAX_SAFE_INTEGER;

  if (
    decision.actionType === "check" &&
    currentState === String(liveHand?.state || hand.state) &&
    Number(postActionState?.hand?.action_seat || 0) === Number(botPlayer.seat_no || 0) &&
    Number(postActionState?.hand?.current_bet || 0) <= 0 &&
    countActionablePlayers(postActionState?.players || []) <= 1
  ) {
    if (postActionElapsedMs < POST_ACTION_STREET_CLOSE_BREATH_MS) {
      return {
        handId: hand.id,
        state: currentState,
        advanced: 0,
        settled: false,
        skipped: true,
        reason: "awaiting_street_close_breath",
      };
    }
    const advancedState = await onlineClient.advanceHand({
      handId: hand.id,
      actorGroupPlayerId,
      reason: "allin_progress"
    });
    currentState = advancedState?.state || currentState;
  }

  if (currentState === "showdown") {
    if (postActionElapsedMs < POST_ACTION_SHOWDOWN_SETTLE_BREATH_MS) {
      return {
        handId: hand.id,
        state: currentState,
        advanced: 0,
        settled: false,
        skipped: true,
        reason: "awaiting_showdown_breath",
      };
    }
    await settleShowdownFromState({
      onlineClient,
      handId: hand.id,
      actorGroupPlayerId,
      note: settleNote
    });
    settled = true;
    currentState = "settled";
  }

  return { handId: hand.id, state: currentState, advanced: 0, settled, skipped: false };
}

async function prepareBotsForNextHand({
  onlineClient,
  tableId
}: {
  onlineClient: ReturnType<typeof createOnlineRpcClient>;
  tableId: string;
}) {
  const bots = await onlineClient.listActiveBotSeats({ tableId });
  for (const bot of bots) {
    if (Number(bot.chip_stack || 0) > 0) continue;
    const rebuys = Number(bot.bot_rebuy_count || 0);
    if (rebuys >= 5) {
      if (bot.group_player_id && bot.seat_token) {
        await onlineClient.leaveTable({
          tableId,
          groupPlayerId: bot.group_player_id,
          seatToken: bot.seat_token
        });
      }
      continue;
    }

    if (bot.group_player_id && bot.seat_token) {
      await onlineClient.rebuyChips({
        tableId,
        groupPlayerId: bot.group_player_id,
        seatToken: bot.seat_token
      });
      await onlineClient.updateBotSeat({
        seatId: bot.id,
        patch: { bot_rebuy_count: rebuys + 1 }
      });
    }
  }
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

    const actingSeat = await onlineClient.getActiveSeatByNumber({
      tableId: hand.table_id,
      seatNo: actionSeat
    });

    if (actingSeat?.is_bot) {
      return processBotAction({
        onlineClient,
        hand,
        actingSeat,
        actorGroupPlayerId,
        settleNote
      });
    }

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

    const handState = await onlineClient.getHandState({ handId, sinceSeq: null });
    const currentHand = handState?.hand || hand;
    const actingPlayer = Array.isArray(handState?.players)
      ? handState.players.find((player: any) => Number(player.seat_no) === Number(actionSeat))
      : null;
    const toCall = Math.max(
      0,
      Number(currentHand?.current_bet || 0) - Number(actingPlayer?.street_contribution || 0)
    );

    // Poker-correct timeout behavior: if checking is free, timeout should always resolve as check.
    // Only a live price to call should convert the timeout into a fold.
    if (toCall <= 0 && actingSeat?.group_player_id && actingSeat?.seat_token) {
      await onlineClient.submitAction({
        handId,
        actorGroupPlayerId: actingSeat.group_player_id,
        actionType: "check",
        seatToken: actingSeat.seat_token,
        clientActionId: `${actingSeat?.auto_check_when_available ? "runtime_auto_check" : "runtime_timeout_check"}:${handId}:${Date.now()}`
      });

      const postCheckState = await onlineClient.getHandState({ handId, sinceSeq: null });
      currentState = postCheckState?.hand?.state || currentState;

      if (
        currentState === String(currentHand?.state || hand.state) &&
        Number(postCheckState?.hand?.action_seat || 0) === Number(actionSeat) &&
        Number(postCheckState?.hand?.current_bet || 0) <= 0 &&
        countActionablePlayers(postCheckState?.players || []) <= 1
      ) {
        const advancedState = await onlineClient.advanceHand({
          handId,
          actorGroupPlayerId,
          reason: "allin_progress"
        });
        currentState = advancedState?.state || currentState;
      }

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
      await prepareBotsForNextHand({
        onlineClient,
        tableId: dueTableId
      });
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
    if (!hasValidRuntimeDispatchSecret(req)) {
      return json({ ok: false, error: "unauthorized_runtime_dispatch" }, 401);
    }

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
