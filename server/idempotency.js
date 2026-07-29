import prisma from "./db.js";
import { idempotencyDecision } from "./logic.js";

/**
 * Idempotency for mutating money routes.
 * The response is persisted before it is sent, so a successful request cannot
 * leave the key permanently stuck as "in progress" merely because the process
 * exits immediately after responding.
 */
export async function idempotency(req, res, next) {
  const key = req.headers["idempotency-key"];
  if (!key) return next();
  if (typeof key !== "string" || key.length > 200)
    return res.status(400).json({ error: "Invalid Idempotency-Key." });

  const userId = req.user.id;
  const where = { userId_key: { userId, key } };

  const existing = await prisma.idempotencyKey.findUnique({ where });
  const decision = idempotencyDecision(existing);
  if (decision.action !== "proceed")
    return res.status(decision.status).json(decision.body);

  try {
    await prisma.idempotencyKey.create({ data: { key, userId, status: 0, response: {} } });
  } catch {
    return res.status(409).json({ error: "That request is already being processed." });
  }

  const originalJson = res.json.bind(res);
  let sent = false;
  res.json = (body) => {
    if (sent) return res;
    sent = true;
    const status = res.statusCode || 200;
    prisma.idempotencyKey
      .update({ where, data: { status, response: body ?? {} } })
      .then(() => originalJson(body))
      .catch(() => originalJson(body));
    return res;
  };

  next();
}
