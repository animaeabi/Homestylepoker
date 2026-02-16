// Online poker Supabase RPC client (M2).
// This wrapper is intentionally thin: server-side SQL functions stay authoritative.

function assertSupabaseClient(supabase) {
  if (!supabase || typeof supabase.rpc !== "function") {
    throw new Error("A Supabase client instance is required.");
  }
}

function normalizeError(fnName, error) {
  if (!error) return null;
  const msg = error.message || String(error);
  const code = error.code ? ` (${error.code})` : "";
  return new Error(`[${fnName}] ${msg}${code}`);
}

async function callRpc(supabase, fnName, args) {
  const { data, error } = await supabase.rpc(fnName, args);
  if (error) throw normalizeError(fnName, error);
  return data;
}

export function createOnlinePokerClient(supabase) {
  assertSupabaseClient(supabase);

  return {
    // ---------- Table lifecycle ----------
    createTable({
      groupId,
      name,
      createdByGroupPlayerId = null,
      variant = "nlhe",
      bettingStructure = "no_limit",
      smallBlind = 1,
      bigBlind = 2,
      maxSeats = 6
    }) {
      return callRpc(supabase, "online_create_table", {
        p_group_id: groupId,
        p_name: name,
        p_created_by_group_player_id: createdByGroupPlayerId,
        p_variant: variant,
        p_betting_structure: bettingStructure,
        p_small_blind: smallBlind,
        p_big_blind: bigBlind,
        p_max_seats: maxSeats
      });
    },

    joinTable({
      tableId,
      groupPlayerId,
      preferredSeat = null,
      chipStack = 200
    }) {
      return callRpc(supabase, "online_join_table", {
        p_table_id: tableId,
        p_group_player_id: groupPlayerId,
        p_preferred_seat: preferredSeat,
        p_chip_stack: chipStack
      });
    },

    leaveTable({ tableId, groupPlayerId }) {
      return callRpc(supabase, "online_leave_table", {
        p_table_id: tableId,
        p_group_player_id: groupPlayerId
      });
    },

    // ---------- Hand lifecycle ----------
    startHand({ tableId, startedByGroupPlayerId = null }) {
      return callRpc(supabase, "online_start_hand", {
        p_table_id: tableId,
        p_started_by_group_player_id: startedByGroupPlayerId
      });
    },

    submitAction({
      handId,
      actorGroupPlayerId,
      actionType,
      amount = null,
      clientActionId = null
    }) {
      return callRpc(supabase, "online_submit_action", {
        p_hand_id: handId,
        p_actor_group_player_id: actorGroupPlayerId,
        p_action_type: actionType,
        p_amount: amount,
        p_client_action_id: clientActionId
      });
    },

    advanceHand({ handId, actorGroupPlayerId = null, reason = "tick" }) {
      return callRpc(supabase, "online_advance_hand", {
        p_hand_id: handId,
        p_actor_group_player_id: actorGroupPlayerId,
        p_reason: reason
      });
    },

    getHandState({ handId, sinceSeq = null }) {
      return callRpc(supabase, "online_get_hand_state", {
        p_hand_id: handId,
        p_since_seq: sinceSeq
      });
    },

    getTableState({ tableId, sinceSeq = null }) {
      return callRpc(supabase, "online_get_table_state", {
        p_table_id: tableId,
        p_since_seq: sinceSeq
      });
    },

    writeSnapshot({ handId }) {
      return callRpc(supabase, "online_write_hand_snapshot", {
        p_hand_id: handId
      });
    },

    settleShowdown({
      handId,
      payouts,
      actorGroupPlayerId = null,
      note = null
    }) {
      return callRpc(supabase, "online_settle_showdown", {
        p_hand_id: handId,
        p_payouts: payouts,
        p_actor_group_player_id: actorGroupPlayerId,
        p_note: note
      });
    },

    // ---------- Read helpers ----------
    async listTablesByGroup(groupId) {
      const { data, error } = await supabase
        .from("online_tables")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false });
      if (error) throw normalizeError("listTablesByGroup", error);
      return data || [];
    },

    async getLatestHand(tableId) {
      const { data, error } = await supabase
        .from("online_hands")
        .select("*")
        .eq("table_id", tableId)
        .order("hand_no", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw normalizeError("getLatestHand", error);
      return data || null;
    }
  };
}
