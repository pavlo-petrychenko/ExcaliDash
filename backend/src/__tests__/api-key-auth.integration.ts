import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { PrismaClient } from "../generated/client";
import { generateApiKey, serializeApiKeyScopes } from "../auth/apiKeys";
import { getTestPrisma, setupTestDb } from "./testUtils";

describe("API key authentication", () => {
  let prisma: PrismaClient;
  let app: any;
  let userId: string;
  let apiKeyId: string;
  let apiKeyToken: string;
  let adminApiKeyToken: string;

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
    ({ app } = await import("../index"));

    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true, registrationEnabled: false },
      create: { id: "default", authEnabled: true, registrationEnabled: false },
    });

    const passwordHash = await bcrypt.hash("password123", 10);
    const user = await prisma.user.create({
      data: {
        email: "api-key-user@test.local",
        passwordHash,
        name: "API Key User",
        role: "USER",
        isActive: true,
      },
      select: { id: true },
    });
    userId = user.id;

    const generated = generateApiKey();
    apiKeyToken = generated.token;
    const apiKey = await prisma.apiKey.create({
      data: {
        userId,
        name: "Obsidian automation",
        keyId: generated.keyId,
        tokenHash: generated.tokenHash,
        prefix: generated.prefix,
        scopes: serializeApiKeyScopes(),
      },
      select: { id: true },
    });
    apiKeyId = apiKey.id;

    const adminUser = await prisma.user.create({
      data: {
        email: "api-key-admin@test.local",
        passwordHash,
        name: "API Key Admin",
        role: "ADMIN",
        isActive: true,
      },
      select: { id: true },
    });
    const adminGenerated = generateApiKey();
    adminApiKeyToken = adminGenerated.token;
    await prisma.apiKey.create({
      data: {
        userId: adminUser.id,
        name: "Admin automation",
        keyId: adminGenerated.keyId,
        tokenHash: adminGenerated.tokenHash,
        prefix: adminGenerated.prefix,
        scopes: serializeApiKeyScopes(),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts API key bearer auth for write API requests without CSRF", async () => {
    const response = await request(app)
      .post("/collections")
      .set("Authorization", `Bearer ${apiKeyToken}`)
      .send({ name: "Automation" });

    expect(response.status).toBe(200);
    expect(response.body?.name).toBe("Automation");
    expect(response.body?.userId).toBe(userId);

    const stored = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });
    expect(stored?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("accepts API key bearer auth for allowed read routes", async () => {
    const collectionsResponse = await request(app)
      .get("/collections")
      .set("Authorization", `Bearer ${apiKeyToken}`);
    const drawingsResponse = await request(app)
      .get("/drawings")
      .set("Authorization", `Bearer ${apiKeyToken}`);

    expect(collectionsResponse.status).toBe(200);
    expect(drawingsResponse.status).toBe(200);
  });

  it("rejects API key management with API key auth", async () => {
    const response = await request(app)
      .get("/auth/api-keys")
      .set("Authorization", `Bearer ${apiKeyToken}`);

    expect(response.status).toBe(403);
  });

  it("rejects admin actions with admin-owned API key auth", async () => {
    const response = await request(app)
      .get("/auth/users")
      .set("Authorization", `Bearer ${adminApiKeyToken}`)
      .send();

    expect(response.status).toBe(403);
  });

  it("stores only hashed API keys and metadata", async () => {
    const stored = await prisma.apiKey.findUnique({ where: { id: apiKeyId } });

    expect(stored?.tokenHash).toBeTruthy();
    expect(stored?.tokenHash).not.toBe(apiKeyToken);
    expect(stored?.keyId).not.toBe(apiKeyToken);
    expect(stored?.prefix).toBe(apiKeyToken.slice(0, 16));
  });

  it("rejects invalid API keys", async () => {
    const response = await request(app)
      .post("/collections")
      .set("Authorization", "Bearer exd_invalid_invalid")
      .send({ name: "Invalid" });

    expect(response.status).toBe(401);
  });

  it("rejects revoked API keys", async () => {
    await prisma.apiKey.update({
      where: { id: apiKeyId },
      data: { revokedAt: new Date() },
    });

    const response = await request(app)
      .post("/collections")
      .set("Authorization", `Bearer ${apiKeyToken}`)
      .send({ name: "Revoked" });

    expect(response.status).toBe(401);
  });
});
