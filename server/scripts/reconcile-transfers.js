// One-off reconcile: pull each non-terminal transfer's real status from Dwolla
// and apply it to our ledger (covers missed/misrouted webhooks). The server
// also does this hourly on its own — this is for forcing it on demand.
//
// Needs a reachable database. Railway's injected DATABASE_URL uses the PRIVATE
// hostname, which only resolves inside Railway, so `railway run` from a laptop
// won't connect. Use either:
//   • railway ssh -- node server/scripts/reconcile-transfers.js
//   • enable the Postgres public TCP proxy and pass PUBLIC_DATABASE_URL
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
