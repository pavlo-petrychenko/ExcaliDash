import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../config";
import { createAuthMiddleware } from "./auth";
import { BOOTSTRAP_USER_ID } from "../auth/authMode";
import { generateApiKey, serializeApiKeyScopes } from "../auth/apiKeys";

const createRequest = (overrides?: Partial<Request>): Request =>
  ({
    method: "GET",
    originalUrl: "/drawings",
    url: "/drawings",
    headers: {},
    ...overrides,
  }) as Request;

const createResponse = (): Response =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  }) as unknown as Response;

const createDeps = () => {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    authIdentity: {
      findUnique: vi.fn(),
    },
    apiKey: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  } as any;

  const authModeService = {
    getAuthEnabled: vi.fn(),
    getBootstrapActingUser: vi.fn(),
  } as any;

  return { prisma, authModeService };
};

const makeAccessToken = (payload?: {
  userId?: string;
  email?: string;
  impersonatorId?: string;
}) =>
  jwt.sign(
    {
      userId: payload?.userId ?? "user-1",
      email: payload?.email ?? "user-1@test.local",
      type: "access",
      impersonatorId: payload?.impersonatorId,
    },
    config.jwtSecret,
  );

const makeOidcAccessToken = (payload?: {
  userId?: string;
  email?: string;
  oidcGroups?: string[];
  authProvider?: "local" | "oidc";
}) =>
  jwt.sign(
    {
      userId: payload?.userId ?? "user-1",
      email: payload?.email ?? "user-1@test.local",
      type: "access",
      authProvider: payload?.authProvider ?? "oidc",
      oidcGroups: payload?.oidcGroups ?? [],
    },
    config.jwtSecret,
  );

const makeRefreshToken = () =>
  jwt.sign(
    {
      userId: "user-1",
      email: "user-1@test.local",
      type: "refresh",
    },
    config.jwtSecret,
  );

