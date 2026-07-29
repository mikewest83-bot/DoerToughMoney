// Internal dispute administration. There's no admin UI yet, so disputes are
// worked from the command line. Run with the app's env vars:
//   railway run --service even-app -- node scripts/disputes-admin.js list
//   railway run --service even-app -- node scripts/disputes-admin.js investigate <id>
//   railway run --service even-app -- node scripts/disputes-admin.js credit <id>
//   railway run --service even-app -- node scripts/disputes-admin.js resolve <id> upheld  "notes…"
//   railway run --service even-app -- node scripts/disputes-admin.js resolve <id> denied  "notes…"
//   railway run --service even-app -- node scripts/disputes-admin.js sweep
//
// PUBLIC_DATABASE_URL overrides DATABASE_URL for runs outside Railway's
// private network (the injected DATABASE_URL uses the internal hostname).
import { PrismaClient } from "@prisma/client";
import {
  startInvestigation, issueProvisionalCredit, resolveDispute,
  checkDisputeDeadlines, makeCreditFlows,
} from "../dwolla/index.js";

const url = process.env.PUBLIC_DATABASE_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const [cmd, id, ...rest] = process.argv.slice(2);

const flows = () => {
  if (!process.env.PLATFORM_BALANCE_FS_URL)
    throw new Error("PLATFORM_BALANCE_FS_URL must be set to move provisional-credit money.");
  return makeCreditFlows({ prisma, platformBalanceFundingSourceUrl: process.env.PLATFORM_BALANCE_FS_URL });
};

const show = (d) =>
  console.log(
    `${d.id}  ${d.status.padEnd(26)} $${(d.amountCents / 100).toFixed(2).padStart(8)}  ` +
    `filed ${d.filedAt.toISOString().slice(0, 10)}  due ${d.investigationDueAt.toISOString().slice(0, 10)}  ${d.reason}`
  );

switch (cmd) {
  case "list": {
    const open = await prisma.dispute.findMany({ orderBy: { filedAt: "desc" }, take: 100 });
    console.log(`${open.length} dispute(s)`);
    open.forEach(show);
    break;
  }
  case "investigate": {
    show(await startInvestigation(prisma, id));
    break;
  }
  case "credit": {
    // Moves real money: platform balance -> the disputing user's bank.
    show(await issueProvisionalCredit(prisma, id, { creditUser: flows().creditUser }));
    break;
  }
  case "resolve": {
    const verdict = rest[0];
    if (verdict !== "upheld" && verdict !== "denied") {
      console.error('Second argument must be "upheld" or "denied".');
      process.exit(1);
    }
    // A denial that reverses provisional credit requires advance consumer
    // notice before the debit — reverseProvisionalCredit is deliberately NOT
    // wired here so the debit can't fire without that notice being sent.
    show(await resolveDispute(prisma, id, { upheld: verdict === "upheld", note: rest.slice(1).join(" ") || null }));
    if (verdict === "denied") {
      console.warn("\nNOTE: if provisional credit was issued, send the required consumer notice, wait out the notice window, then reverse the credit manually.");
    }
    break;
  }
  case "sweep": {
    const res = await checkDisputeDeadlines(prisma, {
      onProvisionalCreditDue: async (d) => console.log(`NEEDS PROVISIONAL CREDIT: ${d.id}`),
      onFinalOverdue: async (d) => console.log(`PAST 45-DAY DEADLINE: ${d.id}`),
    });
    console.log(res);
    break;
  }
  default:
    console.error("Usage: disputes-admin.js <list|investigate|credit|resolve|sweep> [id] [args]");
    process.exit(1);
}

await prisma.$disconnect();
