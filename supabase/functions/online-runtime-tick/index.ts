import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveShowdownPayouts } from "../_shared/showdown.ts";
import { botThinkTimeMs, classifyOpponentProfile, combineOpponentProfiles, decideBotAction } from "../_shared/bot_engine.ts";
import { decideBotExpressions, decideMidHandExpression } from "../_shared/bot_expression.ts";
import { monteCarloEquity } from "../_shared/equity.ts";
import { resolveCharacterStyle } from "../_shared/characters.ts";
import { hasBanter, pickBanterLine, pickComebackLine } from "../_shared/bot_banter.ts";
import { cannedReply, generateGeminiReply, generateLlmReply, pickResponder } from "../_shared/bot_chat_reply.ts";

const STREET_STATES = new Set(["preflop", "flop", "turn", "river"]);
const ACTIVE_RUNTIME_STATES = new Set(["preflop", "flop", "turn", "river", "showdown"]);
const DEFAULT_TURN_TIMEOUT_SECS = 25;
const STALE_SEAT_AFTER_SECS = 300;
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
    client,
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

    async expireStaleHumanSeats({
      tableId = null,
      staleAfterSecs = STALE_SEAT_AFTER_SECS,
      limit = 32
    }: {
      tableId?: string | null;
      staleAfterSecs?: number;
      limit?: number;
    }) {
      return callRpc("online_runtime_expire_stale_human_seats", {
        p_table_id: tableId,
        p_stale_after_secs: staleAfterSecs,
        p_limit: limit
      });
    },

    async getActiveSeatByNumber({ tableId, seatNo }: { tableId: string; seatNo: number }) {
      const { data, error } = await client
        .from("online_table_seats")
        .select("id, group_player_id, seat_token, is_bot, bot_personality, bot_character, bot_rebuy_count, chip_stack, auto_check_when_available")
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
        .select("id, seat_no, group_player_id, seat_token, bot_personality, bot_character, bot_rebuy_count, chip_stack")
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

    async getBotBanditStats({ tableId }: { tableId: string }) {
      return callRpc("online_bot_bandit_get", { p_table_id: tableId });
    },

    async recordBotBluff({ handId, groupPlayerId, bucket }: { handId: string; groupPlayerId: string; bucket: string }) {
      return callRpc("online_bot_bandit_record", {
        p_hand_id: handId,
        p_group_player_id: groupPlayerId,
        p_bucket: bucket
      });
    },

    async settleBotBandit({ handId }: { handId: string }) {
      return callRpc("online_bot_bandit_settle", { p_hand_id: handId });
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
    },

    // Fire a bot's emoji reaction onto the same ephemeral realtime channel the
    // human quick-chat reactions use, so it shows as a native bubble over the
    // bot's seat. Cosmetic only -- failures are swallowed by the caller.
    async broadcastReaction({
      tableId,
      handId,
      seatNo,
      name,
      emoji,
      text
    }: {
      tableId: string;
      handId: string;
      seatNo: number;
      name?: string | null;
      emoji: string;
      text: string;
    }) {
      const payload = {
        id: `botr_${handId}_${seatNo}_${Date.now()}`,
        tableId,
        handId,
        playerId: null,
        seatNo,
        name: name || "Bot",
        emoji,
        text,
        at: Date.now()
      };
      const res = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": serviceRoleKey,
          "Authorization": `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({
          messages: [{ topic: `table-chat:${tableId}`, event: "table_reaction", payload }]
        })
      });
      if (!res.ok) {
        throw new Error(`broadcast_failed_${res.status}`);
      }
    },

    // Post a chat message AS a bot into the persistent table chat. Direct
    // insert (service role): bots hold real seats/identities, and the client
    // renders the sender name from group_players, so nothing else is needed.
    // Cosmetic -- callers swallow failures.
    async postBotChat({
      tableId,
      groupPlayerId,
      message
    }: {
      tableId: string;
      groupPlayerId: string;
      message: string;
    }) {
      const trimmed = String(message || "").trim().slice(0, 178);
      if (!trimmed) return;
      // Dedup safety net: no character should post text it (or the table) just
      // said. Catches every banter path in one place, on top of the per-pick
      // `avoid` re-roll. Compares against the last dozen table lines.
      const { data: recent } = await client
        .from("online_table_chat_messages")
        .select("group_player_id, message")
        .eq("table_id", tableId)
        .order("created_at", { ascending: false })
        .limit(12);
      if (Array.isArray(recent)) {
        const mine = String(groupPlayerId);
        const dup = recent.some((r: any) =>
          String(r.message || "").trim() === trimmed &&
          (String(r.group_player_id) === mine || recent.indexOf(r) < 3)
        );
        if (dup) return;
      }
      const { error } = await client
        .from("online_table_chat_messages")
        .insert({ table_id: tableId, group_player_id: groupPlayerId, message: trimmed });
      if (error) throw normalizeSupabaseError("[postBotChat]", error);
    },

    // The recent chat lines for a table, newest first -- used to build per-bot
    // `avoid` sets so pickers dodge lines already on screen.
    async listRecentChatLines({ tableId, limit = 12 }: { tableId: string; limit?: number }) {
      const { data, error } = await client
        .from("online_table_chat_messages")
        .select("group_player_id, message")
        .eq("table_id", tableId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) return [] as { groupPlayerId: string; message: string }[];
      return (data || []).map((r: any) => ({
        groupPlayerId: String(r.group_player_id),
        message: String(r.message || ""),
      }));
    },

    // Names + humanity of everyone currently seated -- used to pick banter
    // targets (prefer bullying a human by name) and to name comeback victims.
    async listSeatIdentities({ tableId }: { tableId: string }) {
      const { data, error } = await client
        .from("online_table_seats")
        .select("seat_no, group_player_id, is_bot, bot_character, group_players(name)")
        .eq("table_id", tableId)
        .is("left_at", null)
        .not("group_player_id", "is", null);
      if (error) throw normalizeSupabaseError("[listSeatIdentities]", error);
      return (data || []).map((s: any) => ({
        seatNo: Number(s.seat_no),
        groupPlayerId: String(s.group_player_id),
        isBot: !!s.is_bot,
        botCharacter: s.bot_character || null,
        name: s.group_players?.name || null
      }));
    },

    // Flip a bot's cards face-up for the table (a voluntary show). Mirrors what
    // online_reveal_hand_cards does for humans, but the runtime writes directly
    // since that RPC refuses bot seats.
    async showHandPlayerCards({
      handId,
      tableId,
      groupPlayerId,
      seatNo
    }: {
      handId: string;
      tableId: string;
      groupPlayerId: string;
      seatNo: number;
    }) {
      const { error } = await client
        .from("online_hand_players")
        .update({ manually_shown: true })
        .eq("hand_id", handId)
        .eq("group_player_id", groupPlayerId);
      if (error) throw normalizeSupabaseError("[showHandPlayerCards]", error);
      await callRpc("online_append_hand_event", {
        p_hand_id: handId,
        p_table_id: tableId,
        p_event_type: "cards_visibility_changed",
        p_actor_group_player_id: groupPlayerId,
        p_payload: { seat_no: seatNo, shown: true }
      });
    }
  };
}

// After a hand settles, let the bots emote: an occasional emoji reaction over
// their seat, and now and then a voluntary card-show (a bluff flash after a
// steal). Entirely best-effort -- any failure here must never affect the hand.
async function runBotExpressions({
  onlineClient,
  handId,
  tableId
}: {
  onlineClient: ReturnType<typeof createOnlineRpcClient>;
  handId: string;
  tableId: string;
}) {
  const state = await onlineClient.getHandState({ handId, sinceSeq: null });
  const hand = state?.hand || {};
  const rawPlayers = Array.isArray(state?.players) ? state.players : [];
  const events = Array.isArray(state?.events) ? state.events : [];

  let lastAggressorGpid: string | null = null;
  for (const ev of events) {
    if (ev?.event_type !== "action_taken") continue;
    const action = String(ev?.payload?.action_type || "");
    if (action === "bet" || action === "raise" || action === "all_in") {
      lastAggressorGpid = ev?.actor_group_player_id || lastAggressorGpid;
    }
  }

  const players = rawPlayers.map((p: any) => ({
    seatNo: Number(p.seat_no),
    groupPlayerId: p.group_player_id || null,
    folded: !!p.folded,
    resultAmount: Number(p.result_amount || 0),
    committed: Number(p.committed || 0),
    holeCards: Array.isArray(p.hole_cards) ? p.hole_cards : [],
    wasAggressor: Boolean(p.group_player_id) && String(p.group_player_id) === String(lastAggressorGpid)
  }));

  const botSeats = (await onlineClient.listActiveBotSeats({ tableId })).map((s: any) => {
    const ch = resolveCharacterStyle(s.bot_character);
    return {
      seatNo: Number(s.seat_no),
      groupPlayerId: String(s.group_player_id),
      personality: ch ? ch.base : (s.bot_personality || "TAG"),
      botCharacter: (s.bot_character || null) as string | null,
      name: null as string | null,
      expressiveness: ch && typeof ch.expressiveness === "number" ? ch.expressiveness : undefined
    };
  });
  if (!botSeats.length) return;

  const table = await onlineClient.getTableById({ tableId });
  const expressions = decideBotExpressions({
    players,
    botSeats,
    potTotal: Number(hand?.pot_total || 0),
    bigBlind: Number(table?.big_blind || 2)
  });

  for (const ex of expressions) {
    if (ex.reaction) {
      try {
        await onlineClient.broadcastReaction({
          tableId,
          handId,
          seatNo: ex.seatNo,
          name: ex.name,
          emoji: ex.reaction.emoji,
          text: ex.reaction.text
        });
      } catch (error) {
        console.error("[runBotExpressions] reaction failed", error instanceof Error ? error.message : String(error));
      }
    }
    if (ex.showCards) {
      try {
        await onlineClient.showHandPlayerCards({
          handId,
          tableId,
          groupPlayerId: ex.groupPlayerId,
          seatNo: ex.seatNo
        });
      } catch (error) {
        console.error("[runBotExpressions] show cards failed", error instanceof Error ? error.message : String(error));
      }
    }
  }

  // Settle chat: after a meaningful pot, at most ONE character gloats or
  // grumbles in the real table chat. Kept to a single line per hand so the
  // chat stays banter, not noise.
  try {
    const bb = Math.max(1, Number(table?.big_blind || 2));
    const potBb = Number(hand?.pot_total || 0) / bb;
    if (potBb >= 8) {
      const byGpid = new Map(botSeats.map((b) => [b.groupPlayerId, b]));
      const candidates: { characterId: string; groupPlayerId: string; context: "win" | "lose"; weight: number }[] = [];
      for (const p of players) {
        if (!p.groupPlayerId) continue;
        const bot = byGpid.get(String(p.groupPlayerId));
        if (!bot || !bot.botCharacter || !hasBanter(bot.botCharacter)) continue;
        const expr = typeof bot.expressiveness === "number" ? bot.expressiveness : 1;
        if (p.resultAmount > 0) {
          candidates.push({ characterId: bot.botCharacter, groupPlayerId: bot.groupPlayerId, context: "win", weight: 0.3 * expr });
        } else if (p.resultAmount <= -(bb * 12)) {
          candidates.push({ characterId: bot.botCharacter, groupPlayerId: bot.groupPlayerId, context: "lose", weight: 0.34 * expr });
        }
      }
      // One roll, weighted toward the chattiest candidate.
      candidates.sort((a, b) => b.weight - a.weight);
      const speaker = candidates[0];
      if (speaker && Math.random() < speaker.weight) {
        const recent = await onlineClient.listRecentChatLines({ tableId, limit: 12 });
        const avoid = recent
          .filter((r) => r.groupPlayerId === String(speaker.groupPlayerId))
          .map((r) => r.message);
        const line = pickBanterLine({ characterId: speaker.characterId, context: speaker.context, targetName: null, avoid });
        if (line) {
          await onlineClient.postBotChat({ tableId, groupPlayerId: speaker.groupPlayerId, message: line });
        }
      }
    }
  } catch (error) {
    console.error("[runBotExpressions] settle chat failed", error instanceof Error ? error.message : String(error));
  }
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
    players,
    buttonSeat: hand.button_seat != null ? Number(hand.button_seat) : null
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
  const settleResult = await onlineClient.settleShowdown({
    handId,
    payouts,
    actorGroupPlayerId,
    note
  });
  // Bots emote once the hand is in the books. Best-effort and isolated so a
  // reaction/show-cards hiccup never blocks settlement.
  try {
    const tableId = state?.hand?.table_id;
    if (tableId) {
      await runBotExpressions({ onlineClient, handId, tableId });
    }
  } catch (error) {
    console.error("[settleShowdownFromState] bot expression failed", error instanceof Error ? error.message : String(error));
  }
  // Bluff bandit: score any bluffs fired this hand.
  try {
    await onlineClient.settleBotBandit({ handId });
  } catch (error) {
    console.error("[settleShowdownFromState] bandit settle failed", error instanceof Error ? error.message : String(error));
  }
  return settleResult;
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
    if (action === "raise" || action === "bet") {
      aggressionCount += 1;
      continue;
    }
    if (action === "all_in") {
      // An all-in only counts as aggression when it actually put in MORE than
      // the price it was facing; a call-for-less all-in isn't a raise, and
      // counting it as one made bots read limped pots as 3-bet pots.
      const amount = Number(ev?.payload?.amount || 0);
      const toCallBefore = Number(ev?.payload?.to_call_before || 0);
      if (amount > toCallBefore + 1e-9) aggressionCount += 1;
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

  // The batch scan's action_seat can be stale by the time this hand's turn in
  // the loop arrives. Re-resolve the acting seat from the LIVE hand so the
  // decision inputs and the submit credentials always belong to the same seat.
  if (liveHand?.action_seat != null && Number(liveHand.action_seat) !== Number(hand.action_seat)) {
    const liveSeat = await onlineClient.getActiveSeatByNumber({
      tableId: hand.table_id,
      seatNo: Number(liveHand.action_seat)
    });
    if (!liveSeat?.is_bot || !liveSeat?.group_player_id || !liveSeat?.seat_token) {
      return { handId: hand.id, state: currentState, advanced: 0, settled: false, skipped: true, reason: "action_seat_moved" };
    }
    actingSeat = liveSeat;
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
  // Read EVERY live opponent, humans and bots alike — bots are meant to profit
  // off each other, not just the humans. Untracked opponents fall back to a
  // low-confidence default, so combineOpponentProfiles still leans on whoever
  // there's the most history for (usually the humans).
  const activeOpponentReads = liveOpponents
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
  const opponentProfile = combineOpponentProfiles(activeOpponentReads);
  // Table image: the bot's OWN read-profile, as the rest of the field sees it.
  // Now that bots are tracked, its own row is in profileRows.
  const selfProfileRow = Array.isArray(profileRows)
    ? profileRows.find((row: any) => String(row?.group_player_id || "") === String(botPlayer.group_player_id || ""))
    : null;
  const selfImageProfile = selfProfileRow
    ? buildOpponentRead({
        profileRow: selfProfileRow,
        handPlayer: botPlayer,
        tableBigBlind: Math.max(1, Number(table?.big_blind || 2)),
        avgStackBb: averageStackBb,
      })
    : null;

  // Bluff bandit: nudge this bot's bluff frequency toward what has actually been
  // working for it at this street (foldy table -> bluff more; sticky -> less).
  const banditStreet = String(liveHand?.state || hand.state || "preflop");
  let banditNudge = 0;
  try {
    const banditStats: any = await onlineClient.getBotBanditStats({ tableId: hand.table_id });
    const cell = banditStats && typeof banditStats === "object"
      ? banditStats[`${String(botPlayer.group_player_id || "")}|${banditStreet}`]
      : null;
    const attempts = Number(cell?.attempts || 0);
    const successes = Number(cell?.successes || 0);
    if (attempts > 0) {
      const prior = 0.42;
      const rate = (successes + prior * 6) / (attempts + 6);
      const conf = attempts / (attempts + 8);
      banditNudge = Math.max(-0.06, Math.min(0.06, (rate - prior) * 0.5 * conf));
    }
  } catch (_error) {
    banditNudge = 0;
  }

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
    // Sleep out the remaining think time (bounded) instead of discarding the
    // dispatch — the discard meant the fast post-action nudge never acted and
    // bots waited for the next 10s cron tick, making bot-vs-bot streets crawl.
    const waitMs = Math.min(Math.max(0, thinkMs - elapsedMs), 2500);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
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

  // The seat's signature character (if any) sets the base personality and feeds
  // per-character style overrides into the engine.
  const character = resolveCharacterStyle(actingSeat.bot_character);

  if (!shouldForceTimeoutAction) {
    try {
      decision = decideBotAction({
        personality: character ? character.base : (actingSeat.bot_personality || "TAG"),
        styleOverrides: character ? { profile: character.profile, preflop: character.preflop } : null,
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
        selfImageProfile,
        banditNudge,
        streetAggressionCount: streetActionShape.aggressionCount,
        preflopLimperCount: streetActionShape.limperCount,
        effectiveStackBb,
        startingStackBb: Number(table?.starting_stack || 0) / Math.max(1, Number(table?.big_blind || 2)),
        averageOpponentStackBb: averageStackBb,
        // Awareness inputs: the legal minimum raise, whether anyone can still
        // respond to a raise, and whether betting is reopened for this seat.
        minRaise: Number(liveHand?.min_raise || 0),
        raiseEligibleOpponents: players.filter((player: any) =>
          Number(player.seat_no) !== Number(botPlayer.seat_no)
          && !player.folded
          && !player.all_in
          && (toNumber(player.stack_end, 0) + toNumber(player.street_contribution, 0)) > Number(liveHand?.current_bet || 0)
        ).length,
        raiseLocked: String(botPlayer.raise_locked_street || "") === String(liveHand?.state || hand.state || ""),
      });
    } catch (_error) {
      decision = timeoutFallbackDecision;
    }
  }

  // Turn-scoped idempotency key: stable across racing dispatchers (cron tick +
  // post-action nudge) for the SAME turn, so the server dedupe actually
  // prevents a double action; changes when the turn changes.
  const turnStamp = Date.parse(String(liveHand?.last_action_at || hand.last_action_at || "")) || 0;
  const turnSeat = Number(liveHand?.action_seat ?? hand.action_seat ?? 0);
  try {
    await onlineClient.submitAction({
      handId: hand.id,
      actorGroupPlayerId: actingSeat.group_player_id,
      actionType: decision.actionType,
      amount: decision.amount,
      seatToken: actingSeat.seat_token,
      clientActionId: `${shouldForceTimeoutAction ? "runtime_bot_timeout" : "runtime_bot_action"}:${hand.id}:${turnSeat}:${turnStamp}`
    });
  } catch (error) {
    const message = String((error as any)?.message || error || "").toLowerCase();
    // Turn races / throttles: someone else already acted or we're temporarily
    // limited. Do NOT act on stale intent — let the next nudge/tick serve the
    // real state.
    if (message.includes("not_actor_turn")
      || message.includes("action_rate_limited")
      || message.includes("hand_not_accepting_actions")
      || message.includes("online_hand_not_found")
      || message.includes("actor_already_")) {
      return { handId: hand.id, state: currentState, advanced: 0, settled: false, skipped: true, reason: "transient_submit_conflict" };
    }
    // A genuine validation rejection means the engine produced an illegal
    // action — log it loudly (this used to be silent) and take the SAFE line:
    // call when facing a bet, check when not. The old fallback folded, which
    // made bots surrender the exact hands they were trying to raise.
    console.error("[processBotAction] rejected", decision.actionType, decision.amount, message);
    const safeFallback = {
      actionType: toCall > 0 ? "call" : "check",
      amount: null as number | null,
    };
    const alreadySafe = decision.actionType === safeFallback.actionType && decision.amount == null;
    if (alreadySafe) {
      throw error;
    }
    decision = safeFallback;
    await onlineClient.submitAction({
      handId: hand.id,
      actorGroupPlayerId: actingSeat.group_player_id,
      actionType: decision.actionType,
      amount: decision.amount,
      seatToken: actingSeat.seat_token,
      clientActionId: `runtime_bot_fallback:${hand.id}:${turnSeat}:${turnStamp}`
    });
  }

  // Mid-hand table talk: characters occasionally flash an in-character line
  // over their seat after a notable action (jam, big raise, big call/fold).
  // Cosmetic and best-effort -- a broadcast hiccup never blocks the game.
  try {
    const bbForTalk = Math.max(1, Number(table?.big_blind || 2));
    const talk = decideMidHandExpression({
      actionType: decision.actionType,
      street: String(liveHand?.state || hand.state || "preflop"),
      potBb: Number(liveHand?.pot_total || 0) / bbForTalk,
      toCallBb: Number(toCall || 0) / bbForTalk,
      raiseToBb: decision.amount != null ? Number(decision.amount) / bbForTalk : null,
      personality: character ? character.base : (actingSeat.bot_personality || "TAG"),
      expressiveness: character && typeof character.expressiveness === "number" ? character.expressiveness : undefined,
      taunts: character?.taunts || null,
    });
    if (talk) {
      await onlineClient.broadcastReaction({
        tableId,
        handId: hand.id,
        seatNo: Number(botPlayer.seat_no || 0),
        name: null,
        emoji: talk.emoji,
        text: talk.text,
      });
    }

    // Chat bullying: after a genuinely big aggro action, sometimes call out a
    // live opponent BY NAME in the table chat -- and sometimes another
    // character claps back, so the table argues with itself.
    const raiseToBbForChat = decision.amount != null ? Number(decision.amount) / bbForTalk : 0;
    const potBbForChat = Number(liveHand?.pot_total || 0) / bbForTalk;
    const isBigAggro = decision.actionType === "all_in"
      || ((decision.actionType === "bet" || decision.actionType === "raise")
        && (raiseToBbForChat >= 5 || potBbForChat >= 10));
    if (isBigAggro && character && hasBanter(actingSeat.bot_character)) {
      const chatP = 0.45 * Math.min(1.5, Number(character.expressiveness || 1));
      if (Math.random() < chatP) {
        const identities = await onlineClient.listSeatIdentities({ tableId });
        const recentLines = await onlineClient.listRecentChatLines({ tableId, limit: 12 });
        const avoidFor = (gpid: string) => recentLines
          .filter((r) => r.groupPlayerId === String(gpid))
          .map((r) => r.message);
        const liveGpids = new Set(
          players.filter((p: any) => !p.folded && p.group_player_id
            && String(p.group_player_id) !== String(actingSeat.group_player_id))
            .map((p: any) => String(p.group_player_id))
        );
        const liveOpponents = identities.filter((s: any) => liveGpids.has(s.groupPlayerId));
        // Bully a human when one is in the pot; otherwise needle a bot rival.
        const humans = liveOpponents.filter((s: any) => !s.isBot);
        const target = humans.length
          ? humans[Math.floor(Math.random() * humans.length)]
          : (liveOpponents.length ? liveOpponents[Math.floor(Math.random() * liveOpponents.length)] : null);
        if (target?.name) {
          const line = pickBanterLine({
            characterId: String(actingSeat.bot_character),
            context: "bully",
            targetName: target.name,
            avoid: avoidFor(actingSeat.group_player_id),
          });
          if (line) {
            await onlineClient.postBotChat({
              tableId,
              groupPlayerId: actingSeat.group_player_id,
              message: line,
            });
            // Clap-back from another seated character about the loudmouth.
            if (Math.random() < 0.45) {
              const speakerName = identities.find((s: any) =>
                s.groupPlayerId === String(actingSeat.group_player_id))?.name || "that guy";
              const responders = identities.filter((s: any) =>
                s.isBot && s.botCharacter && hasBanter(s.botCharacter)
                && s.groupPlayerId !== String(actingSeat.group_player_id));
              if (responders.length) {
                const responder = responders[Math.floor(Math.random() * responders.length)];
                const comeback = pickComebackLine({
                  characterId: String(responder.botCharacter),
                  aboutName: String(speakerName),
                  avoid: avoidFor(responder.groupPlayerId),
                });
                if (comeback) {
                  await onlineClient.postBotChat({
                    tableId,
                    groupPlayerId: responder.groupPlayerId,
                    message: comeback,
                  });
                }
              }
            }
          }
        }
      }
    }
  } catch (_error) {
    // table talk is cosmetic
  }

  // Bluff bandit: if the action that went in was postflop aggression with weak
  // equity, log it as a bluff/semibluff attempt to be scored at settle.
  if (
    banditStreet !== "preflop"
    && (decision.actionType === "bet" || decision.actionType === "raise" || decision.actionType === "all_in")
    && Array.isArray(botPlayer.hole_cards) && botPlayer.hole_cards.length >= 2
    && Array.isArray(liveHand?.board_cards) && liveHand.board_cards.length >= 3
  ) {
    try {
      const bluffEquity = monteCarloEquity({
        holeCards: botPlayer.hole_cards,
        boardCards: liveHand.board_cards,
        opponents: 1,
        samples: 120
      });
      if (bluffEquity < 0.5) {
        await onlineClient.recordBotBluff({
          handId: hand.id,
          groupPlayerId: actingSeat.group_player_id,
          bucket: banditStreet
        });
      }
    } catch (_error) {
      // bandit logging is best-effort
    }
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

    // A player who enabled "auto-check when available" checks immediately
    // (before the timeout) whenever checking is free, instead of stalling the
    // table for the full decision clock. Previously this preference only
    // changed a log label and did nothing.
    const autoCheckEligible = Boolean(
      actingSeat?.auto_check_when_available && actingSeat?.group_player_id && actingSeat?.seat_token
    );

    if (elapsedSecs < turnTimeoutSecs && !autoCheckEligible) {
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

    // Auto-check seat facing a live price before the clock runs out: don't act
    // for them — wait for their real decision (or the timeout).
    if (autoCheckEligible && toCall > 0 && elapsedSecs < turnTimeoutSecs) {
      return {
        handId,
        state: currentState,
        advanced,
        settled,
        skipped: true,
        reason: "awaiting_actor_action"
      };
    }

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
  let expiredSeatReport: Record<string, number> = {};
  try {
    const expireResult = await onlineClient.expireStaleHumanSeats({
      tableId,
      staleAfterSecs: STALE_SEAT_AFTER_SECS,
      limit: Math.max(limit, 32)
    });
    expiredSeatReport = {
      expired_human_seats: Number(expireResult?.expired_human_seats || 0),
      pruned_bot_seats: Number(expireResult?.pruned_bot_seats || 0),
      closed_tables: Number(expireResult?.closed_tables || 0)
    };
  } catch (error) {
    // Seat expiry is housekeeping — never let it abort the whole tick (a raw
    // network error here used to skip every table in the cycle).
    console.error("[runRuntimeTick] expireStaleHumanSeats failed", error instanceof Error ? error.message : String(error));
  }

  let hands: any[] = [];
  try {
    hands = await onlineClient.listProcessableHands({ tableId, limit });
  } catch (error) {
    console.error("[runRuntimeTick] listProcessableHands failed", error instanceof Error ? error.message : String(error));
  }
  const report = {
    expiredSeatReport,
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

  let dueTables: any[] = [];
  try {
    dueTables = await onlineClient.listAutoDealCandidates({ limit });
  } catch (error) {
    console.error("[runRuntimeTick] listAutoDealCandidates failed", error instanceof Error ? error.message : String(error));
  }
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

// A human posted in table chat -> pick a seated character and talk back.
// Auth: the sender's own seat token. Engine: LLM when ANTHROPIC_API_KEY is a
// configured secret, canned in-character banks otherwise. Best-effort by
// design — any failure returns ok:false and the game never notices.
async function handleChatReply({
  onlineClient,
  payload
}: {
  onlineClient: ReturnType<typeof createOnlineRpcClient>;
  payload: Record<string, unknown>;
}) {
  const tableId = asText(payload?.table_id);
  const groupPlayerId = asText(payload?.group_player_id);
  const seatToken = asText(payload?.seat_token);
  const message = String(payload?.text || "").trim().slice(0, 300);
  if (!tableId || !groupPlayerId || !seatToken || !message) {
    return json({ ok: false, error: "chat_reply_requires_table_player_token_text" }, 400);
  }

  // Prove the caller is really this seated player.
  const { data: senderSeat, error: seatErr } = await onlineClient.client
    .from("online_table_seats")
    .select("seat_no, is_bot")
    .eq("table_id", tableId)
    .eq("group_player_id", groupPlayerId)
    .eq("seat_token", seatToken)
    .is("left_at", null)
    .maybeSingle();
  if (seatErr || !senderSeat || senderSeat.is_bot) {
    return json({ ok: false, error: "chat_reply_seat_not_found" }, 403);
  }

  // Occasionally stay silent so it never feels like an auto-responder.
  if (Math.random() < 0.12) {
    return json({ ok: true, replied: false, reason: "chose_silence" });
  }

  const identities = await onlineClient.listSeatIdentities({ tableId });
  const sender = identities.find((s: any) => s.groupPlayerId === groupPlayerId);
  const playerName = sender?.name || "friend";
  const bots = identities
    .filter((s: any) => s.isBot && s.botCharacter)
    .map((s: any) => {
      const ch = resolveCharacterStyle(s.botCharacter);
      return {
        characterId: String(s.botCharacter),
        groupPlayerId: s.groupPlayerId,
        name: String(s.name || "Bot"),
        expressiveness: ch && typeof ch.expressiveness === "number" ? ch.expressiveness : 1
      };
    });
  if (!bots.length) {
    return json({ ok: true, replied: false, reason: "no_characters_seated" });
  }

  const responder = pickResponder(message, bots);
  if (!responder) return json({ ok: true, replied: false, reason: "no_responder" });

  // Recent transcript for LLM context (oldest first).
  const { data: recent } = await onlineClient.client
    .from("online_table_chat_messages")
    .select("message, group_player_id, created_at")
    .eq("table_id", tableId)
    .order("created_at", { ascending: false })
    .limit(8);
  const nameByGpid = new Map(identities.map((s: any) => [s.groupPlayerId, s.name || "Player"]));
  const chatHistory = (recent || [])
    .reverse()
    .map((m: any) => ({ name: String(nameByGpid.get(m.group_player_id) || "Player"), text: String(m.message || "") }));

  let reply: string | null = null;
  let usedLlm = false;
  const geminiKey = asText(Deno.env.get("GEMINI_API_KEY"));
  const anthropicKey = asText(Deno.env.get("ANTHROPIC_API_KEY"));
  const llmArgs = {
    responder,
    playerName,
    message,
    chatHistory,
    otherSeated: bots.filter((b) => b.groupPlayerId !== responder.groupPlayerId).map((b) => b.name),
  };
  // Prefer Gemini (AI Studio) when its key is set; fall back to Anthropic; then
  // to the canned banks. Any backend error drops through to the next option so a
  // provider hiccup never silences the table.
  if (geminiKey) {
    try {
      reply = await generateGeminiReply({
        apiKey: geminiKey,
        model: asText(Deno.env.get("CHAT_REPLY_MODEL")),
        ...llmArgs,
      });
      if (reply) usedLlm = true;
    } catch (error) {
      console.error("[chat_reply] gemini failed", error instanceof Error ? error.message : String(error));
    }
  }
  if (!reply && anthropicKey) {
    try {
      reply = await generateLlmReply({
        apiKey: anthropicKey,
        model: asText(Deno.env.get("CHAT_REPLY_MODEL")),
        ...llmArgs,
      });
      if (reply) usedLlm = true;
    } catch (error) {
      console.error("[chat_reply] anthropic failed, falling back to canned", error instanceof Error ? error.message : String(error));
    }
  }
  if (!reply) {
    reply = cannedReply({ characterId: responder.characterId, playerName, message });
  }
  if (!reply) return json({ ok: true, replied: false, reason: "no_line" });

  // A beat of "typing" so the reply doesn't land inhumanly fast. The LLM call
  // already took ~1s of real latency, so only a small extra beat is needed
  // there; canned replies are instant and need the full delay.
  const typingMs = usedLlm ? 200 + Math.floor(Math.random() * 400) : 700 + Math.floor(Math.random() * 1100);
  await new Promise((resolve) => setTimeout(resolve, typingMs));

  await onlineClient.postBotChat({
    tableId,
    groupPlayerId: responder.groupPlayerId,
    message: reply
  });

  return json({ ok: true, replied: true, by: responder.name });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const payload = await req.json().catch(() => ({}));
    const mode = asText(payload?.mode) || "tick";

    // Chat replies are CLIENT-initiated (fired after a human posts in table
    // chat), so they can't carry the server dispatch secret. They authenticate
    // with the caller's own seat token instead — proof they're seated at the
    // table they're talking at. Everything else still requires the secret.
    if (mode === "chat_reply") {
      const onlineClient = createOnlineRpcClient();
      return await handleChatReply({ onlineClient, payload });
    }

    if (!hasValidRuntimeDispatchSecret(req)) {
      return json({ ok: false, error: "unauthorized_runtime_dispatch" }, 401);
    }

    const onlineClient = createOnlineRpcClient();

    // Targeted nudge mode: process a single hand immediately.
    // Called server-to-server from online_continue_hand() via pg_net.
    if (mode === "nudge") {
      const handId = asText(payload?.hand_id);
      const nudgeTableId = asText(payload?.table_id);
      const actorGroupPlayerId = asText(payload?.actor_group_player_id);
      const settleNote = asText(payload?.settle_note) || "continuation_settle";

      if (!handId) {
        return json({ ok: false, error: "nudge_requires_hand_id" }, 400);
      }

      // Fetch the hand with decision_time_secs from its table
      const { data: handRow, error: handErr } = await onlineClient.client
        .from("online_hands")
        .select("id, table_id, state, action_seat, last_action_at")
        .eq("id", handId)
        .maybeSingle();
      if (handErr || !handRow) {
        return json({ ok: false, error: handErr?.message || "hand_not_found" }, 404);
      }

      // Get decision_time_secs from the table
      const { data: tableRow } = await onlineClient.client
        .from("online_tables")
        .select("decision_time_secs")
        .eq("id", handRow.table_id)
        .maybeSingle();

      const hand = {
        ...handRow,
        decision_time_secs: Math.max(10, Number(tableRow?.decision_time_secs || 25))
      };

      // Process: may cascade through multiple bot actions
      const maxAdvance = parseNumber(payload?.max_advance_per_hand, 4, 1, 10);
      let result = await processHandForRuntime({
        onlineClient,
        hand,
        maxAdvancePerHand: maxAdvance,
        actorGroupPlayerId,
        settleNote
      });

      // After processing, check if another bot needs to act (cascading)
      let cascadeCount = 0;
      const maxCascades = 6;
      while (cascadeCount < maxCascades) {
        const { data: refreshed } = await onlineClient.client
          .from("online_hands")
          .select("id, table_id, state, action_seat, last_action_at")
          .eq("id", handId)
          .maybeSingle();
        if (!refreshed || !["preflop", "flop", "turn", "river", "showdown"].includes(refreshed.state)) break;

        if (refreshed.action_seat != null) {
          const nextSeat = await onlineClient.getActiveSeatByNumber({
            tableId: refreshed.table_id,
            seatNo: refreshed.action_seat
          });
          if (nextSeat?.is_bot) {
            result = await processHandForRuntime({
              onlineClient,
              hand: { ...refreshed, decision_time_secs: hand.decision_time_secs },
              maxAdvancePerHand: maxAdvance,
              actorGroupPlayerId,
              settleNote
            });
            cascadeCount++;
            continue;
          }
        }
        break;
      }

      return json({
        ok: true,
        mode: "nudge",
        hand_id: handId,
        result: {
          state: result?.state || hand.state,
          advanced: result?.advanced || 0,
          settled: result?.settled || false,
          cascades: cascadeCount
        }
      }, 200);
    }

    // Standard tick mode (cron-driven)
    const tableId = asText(payload?.table_id);
    const limit = parseNumber(payload?.limit, 50, 1, 200);
    const maxAdvancePerHand = parseNumber(payload?.max_advance_per_hand, 3, 1, 10);
    const actorGroupPlayerId = asText(payload?.actor_group_player_id);
    const settleNote = asText(payload?.settle_note) || "edge_runtime_auto_showdown";

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
