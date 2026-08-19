import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ── users ────────────────────────────────────────────────
// password_hash is null for a Google-only account; googleId is set only when
// the account was created via, or has since been linked to, Google sign-in.
export const createUser = ({ name, handle, email, password_hash = null, googleId = null }) =>
  prisma.user.create({ data: { name, handle, email, passwordHash: password_hash, googleId } });

export const getUserById = (id) => prisma.user.findUnique({ where: { id } });
export const getUserByEmail = (email) => prisma.user.findUnique({ where: { email } });
export const getUserByHandle = (handle) => prisma.user.findUnique({ where: { handle } });
export const getUserByGoogleId = (googleId) => prisma.user.findUnique({ where: { googleId } });

// Link an existing password account to Google after verifying they share the
// same (Google-verified) email — lets someone who registered with a password
// start using "Sign in with Google" without creating a second account.
export const linkGoogleId = (userId, googleId) =>
  prisma.user.update({ where: { id: userId }, data: { googleId } });

export const searchUsers = (q, excludeId) =>
  prisma.user.findMany({
    where: {
      id: { not: excludeId },
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { handle: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, handle: true },
    orderBy: { name: "asc" },
    take: 25,
  });

export default prisma;
