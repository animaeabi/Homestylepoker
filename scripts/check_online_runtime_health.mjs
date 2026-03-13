import { SUPABASE_URL } from "../config.js";

function parseArgs(argv) {
  const args = {
    limit: 20,
    grace: 15,
    repair: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === "--repair") {
      args.repair = true;
      continue;
    }
    if (part === "--limit" && argv[index + 1]) {
      args.limit = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (part === "--grace" && argv[index + 1]) {
      args.grace = Number(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function normalizeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function callRpc(baseUrl, serviceRoleKey, fnName, payload = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${fnName} failed (${response.status}): ${text}`);
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function summarizeHealth(health) {
  return {
    dispatch_ready: !!health?.dispatch_ready,
    processable_count: Number(health?.processable_count || 0),
    due_table_count: Number(health?.due_table_count || 0),
    stale_hand_count: Array.isArray(health?.stale_hands) ? health.stale_hands.length : 0,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = normalizeNumber(args.limit, 20);
  const grace = normalizeNumber(args.grace, 15);
  const baseUrl = process.env.SUPABASE_URL || SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY.");
    console.error("Example: SUPABASE_SERVICE_ROLE_KEY=... npm run check:runtime");
    process.exit(2);
  }

  const healthPayload = { p_limit: limit, p_grace_secs: grace };
  let health = await callRpc(baseUrl, serviceRoleKey, "online_runtime_health_check", healthPayload);

  if (args.repair && Array.isArray(health?.stale_hands) && health.stale_hands.length) {
    console.log("Runtime health check found stale hands. Dispatching one repair tick...");
    await callRpc(baseUrl, serviceRoleKey, "online_dispatch_edge_runtime", {});
    await new Promise((resolve) => setTimeout(resolve, 1800));
    health = await callRpc(baseUrl, serviceRoleKey, "online_runtime_health_check", healthPayload);
  }

  console.log(JSON.stringify({
    checked_at: health?.checked_at || null,
    summary: summarizeHealth(health),
    stale_hands: health?.stale_hands || [],
  }, null, 2));

  const unhealthy =
    !health?.dispatch_ready ||
    (Array.isArray(health?.stale_hands) && health.stale_hands.length > 0);

  process.exit(unhealthy ? 1 : 0);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
