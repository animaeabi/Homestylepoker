import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "output", "online-ui-smoke");

const smokeUrl = process.env.POKER_SMOKE_URL || "http://127.0.0.1:8000/index.html";
const headless = process.env.POKER_SMOKE_HEADLESS !== "false";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReachable(url, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) return true;
    await sleep(250);
  }
  return false;
}

async function maybeStartLocalServer(url) {
  const parsed = new URL(url);
  const localHost = ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (!localHost) return null;
  if (await isReachable(url)) return null;

  const port = parsed.port || "8000";
  const server = spawn("python3", ["-m", "http.server", port, "--bind", parsed.hostname], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  const ready = await waitForReachable(url, 10_000);
  if (!ready) {
    server.kill("SIGTERM");
    throw new Error(`Local UI smoke server failed to start at ${url}`);
  }
  return server;
}

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function takeScreenshot(page, name) {
  const filename = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: filename, fullPage: true });
  return filename;
}

async function clickUi(page, selector) {
  const locator = page.locator(selector);
  await locator.waitFor({ state: "visible" });
  try {
    await locator.click({ timeout: 5_000 });
    return;
  } catch (error) {
    const message = error?.message || String(error);
    if (!/outside of the viewport/i.test(message)) throw error;
  }
  await locator.evaluate((node) => node.click());
}

async function createOnlineTable(page, suffix) {
  const playerName = `UI Smoke ${suffix}`;
  const tableName = `UI Smoke Table ${suffix}`;

  await page.goto(`${smokeUrl}${smokeUrl.includes("?") ? "&" : "?"}ui_smoke=${suffix}`, {
    waitUntil: "networkidle",
  });
  await page.locator("#onlineToggle").click();
  await page.locator("#onlineBody").waitFor({ state: "visible" });
  await page.locator("#onlineName").fill(playerName);
  await page.locator("#onlineTableName").fill(tableName);
  await Promise.all([
    page.waitForURL(/online-table\.html\?table=/, { timeout: 25_000 }),
    page.locator("#createOnlineGame").click(),
  ]);
  await page.locator("#copyLinkBtn").waitFor({ state: "visible", timeout: 25_000 });
}

async function waitForActionStrip(page, timeoutMs = 20_000) {
  await page.waitForFunction(() => {
    const strip = document.querySelector("#actionStrip");
    return !!strip && !strip.classList.contains("hidden");
  }, null, { timeout: timeoutMs });
}

async function main() {
  await ensureDir(outputDir);
  const server = await maybeStartLocalServer(smokeUrl);
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    userAgent: "PokerBuyinsOnlineUiSmoke/1.0",
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (
        /favicon\.ico/i.test(text) ||
        /\[loadTableState\] Error: \[online_get_table_state_viewer\] TypeError: Failed to fetch/i.test(text) ||
        /online_get_table_game_state_viewer/i.test(text) ||
        /online_continue_hand/i.test(text) ||
        /Failed to load resource.*404/i.test(text)
      ) {
        return;
      }
      consoleErrors.push(text);
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));

  const suffix = uniqueSuffix();
  try {
    await createOnlineTable(page, suffix);

    await Promise.all([
      page.locator("#hamburgerBtn").waitFor({ state: "visible" }),
      page.locator("#copyLinkBtn").waitFor({ state: "visible" }),
      page.locator("#logToggle").waitFor({ state: "visible" }),
      page.locator("#leaveBtn").waitFor({ state: "visible" }),
      page.locator("#startHandBtn").waitFor({ state: "visible" }),
    ]);
    const voiceAria = await page.locator("#voiceFab").getAttribute("aria-label");
    assert(/voice/i.test(voiceAria || ""), "Voice action should be available for the seated host.");

    await clickUi(page, "#hamburgerBtn");
    await page.locator("#configOverlay:not(.hidden)").waitFor({ state: "visible" });
    await page.locator('[data-tab="prefs"]').click();
    await page.locator("#configTabPrefs:not(.hidden)").waitFor({ state: "visible" });
    await page.locator('[data-tab="game"]').click();
    await page.locator("#configTabGame:not(.hidden)").waitFor({ state: "visible" });
    await takeScreenshot(page, "config-panel-open");
    await page.locator("#configClose").click();
    await page.locator("#configOverlay.hidden").waitFor({ state: "attached" });

    await clickUi(page, "#logToggle");
    await page.locator("#handLog.open").waitFor({ state: "visible" });
    await takeScreenshot(page, "hand-log-open");
    await page.locator("#handLogClose").click();
    await page.waitForFunction(() => {
      const log = document.querySelector("#handLog");
      return !!log && !log.classList.contains("open");
    }, null, { timeout: 10_000 });

    await clickUi(page, "#chatFab");
    await page.locator("#chatPanel:not(.hidden)").waitFor({ state: "visible" });
    await page.locator("#chatInput").fill("Smoke test hello");
    await page.locator("#chatSend").click();
    await page.locator(".chat-msg.self .chat-msg-body").filter({ hasText: "Smoke test hello" }).waitFor({ state: "visible" });
    await takeScreenshot(page, "chat-panel-open");
    await page.locator("#chatClose").click();
    await page.locator("#chatFab:not(.hidden)").waitFor({ state: "visible" });

    const openSeat = page.locator(".seat-node.empty").first();
    await openSeat.click();
    await page.locator(".seat-popover .pop-bot").click();
    await page.waitForFunction(() => {
      const botSeats = [...document.querySelectorAll(".seat-node.bot-seat")];
      return botSeats.length >= 1;
    }, null, { timeout: 15_000 });
    await page.locator("#removeBotsBtn").waitFor({ state: "visible" });
    await takeScreenshot(page, "bot-added");

    await page.locator("#startHandBtn").click();
    await page.waitForFunction(() => {
      const heroCards = document.querySelectorAll("#myHandCards .card");
      return heroCards.length >= 2;
    }, null, { timeout: 20_000 });
    await waitForActionStrip(page, 25_000);

    const callLabel = await page.locator("#callBtn").textContent();
    const foldLabel = await page.locator("#foldBtn").textContent();
    assert(foldLabel && /fold/i.test(foldLabel), "Fold button should be visible once the hero action rail appears.");
    assert(callLabel && /(check|call)/i.test(callLabel), "Call/check button should be visible once the hero action rail appears.");
    await takeScreenshot(page, "live-hand-ui");

    const reactionHidden = await page.locator("#reactionTray").evaluate((node) => node.classList.contains("hidden"));
    assert(reactionHidden, "Reaction tray should stay hidden during a live hand.");

    if (pageErrors.length) {
      throw new Error(`Page errors detected:\n${pageErrors.join("\n")}`);
    }
    if (consoleErrors.length) {
      throw new Error(`Console errors detected:\n${consoleErrors.join("\n")}`);
    }

    console.log(JSON.stringify({
      ok: true,
      smokeUrl,
      screenshots: [
        path.join(outputDir, "config-panel-open.png"),
        path.join(outputDir, "hand-log-open.png"),
        path.join(outputDir, "chat-panel-open.png"),
        path.join(outputDir, "bot-added.png"),
        path.join(outputDir, "live-hand-ui.png"),
      ],
    }, null, 2));
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (server) server.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
