// Online poker Supabase RPC client.
// Thin wrapper — server-side SQL functions stay authoritative.

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

function isMissingRpcFunction(error, fnName) {
  const msg = String(error?.message || error || "").toLowerCase();
  const needle = fnName.toLowerCase();
  if (!msg.includes(needle)) return false;
  return (
    msg.includes("could not find the function") ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

async function callRpc(supabase, fnName, args) {
  const { data, error } = await supabase.rpc(fnName, args);
  if (error) throw normalizeError(fnName, error);
  return data;
}

export function createOnlinePokerClient(supabase) {
  assertSupabaseClient(supabase);

  return {
    // ---------- Identity ----------
    ensureLobbyPlayer({ name }) {
      return callRpc(supabase, "online_ensure_lobby_player", {
        p_name: name
      });
    },

    // ---------- Table lifecycle ----------
    createTable({
      groupId,
      name,
      createdByGroupPlayerId = null,
      variant = "nlhe",
      bettingStructure = "no_limit",
      smallBlind = 1,
      bigBlind = 2,
      maxSeats = 6,
      startingStack = 200,
    }) {
      return callRpc(supabase, "online_create_table", {
        p_group_id: groupId,
        p_name: name,
        p_created_by_group_player_id: createdByGroupPlayerId,
        p_variant: variant,
        p_betting_structure: bettingStructure,
        p_small_blind: smallBlind,
        p_big_blind: bigBlind,
        p_max_seats: maxSeats,
        p_starting_stack: startingStack,
      });
    },

    joinTable({
      tableId,
      groupPlayerId,
      preferredSeat = null,
      chipStack = null,
      seatToken = null
    }) {
      return callRpc(supabase, "online_join_table", {
        p_table_id: tableId,
        p_group_player_id: groupPlayerId,
        p_preferred_seat: preferredSeat,
        p_chip_stack: chipStack,
        p_seat_token: seatToken
      });
    },

    leaveTable({ tableId, groupPlayerId, seatToken }) {
      return callRpc(supabase, "online_leave_table", {
        p_table_id: tableId,
        p_group_player_id: groupPlayerId,
        p_seat_token: seatToken
      });
    },

    rebuyChips({ tableId, groupPlayerId, seatToken, amount = null }) {
      return callRpc(supabase, "online_rebuy_chips", {
        p_table_id: tableId,
        p_group_player_id: groupPlayerId,
        p_seat_token: seatToken,
        p_amount: amount
      });
    },

    // ---------- Hand lifecycle ----------
    startHand({ tableId, startedByGroupPlayerId = null, hostSeatToken = null }) {
      return callRpc(supabase, "online_start_hand", {
        p_table_id: tableId,
        p_started_by_group_player_id: startedByGroupPlayerId,
        p_host_seat_token: hostSeatToken
      });
    },

    submitAction({
      handId,
      actorGroupPlayerId,
      actionType,
      amount = null,
      clientActionId = null,
      seatToken = null
    }) {
      return callRpc(supabase, "online_submit_action", {
        p_hand_id: handId,
        p_actor_group_player_id: actorGroupPlayerId,
        p_action_type: actionType,
        p_amount: amount,
        p_client_action_id: clientActionId,
        p_seat_token: seatToken
      });
    },

    advanceHand({ handId, actorGroupPlayerId = null, reason = "tick", hostSeatToken = null }) {
      return callRpc(supabase, "online_advance_hand", {
        p_hand_id: handId,
        p_actor_group_player_id: actorGroupPlayerId,
        p_reason: reason,
        p_host_seat_token: hostSeatToken
      });
    },

    getHandState({ handId, sinceSeq = null }) {
      return callRpc(supabase, "online_get_hand_state", {
        p_hand_id: handId,
        p_since_seq: sinceSeq
      });
    },

    async getTableState({
      tableId,
      sinceSeq = null,
      viewerGroupPlayerId = null,
      viewerSeatToken = null
    }) {
      try {
        return await callRpc(supabase, "online_get_table_state_viewer", {
          p_table_id: tableId,
          p_viewer_group_player_id: viewerGroupPlayerId,
          p_viewer_seat_token: viewerSeatToken,
          p_since_seq: sinceSeq
        });
      } catch (error) {
        if (!isMissingRpcFunction(error, "online_get_table_state_viewer")) {
          throw error;
        }
        throw new Error(
          "Online schema is outdated: missing online_get_table_state_viewer. Re-run supabase/online_poker_schema.sql."
        );
      }
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

    async runtimeTick({
      tableId = null,
      limit = 50,
      maxAdvancePerHand = 3,
      actorGroupPlayerId = null,
      settleNote = "edge_runtime_auto_showdown"
    } = {}) {
      const { data, error } = await supabase.functions.invoke("online-runtime-tick", {
        body: {
          table_id: tableId,
          limit,
          max_advance_per_hand: maxAdvancePerHand,
          actor_group_player_id: actorGroupPlayerId,
          settle_note: settleNote
        }
      });
      if (error) throw normalizeError("runtimeTick", error);
      if (data?.ok === false) throw new Error(`[runtimeTick] ${data.error || "runtime tick failed"}`);
      return data?.report || data || null;
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

    async getTableInfo(tableId) {
      const { data, error } = await supabase
        .from("online_tables")
        .select("*")
        .eq("id", tableId)
        .maybeSingle();
      if (error) throw normalizeError("getTableInfo", error);
      return data || null;
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
