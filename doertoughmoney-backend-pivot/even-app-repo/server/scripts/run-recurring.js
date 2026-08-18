// Force the recurring-expense materializer to run now, instead of waiting for
// the 06:00 cron. Also the way to verify idempotency: run it twice and the
// second pass should skip everything it already created.
//
// Needs database access — Railway's injected DATABASE_URL uses the private
// hostname, so either `railway ssh -- node server/scripts/run-recurring.js`, or
// enable the Postgres public TCP proxy and pass PUBLIC_DATABASE_URL.
import { materializeRecurring } from "../groupsdb.js";

const result = await materializeRecurring(new Date(process.argv[2] ?? Date.now()));
console.log(`created ${result.created}, skipped ${result.skipped} already-recorded`);
process.exit(0);
