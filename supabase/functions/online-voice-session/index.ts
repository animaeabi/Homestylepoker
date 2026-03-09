import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DAILY_API_BASE = "https://api.daily.co/v1";
const VOICE_LIMIT_MINUTES = 9000;
const ROOM_TTL_SECS = 3 * 60 * 60;
const USAGE_CACHE_MS = 15 * 60 * 1000;
const LIST_LIMIT = 100;

const usageCache = {
  monthKey: "",
  usageMinutes: 0,
  fetchedAt: 0,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "authorization,x-client-info,apikey,content-type",
    },
  });
}

function asText(value: unknown) {
  const text = String(value || "").trim();
  return text || null;
}

function createAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env.");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function callDaily(apiKey: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("authorization", `Bearer ${apiKey}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(`${DAILY_API_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!res.ok) {
    const err = new Error(
      String((payload as { error?: string; info?: string })?.error || (payload as { info?: string })?.info || text || `Daily API ${res.status}`)
    ) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return payload;
}

function getCollection(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray((payload as { data?: unknown[] })?.data)) return (payload as { data: unknown[] }).data;
  if (Array.isArray((payload as { meetings?: unknown[] })?.meetings)) return (payload as { meetings: unknown[] }).meetings;
  if (Array.isArray((payload as { participants?: unknown[] })?.participants)) return (payload as { participants: unknown[] }).participants;
  return [];
}

function roomNameForTable(tableId: string) {
  return `poker-table-${tableId}`.toLowerCase();
}

function roomUrlFor(domain: string, roomName: string) {
  const host = domain.replace(/^https?:\/\//i, "").replace(/\/+$/g, "");
  return `https://${host}/${roomName}`;
}

function getCurrentMonthWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  const monthKey = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    monthKey,
  };
}

function parseDurationSeconds(participant: Record<string, unknown>) {
  const candidates = [
    participant.duration,
    participant.duration_seconds,
    participant.duration_secs,
    participant.session_duration,
    participant.session_duration_seconds,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate || 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

async function fetchMeetingParticipants(apiKey: string, meetingName: string) {
  const payload = await callDaily(apiKey, `/meetings/${encodeURIComponent(meetingName)}/participants`);
  return getCollection(payload) as Record<string, unknown>[];
}

async function fetchMonthlyUsageMinutes(apiKey: string) {
  const { startIso, endIso, monthKey } = getCurrentMonthWindow();
  if (
    usageCache.monthKey === monthKey &&
    Date.now() - usageCache.fetchedAt < USAGE_CACHE_MS
  ) {
    return { monthKey, usageMinutes: usageCache.usageMinutes };
  }

  const meetings: Record<string, unknown>[] = [];
  let startingAfter: string | null = null;

  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({
      timeframe_start: startIso,
      timeframe_end: endIso,
      limit: String(LIST_LIMIT),
    });
    if (startingAfter) params.set("starting_after", startingAfter);

    const payload = await callDaily(apiKey, `/meetings?${params.toString()}`);
    const batch = getCollection(payload) as Record<string, unknown>[];
    meetings.push(...batch);
    if (batch.length < LIST_LIMIT) break;
    const last = batch[batch.length - 1];
    startingAfter = String(last?.id || last?.name || "");
    if (!startingAfter) break;
  }

  let totalSeconds = 0;
  for (const meeting of meetings) {
    const meetingName = String(meeting?.name || meeting?.id || "").trim();
    if (!meetingName) continue;
    const participants = await fetchMeetingParticipants(apiKey, meetingName);
    for (const participant of participants) {
      totalSeconds += parseDurationSeconds(participant);
    }
  }

  const usageMinutes = Math.ceil(totalSeconds / 60);
  usageCache.monthKey = monthKey;
  usageCache.usageMinutes = usageMinutes;
  usageCache.fetchedAt = Date.now();
  return { monthKey, usageMinutes };
}

async function getMonthlyUsageMinutesSafe(apiKey: string) {
  const { monthKey } = getCurrentMonthWindow();
  try {
    const usage = await fetchMonthlyUsageMinutes(apiKey);
    return { ...usage, estimated: false };
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 0);
    const message = String((error as Error)?.message || error || "");
    const isRateLimited = status === 429 || /rate-limit-error|rate limit/i.test(message);
    if (!isRateLimited) throw error;

    if (usageCache.monthKey === monthKey && Number.isFinite(usageCache.usageMinutes)) {
      return {
        monthKey,
        usageMinutes: usageCache.usageMinutes,
        estimated: true,
      };
    }

    return {
      monthKey,
      usageMinutes: 0,
      estimated: true,
    };
  }
}

