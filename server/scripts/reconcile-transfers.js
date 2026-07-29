// One-off reconcile: pull each non-terminal transfer's real status from Dwolla
// and apply it to our ledger (covers missed/misrouted webhooks). Run with the
// app's env vars:
//   railway run --service even-app -- node scripts/reconcile-transfers.js
// PUBLIC_DATABASE_URL overrides DATABASE_URL when running outside Railway's
// private network (the injected DATABASE_URL points at the internal host).
import { PrismaClient } from "@prisma/client";
import { getTransfer, applyTransferStatus, mapDwollaStatus } from "../dwolla/index.js";

const url = process.env.PUBLIC_DATABASE_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const open = await prisma.transfer.findMany({ where: { status: "PENDING" } });
console.log(`${open.length} pending transfer(s)`);

for (const t of open) {
  const remote = await getTransfer(t.providerUrl);
  const mapped = mapDwollaStatus(remote.status);
  console.log(`${t.id}: ours=${t.status} dwolla=${remote.status}`);
  if (mapped && mapped !== t.status) {
    await applyTransferStatus(prisma, t.providerRef, mapped);
    console.log(`  -> updated to ${mapped}`);
  }
}

await prisma.$disconnect();
