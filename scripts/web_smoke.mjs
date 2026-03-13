import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "output", "web-smoke");

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
    throw new Error(`Local smoke server failed to start at ${url}`);
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

async function main() {
  await ensureDir(outputDir);
  const server = await maybeStartLocalServer(smokeUrl);
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    userAgent: "PokerBuyinsSmoke/1.0",
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (
        /favicon\.ico/i.test(text) ||
        /\[loadTableState\] Error: \[online_get_table_state_viewer\] TypeError: Failed to fetch/i.test(text)
      ) {
        return;
      }
      consoleErrors.push(text);
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));

  const suffix = uniqueSuffix();
  const playerName = `Smoke ${suffix}`;
  const tableName = `Smoke Table ${suffix}`;

  try {
    await page.goto(`${smokeUrl}${smokeUrl.includes("?") ? "&" : "?"}smoke=${suffix}`, {
      waitUntil: "networkidle",
    });

    await page.locator("#onlineToggle").click();
    await page.locator("#onlineBody").waitFor({ state: "visible" });
    await page.locator("#onlineName").fill(playerName);
    await page.locator("#onlineTableName").fill(tableName);
    await takeScreenshot(page, "landing-online-ready");

    await Promise.all([
      page.waitForURL(/online-table\.html\?table=/, { timeout: 25_000 }),
      page.locator("#createOnlineGame").click(),
    ]);

    await page.locator("#copyLinkBtn").waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForFunction(() => {
      const dealBtn = document.querySelector("#startHandBtn");
      return dealBtn && !dealBtn.classList.contains("hidden");
    }, null, { timeout: 25_000 });
    await takeScreenshot(page, "online-table-created");

    const dealText = await page.locator("#startHandBtn").textContent();
    assert(/deal/i.test(dealText || ""), "Deal button should be visible after table creation.");

    await page.locator("#leaveBtn").evaluate((button) => button.click());
    await page.waitForFunction(() => {
      const landing = document.querySelector("#landing");
      const gamePanel = document.querySelector("#gamePanel");
      const onLandingPath = /(?:^|\/)index\.html$|\/$/.test(window.location.pathname);
      const gamePanelHidden = !gamePanel || !gamePanel.classList.contains("active");
      return !!landing && gamePanelHidden && onLandingPath;
    }, null, { timeout: 20_000 });

    if (await page.locator("#onlineBody").isVisible()) {
      await page.locator("#onlineToggle").click();
    }
    await page.locator("#openOnlineSessions").click();
    await page.locator("#onlineSessionsPanel:not(.hidden)").waitFor({ state: "visible", timeout: 15_000 });
    await takeScreenshot(page, "landing-online-sessions");

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
        path.join(outputDir, "landing-online-ready.png"),
        path.join(outputDir, "online-table-created.png"),
        path.join(outputDir, "landing-online-sessions.png"),
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