async function ensureRoom(apiKey: string, dailyDomain: string, tableId: string) {
  const roomName = roomNameForTable(tableId);
  try {
    await callDaily(apiKey, "/rooms", {
      method: "POST",
      body: JSON.stringify({
        name: roomName,
        privacy: "private",
        properties: {
          max_participants: 10,
          start_audio_off: true,
          start_video_off: true,
        },
      }),
    });
  } catch (error) {
    const status = Number((error as { status?: number })?.status || 0);
    const msg = String((error as Error)?.message || "");
    // Daily may return a generic invalid-request-error when a room name already exists.
    // We can safely continue because the room URL is deterministic and token creation
    // below will fail if the room truly does not exist.
    const alreadyExists = (
      status === 409 ||
      /already exists|conflict|taken/i.test(msg) ||
      (status === 400 && msg === "invalid-request-error")
    );
    if (!alreadyExists) throw error;
  }

  return {
    roomName,
    roomUrl: roomUrlFor(dailyDomain, roomName),
  };
}

async function createMeetingToken(apiKey: string, roomName: string, userName: string, userId: string) {
  const payload = await callDaily(apiKey, "/meeting-tokens", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        user_id: userId,
        start_audio_off: true,
        start_video_off: true,
        exp: Math.floor(Date.now() / 1000) + ROOM_TTL_SECS,
        eject_at_token_exp: true,
      },
    }),
  }) as { token?: string; meeting_token?: string };

  const token = payload?.token || payload?.meeting_token || null;
  if (!token) throw new Error("Daily meeting token was missing from the response.");
  return token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const dailyApiKey = asText(Deno.env.get("DAILY_API_KEY"));
    const dailyDomain = asText(Deno.env.get("DAILY_DOMAIN"));
    if (!dailyApiKey || !dailyDomain) {
      throw new Error("Missing DAILY_API_KEY or DAILY_DOMAIN in Edge Function secrets.");
    }

    const body = await req.json().catch(() => ({}));
    const tableId = asText(body?.table_id);
    const actorGroupPlayerId = asText(body?.actor_group_player_id);
    const seatToken = asText(body?.seat_token);

    if (!tableId || !actorGroupPlayerId || !seatToken) {
      return json({ ok: false, error: "table_id, actor_group_player_id, and seat_token are required." }, 400);
    }

    const supabase = createAdminClient();

    const { data: seat, error: seatError } = await supabase
      .from("online_table_seats")
      .select("seat_no, group_player_id, is_bot")
      .eq("table_id", tableId)
      .eq("group_player_id", actorGroupPlayerId)
      .eq("seat_token", seatToken)
      .is("left_at", null)
      .maybeSingle();
    if (seatError) throw seatError;
    if (!seat || seat.is_bot) {
      return json({
        ok: false,
        code: "voice_access_requires_active_human_seat",
        error: "Voice is only available to seated human players.",
      }, 403);
    }

    const { data: player, error: playerError } = await supabase
      .from("group_players")
      .select("name")
      .eq("id", actorGroupPlayerId)
      .maybeSingle();
    if (playerError) throw playerError;

    const usage = await getMonthlyUsageMinutesSafe(dailyApiKey);
    if (usage.usageMinutes >= VOICE_LIMIT_MINUTES) {
      return json({
        ok: false,
        code: "voice_monthly_limit_reached",
        error: "Voice is unavailable until next month.",
        usage_minutes: usage.usageMinutes,
        limit_minutes: VOICE_LIMIT_MINUTES,
        month_key: usage.monthKey,
        usage_estimated: usage.estimated,
      }, 429);
    }

    const room = await ensureRoom(dailyApiKey, dailyDomain, tableId)
      .catch((error) => {
        throw new Error(`Daily room setup failed: ${String((error as Error)?.message || error)}`);
      });
    const meetingToken = await createMeetingToken(
      dailyApiKey,
      room.roomName,
      String(player?.name || "Player").slice(0, 40),
      actorGroupPlayerId
    ).catch((error) => {
      throw new Error(`Daily token creation failed: ${String((error as Error)?.message || error)}`);
    });

    return json({
      ok: true,
      room_name: room.roomName,
      room_url: room.roomUrl,
      meeting_token: meetingToken,
      usage_minutes: usage.usageMinutes,
      limit_minutes: VOICE_LIMIT_MINUTES,
      month_key: usage.monthKey,
      usage_estimated: usage.estimated,
    });
  } catch (error) {
    console.error("[online-voice-session]", error);
    return json({
      ok: false,
      error: String((error as Error)?.message || error || "voice_session_failed"),
    }, 500);
  }
});