describe("auth middleware", () => {
  const originalAdminGroups = [...config.oidc.adminGroups];

  beforeEach(() => {
    config.oidc.adminGroups = [];
  });

  afterEach(() => {
    config.oidc.adminGroups = [...originalAdminGroups];
  });

  it("treats requests as bootstrap user when auth is disabled", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(false);
    authModeService.getBootstrapActingUser.mockResolvedValue({
      id: BOOTSTRAP_USER_ID,
      username: null,
      email: "bootstrap@excalidash.local",
      name: "Bootstrap Admin",
      role: "ADMIN",
      mustResetPassword: true,
    });
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest();
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      id: BOOTSTRAP_USER_ID,
      role: "ADMIN",
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns 401 when token is missing and auth is enabled", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest();
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Authentication token required" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects non-access JWT payloads", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({
      headers: {
        authorization: `Bearer ${makeRefreshToken()}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid or expired token" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches active user for valid access token", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "user1",
      email: "user-1@test.local",
      name: "User One",
      role: "USER",
      mustResetPassword: false,
      isActive: true,
    });
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({
      headers: {
        authorization: `Bearer ${makeAccessToken({ impersonatorId: "admin-1" })}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      id: "user-1",
      email: "user-1@test.local",
      impersonatorId: "admin-1",
    });
  });

  it("attaches active user for valid API key", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({
      id: "user-1",
      email: "user-1@test.local",
      authCredentialType: "apiKey",
    });
    expect(req.principal).toEqual({ kind: "user", userId: "user-1" });
    expect(prisma.apiKey.update).toHaveBeenCalledWith({
      where: { id: "api-key-1" },
      data: { lastUsedAt: expect.any(Date) },
    });
  });

  it("allows valid API key auth when lastUsedAt update fails", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockRejectedValue(new Error("write failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({
      method: "GET",
      originalUrl: "/drawings",
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects API keys for routes outside drawings and collections", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(),
      revokedAt: null,
      user: {
        id: "admin-1",
        username: "admin",
        email: "admin@test.local",
        name: "Admin",
        role: "ADMIN",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({
      method: "GET",
      originalUrl: "/auth/api-keys",
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects API keys missing the required resource scope", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      scopes: serializeApiKeyScopes(["drawings:read"]),
      revokedAt: null,
      user: {
        id: "user-1",
        username: "user1",
        email: "user-1@test.local",
        name: "User One",
        role: "USER",
        mustResetPassword: false,
        isActive: true,
      },
    });
    prisma.apiKey.update.mockResolvedValue({});
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({
      method: "POST",
      originalUrl: "/drawings",
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects revoked API keys", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    const generated = generateApiKey();
    prisma.apiKey.findUnique.mockResolvedValue({
      id: "api-key-1",
      tokenHash: generated.tokenHash,
      revokedAt: new Date(),
      user: {
        isActive: true,
      },
    });
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({
      headers: {
        authorization: `Bearer ${generated.token}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Invalid or revoked API key" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("blocks non-auth routes when password reset is required", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "user1",
      email: "user-1@test.local",
      name: "User One",
      role: "USER",
      mustResetPassword: true,
      isActive: true,
    });
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({
      method: "GET",
      originalUrl: "/drawings",
      headers: {
        authorization: `Bearer ${makeAccessToken()}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "MUST_RESET_PASSWORD" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("allows /api/auth/me when password reset is required", async () => {
    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "user1",
      email: "user-1@test.local",
      name: "User One",
      role: "USER",
      mustResetPassword: true,
      isActive: true,
    });
    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });

    const req = createRequest({
      method: "GET",
      originalUrl: "/api/auth/me?include=roles",
      headers: {
        authorization: `Bearer ${makeAccessToken()}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("promotes OIDC user to ADMIN when token groups include configured admin group", async () => {
    config.oidc.adminGroups = ["excalidash-admins"];

    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "user1",
      email: "user-1@test.local",
      name: "User One",
      role: "USER",
      mustResetPassword: false,
      isActive: true,
    });
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      username: "user1",
      email: "user-1@test.local",
      name: "User One",
      role: "ADMIN",
      mustResetPassword: false,
      isActive: true,
    });

    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      headers: {
        authorization: `Bearer ${makeOidcAccessToken({ oidcGroups: ["excalidash-admins"] })}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { role: "ADMIN" },
      }),
    );
    expect(req.user?.role).toBe("ADMIN");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("demotes OIDC user to USER when configured admin group is missing", async () => {
    config.oidc.adminGroups = ["excalidash-admins"];

    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "user1",
      email: "user-1@test.local",
      name: "User One",
      role: "ADMIN",
      mustResetPassword: false,
      isActive: true,
    });
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      username: "user1",
      email: "user-1@test.local",
      name: "User One",
      role: "USER",
      mustResetPassword: false,
      isActive: true,
    });

    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      headers: {
        authorization: `Bearer ${makeOidcAccessToken({ oidcGroups: ["designers"] })}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { role: "USER" },
      }),
    );
    expect(req.user?.role).toBe("USER");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("demotes legacy OIDC session without claims when admin mapping is enabled", async () => {
    config.oidc.adminGroups = ["excalidash-admins"];

    const { prisma, authModeService } = createDeps();
    authModeService.getAuthEnabled.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "user1",
      email: "user-1@test.local",
      name: "User One",
      role: "ADMIN",
      mustResetPassword: false,
      isActive: true,
    });
    prisma.authIdentity.findUnique.mockResolvedValue({ id: "identity-1" });
    prisma.user.update.mockResolvedValue({
      id: "user-1",
      username: "user1",
      email: "user-1@test.local",
      name: "User One",
      role: "USER",
      mustResetPassword: false,
      isActive: true,
    });

    const { requireAuth } = createAuthMiddleware({ prisma, authModeService });
    const req = createRequest({
      headers: {
        authorization: `Bearer ${makeAccessToken()}`,
      },
    });
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    await requireAuth(req, res, next);

    expect(prisma.authIdentity.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_userId: {
            provider: "oidc",
            userId: "user-1",
          },
        },
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { role: "USER" },
      }),
    );
    expect(req.user?.role).toBe("USER");
    expect(next).toHaveBeenCalledTimes(1);
  });
});
