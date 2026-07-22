import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { PrismaClient } from "../generated/client";
import { generateApiKey, serializeApiKeyScopes } from "../auth/apiKeys";
import { getTestPrisma, setupTestDb, createTestDrawingPayload } from "./testUtils";

type ApiKeyFixture = {
  id: string;
  token: string;
};

async function createApiKeyFixture(
  prisma: PrismaClient,
  userId: string,
  name: string,
  scopes?: readonly string[],
): Promise<ApiKeyFixture> {
  const generated = generateApiKey();
  const apiKey = await prisma.apiKey.create({
    data: {
      userId,
      name,
      keyId: generated.keyId,
      tokenHash: generated.tokenHash,
      prefix: generated.prefix,
      scopes: serializeApiKeyScopes(scopes),
    },
    select: { id: true },
  });

  return { id: apiKey.id, token: generated.token };
}

async function createDrawingFixture(app: any, token: string, name: string): Promise<string> {
  const response = await request(app)
    .post("/drawings")
    .set("Authorization", `Bearer ${token}`)
    .send(createTestDrawingPayload({ name }));
  expect(response.status).toBe(200);
  return response.body.id as string;
}

describe("API key authentication", () => {
  let prisma: PrismaClient;
  let app: any;
  let userId: string;
  let apiKeyId: string;
  let apiKeyToken: string;
  let adminApiKeyToken: string;
  let readOnlyApiKeyToken: string;
  // Separate from `apiKeyToken`: the "rejects revoked API keys" test
  // permanently revokes `apiKeyToken`, so the new-route tests below use
  // their own never-revoked key to avoid depending on test execution order.
  let fullScopeApiKeyToken: string;

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

    const apiKeyFixture = await createApiKeyFixture(prisma, userId, "Obsidian automation");
    apiKeyToken = apiKeyFixture.token;
    apiKeyId = apiKeyFixture.id;

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
    const adminApiKeyFixture = await createApiKeyFixture(prisma, adminUser.id, "Admin automation");
    adminApiKeyToken = adminApiKeyFixture.token;

    const readOnlyApiKeyFixture = await createApiKeyFixture(
      prisma,
      userId,
      "Read-only automation",
      ["drawings:read"],
    );
    readOnlyApiKeyToken = readOnlyApiKeyFixture.token;

    const fullScopeApiKeyFixture = await createApiKeyFixture(
      prisma,
      userId,
      "Full-scope automation",
    );
    fullScopeApiKeyToken = fullScopeApiKeyFixture.token;
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

  it("rejects API key access to drawing permission subroutes", async () => {
    const response = await request(app)
      .post("/drawings/drawing-1/permissions")
      .set("Authorization", `Bearer ${apiKeyToken}`)
      .send({ granteeUserId: "user-2", permission: "view" });

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

  it("allows API key to list drawings shared with the user", async () => {
    const response = await request(app)
      .get("/drawings/shared")
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`);

    expect(response.status).toBe(200);
  });

  it("allows API key to duplicate a drawing it owns", async () => {
    const drawingId = await createDrawingFixture(app, fullScopeApiKeyToken, "Duplicate me");

    const response = await request(app)
      .post(`/drawings/${drawingId}/duplicate`)
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`)
      .send();

    expect(response.status).toBe(200);
    expect(response.body?.id).not.toBe(drawingId);
    expect(response.body?.name).toBe("Duplicate me (Copy)");
  });

  it("allows API key to list history, read a snapshot, and restore it", async () => {
    const drawingId = await createDrawingFixture(app, fullScopeApiKeyToken, "History me");

    const updateResponse = await request(app)
      .put(`/drawings/${drawingId}`)
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`)
      .send({
        elements: [],
        appState: { viewBackgroundColor: "#ffffff", gridSize: null },
        version: 1,
      });
    expect(updateResponse.status).toBe(200);

    const historyResponse = await request(app)
      .get(`/drawings/${drawingId}/history`)
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`);
    expect(historyResponse.status).toBe(200);
    expect(historyResponse.body?.snapshots?.length).toBeGreaterThan(0);
    const snapshotId = historyResponse.body.snapshots[0].id as string;

    const snapshotResponse = await request(app)
      .get(`/drawings/${drawingId}/history/${snapshotId}`)
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`);
    expect(snapshotResponse.status).toBe(200);

    const restoreResponse = await request(app)
      .post(`/drawings/${drawingId}/history/${snapshotId}/restore`)
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`)
      .send();
    expect(restoreResponse.status).toBe(200);
  });

  it("still rejects API key access to sharing, permissions, link-shares, library, and export routes", async () => {
    const drawingId = await createDrawingFixture(app, fullScopeApiKeyToken, "Locked down");

    const shareResolve = await request(app)
      .get(`/drawings/${drawingId}/share-resolve`)
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`);
    expect(shareResolve.status).toBe(403);

    const permissions = await request(app)
      .post(`/drawings/${drawingId}/permissions`)
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`)
      .send({ granteeUserId: "user-2", permission: "view" });
    expect(permissions.status).toBe(403);

    const linkShares = await request(app)
      .post(`/drawings/${drawingId}/link-shares`)
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`)
      .send({});
    expect(linkShares.status).toBe(403);

    const library = await request(app)
      .get("/library")
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`);
    expect(library.status).toBe(403);

    const exportRoute = await request(app)
      .get("/export/excalidash")
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`);
    expect(exportRoute.status).toBe(403);

    const trim = await request(app)
      .post(`/drawings/${drawingId}/trim`)
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`)
      .send();
    expect(trim.status).toBe(403);
  });

  it("still rejects PUT and DELETE on /drawings/shared", async () => {
    // Only GET/HEAD /drawings/shared is scope-authorized. PUT/DELETE fall
    // through to the generic /drawings/:id handlers (id="shared"), which
    // are unauthorized for this key: PUT is `optionalAuth`-gated, so an
    // unauthorized key is treated as anonymous -> 401; DELETE is
    // `requireAuth`-gated, which rejects unauthorized scope directly -> 403.
    const putResponse = await request(app)
      .put("/drawings/shared")
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`)
      .send({});
    expect(putResponse.status).toBe(401);

    const deleteResponse = await request(app)
      .delete("/drawings/shared")
      .set("Authorization", `Bearer ${fullScopeApiKeyToken}`);
    expect(deleteResponse.status).toBe(403);
  });

  it("allows a drawings:read-only key to read shared/history but rejects duplicate/restore", async () => {
    const drawingId = await createDrawingFixture(app, fullScopeApiKeyToken, "Read-only target");

    const sharedResponse = await request(app)
      .get("/drawings/shared")
      .set("Authorization", `Bearer ${readOnlyApiKeyToken}`);
    expect(sharedResponse.status).toBe(200);

    const historyResponse = await request(app)
      .get(`/drawings/${drawingId}/history`)
      .set("Authorization", `Bearer ${readOnlyApiKeyToken}`);
    expect(historyResponse.status).toBe(200);

    const duplicateResponse = await request(app)
      .post(`/drawings/${drawingId}/duplicate`)
      .set("Authorization", `Bearer ${readOnlyApiKeyToken}`)
      .send();
    expect(duplicateResponse.status).toBe(403);

    // restore is registered behind `optionalAuth`; a key lacking the write
    // scope is treated as unauthenticated for this route (401), not 403 -
    // same behavior as any other insufficiently-scoped optionalAuth write.
    const restoreResponse = await request(app)
      .post(`/drawings/${drawingId}/history/nonexistent/restore`)
      .set("Authorization", `Bearer ${readOnlyApiKeyToken}`)
      .send();
    expect(restoreResponse.status).toBe(401);
  });
});
