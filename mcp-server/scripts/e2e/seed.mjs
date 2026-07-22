/**
 * Seeds a fresh backend SQLite database directly through its own generated
 * Prisma client (`backend/src/generated/client`, plain JS output of
 * `prisma generate` — requirable with no ts-node/tsc step, same trick as
 * `backend/scripts/admin-recover.cjs`) so the e2e harness never has to drive
 * the browser-facing register/login/onboarding flow just to get a real,
 * scope-checked API key.
 *
 * The token/hash format below is a deliberate, minimal re-implementation of
 * `backend/src/auth/apiKeys.ts` (`generateApiKey`/`hashApiKey`) — that module
 * is pure Node `crypto` with no other backend dependency, so duplicating it
 * here (rather than reaching for ts-node) keeps this harness a plain ESM
 * script. Keep this in sync if `apiKeys.ts`'s scrypt parameters ever change.
 *
 * `authEnabled:true` is essential: with it left at the local-dev default
 * (`false`), `requireAuth` bypasses ALL authentication (bootstrap user) and
 * every request would succeed regardless of the API key or its scopes —
 * silently defeating the read-only-key 403 check T9 requires (plan §3.2).
 */
import { createRequire } from "node:module";
import crypto from "node:crypto";
import path from "node:path";
import { BACKEND_DIR } from "./paths.mjs";

const API_KEY_PREFIX = "exd_";
const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTIONS = { N: 1 << 14, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

function hashApiKey(token, pepper) {
  return crypto.scryptSync(token, pepper, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString("hex");
}

function generateApiKey(pepper) {
  const keyId = crypto.randomBytes(12).toString("base64url");
  const secret = crypto.randomBytes(32).toString("base64url");
  const token = `${API_KEY_PREFIX}${keyId}_${secret}`;
  return { token, keyId, prefix: token.slice(0, 16), tokenHash: hashApiKey(token, pepper) };
}

/**
 * Runs migrations-aware seeding against `databaseUrl` and returns two live API
 * key tokens for the SAME user: `fullToken` (default scopes) and
 * `readOnlyToken` (`drawings:read` only, for the negative-scope check).
 */
export async function seedBackend(databaseUrl, apiKeyHashPepper) {
  const require = createRequire(path.join(BACKEND_DIR, "package.json"));
  const { PrismaClient } = require(path.join(BACKEND_DIR, "src/generated/client"));

  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const prisma = new PrismaClient();
  try {
    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true, registrationEnabled: false },
      create: { id: "default", authEnabled: true, registrationEnabled: false },
    });

    const user = await prisma.user.create({
      data: {
        email: `mcp-e2e-${Date.now()}@test.local`,
        passwordHash: "unused-e2e-fixture",
        name: "MCP E2E fixture",
        role: "USER",
        isActive: true,
      },
      select: { id: true },
    });

    const full = generateApiKey(apiKeyHashPepper);
    await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: "e2e full-scope",
        keyId: full.keyId,
        tokenHash: full.tokenHash,
        prefix: full.prefix,
        scopes: "drawings:read,drawings:write,collections:read,collections:write",
      },
    });

    const readOnly = generateApiKey(apiKeyHashPepper);
    await prisma.apiKey.create({
      data: {
        userId: user.id,
        name: "e2e read-only",
        keyId: readOnly.keyId,
        tokenHash: readOnly.tokenHash,
        prefix: readOnly.prefix,
        scopes: "drawings:read",
      },
    });

    return { fullToken: full.token, readOnlyToken: readOnly.token, userId: user.id };
  } finally {
    await prisma.$disconnect().catch(() => {});
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
}
