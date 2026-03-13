# Online Automation Checks

These are the repeatable smoke checks for the online poker website.

## Setup

```bash
cd /Users/abishek/Documents/poker-buyins
npm install
npx playwright install chromium
```

## 1) Runtime / stuck-hand health check

This talks directly to Supabase and fails if the runtime dispatcher is not configured or if stale hands are detected.

```bash
SUPABASE_SERVICE_ROLE_KEY=... npm run check:runtime
```

Optional one-shot repair attempt:

```bash
SUPABASE_SERVICE_ROLE_KEY=... npm run check:runtime -- --repair
```

Optional tuning:

```bash
SUPABASE_SERVICE_ROLE_KEY=... npm run check:runtime -- --limit 25 --grace 20
```

## 2) Browser smoke run

This launches Chromium, exercises the landing-page online create flow, confirms the table boots, leaves the table, and checks that the Online Games panel still opens.

Default local run:

```bash
npm run smoke:web
```

By default it targets:

```text
http://127.0.0.1:8000/index.html
```

If nothing is running there, the script starts a temporary `python3 -m http.server 8000` from the repo root.

To run against a deployed site instead:

```bash
POKER_SMOKE_URL="https://animaeabi.github.io/poker-buyins/index.html" npm run smoke:web
```

To run headed for debugging:

```bash
POKER_SMOKE_HEADLESS=false npm run smoke:web
```

Screenshots are written to:

```text
/Users/abishek/Documents/poker-buyins/output/web-smoke/
```

## 3) Online table UI smoke run

This is the second automation lane focused only on online poker UI elements. It:

- creates an online table
- verifies the top bar shell
- opens/closes Settings
- opens/closes Hand Log
- opens Chat and sends a test message
- adds a bot to an open seat
- clicks `Deal`
- waits for the hero action rail to appear

Run it with:

```bash
npm run smoke:online-ui
```

Screenshots are written to:

```text
/Users/abishek/Documents/poker-buyins/output/online-ui-smoke/
```

## 4) Combined run

```bash
SUPABASE_SERVICE_ROLE_KEY=... npm run smoke:all
```

## Current coverage

- landing page loads
- online accordion opens
- online create flow succeeds
- redirect to live online table succeeds
- core table shell and `Deal` button appear
- leaving the table returns to the landing page
- Online Games panel opens from the landing page
- online table UI shell is interactable end-to-end
- settings, hand log, and chat panels open/close correctly
- bot add flow works from an open seat
- live hero action rail appears after `Deal`
- runtime health reports stale-hands / dispatcher issues

## What this does not cover yet

- full live betting rounds
- showdown timing
- chat / voice
- host-only controls beyond the basic table shell
- multi-device seat claim and reconnect flows
