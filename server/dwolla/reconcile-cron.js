// dwolla/reconcile-cron.js
// Scheduled reconciliation: pull each open transfer's status from Dwolla and
// assert it matches even's ledger. Any mismatch is surfaced via onDrift so you
// can alert (PagerDuty/Slack/email) and investigate. Run it hourly to start.
import cron from "node-cron";
import { reconcile } from "./ledger.js";
import { getTransfer } from "./transfers.js";

/**
 * @param prisma            your Prisma client
 * @param opts.schedule     cron expression (default hourly on the hour)
 * @param opts.onDrift      async (drifts[]) => void — your alerting hook
 * @returns the node-cron task (call .stop() to cancel)
 */
export function startReconcileCron(prisma, { schedule = "0 * * * *", onDrift } = {}) {
  const task = cron.schedule(schedule, async () => {
    try {
      const drifts = await reconcile(prisma, getTransfer);
      if (drifts.length) {
        console.error(`[dwolla] reconciliation found ${drifts.length} drift(s):`, drifts);
        if (onDrift) await onDrift(drifts);
      } else {
        console.log("[dwolla] reconciliation clean");
      }
    } catch (err) {
      console.error("[dwolla] reconcile job failed:", err);
    }
  });
  return task;
}

// One-off run (e.g. for a manual check or a test):
export async function runReconcileOnce(prisma, onDrift) {
  const drifts = await reconcile(prisma, getTransfer);
  if (drifts.length && onDrift) await onDrift(drifts);
  return drifts;
}
