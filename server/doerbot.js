// server/doerbot.js
//
// Read-only bridge to Mike's own DoerBot crypto trading bot — a separate
// service/repo/deploy (see server/dealtough.js for the sibling DealTough
// integration, which follows the same "call out, don't merge" shape).
//
// This is intentionally READ-ONLY and single-owner: it shows Mike his own
// bot's live status inside DoerToughMoney, nothing more. It does not expose
// any way to start/stop/trade the bot, and the route that uses this module
// is gated so no other user can see it even exists (see DOERBOT_OWNER_EMAIL
// in server.js). Letting other users' money ride the bot is a different,
// much bigger project — discretionary asset management / RIA territory —
// and is explicitly out of scope here.

const DOERBOT_STATUS_URL = (process.env.DOERBOT_STATUS_URL || "").replace(/\/+$/, "");
const DOERBOT_CONTROL_TOKEN = process.env.DOERBOT_CONTROL_TOKEN || "";

export const doerbotConfigured = () => !!DOERBOT_STATUS_URL && !!DOERBOT_CONTROL_TOKEN;

async function getJson(path, opts = {}) {
  const res = await fetch(`${DOERBOT_STATUS_URL}${path}`, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = (data && (data.error || data.raw)) || res.statusText;
    throw new Error(`DoerBot ${path} ${res.status}: ${String(detail).slice(0, 200)}`);
  }
  return data || {};
}

/**
 * Combines DoerBot's public /health (engine/watchdog state) with its
 * token-gated /account (live Alpaca equity/cash) into one summary. /health
 * alone never includes equity — that only exists on the broker side, which
 * is why this needs DOERBOT_CONTROL_TOKEN at all for an otherwise
 * "read-only" view.
 */
export async function getDoerBotSummary() {
  if (!doerbotConfigured()) {
    throw new Error("DOERBOT_STATUS_URL / DOERBOT_CONTROL_TOKEN are not configured.");
  }

  const [health, account] = await Promise.all([
    getJson("/health"),
    getJson("/account", { headers: { "X-Control-Token": DOERBOT_CONTROL_TOKEN } }),
  ]);

  const equity = Number(account.equity);
  const lastEquity = Number(account.last_equity);
  const cash = Number(account.cash);
  const hasEquity = Number.isFinite(equity);
  const dayChange = hasEquity && Number.isFinite(lastEquity) ? equity - lastEquity : null;
  const dayChangePct = dayChange != null && lastEquity ? dayChange / lastEquity : null;

  return {
    paper: !!health.paper,
    running: !!health.running,
    killed: !!health.killed,
    unprotected: !!health.unprotected,
    watchdogHealthy: health.watchdog ? !!health.watchdog.healthy : null,
    openPositions: Number(health.openPositions) || 0,
    equity: hasEquity ? equity : null,
    cash: Number.isFinite(cash) ? cash : null,
    dayChange,
    dayChangePct,
    updatedAt: new Date().toISOString(),
  };
}
