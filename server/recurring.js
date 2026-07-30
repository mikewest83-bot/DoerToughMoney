// Daily job that turns recurring schedules (rent on the 1st, Netflix monthly)
// into real expenses, so nobody re-enters them.
//
// Safe to run repeatedly: materializeRecurring keys each generated expense on
// (recurringExpenseId, period) under a unique constraint, so a double run
// records nothing twice. Assumes a single instance, like the other crons —
// scaling out needs a worker or a lock.
import cron from "node-cron";
import { materializeRecurring } from "./groupsdb.js";

/** Default 06:00 daily — before anyone's likely to look at the app. */
export function startRecurringExpenseCron(schedule = "0 6 * * *") {
  return cron.schedule(schedule, async () => {
    try {
      const { created, skipped } = await materializeRecurring();
      if (created || skipped) console.log(`[recurring] created ${created}, skipped ${skipped} already-recorded`);
    } catch (err) {
      console.error("[recurring] materialize failed:", err);
    }
  });
}

export { materializeRecurring };
