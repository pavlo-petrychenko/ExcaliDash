import express from "express";
import {
  buildShareLinkToken,
  hashShareLinkToken,
  normalizeDrawingPermission,
} from "../../authz/sharing";
import type { DrawingRouteContext } from "./drawingRouteContext";

export const registerDrawingSharingRoutes = (
  app: express.Express,
  context: DrawingRouteContext,
) => {
  const {
    prisma,
    requireAuth,
    asyncHandler,
    invalidateDrawingsCache,
    config,
    logAuditEvent,
    resolveDefaultTtlMs,
    resolveMaxTtlMs,
  } = context;
  // Owner-only: resolve users by name/email in the context of a drawing you own (reduces enumeration risk).
  app.get(
    "/drawings/:id/share-resolve",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { id } = req.params;
      const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const q = qRaw.toLowerCase();
      if (q.length < 3) return res.json({ users: [] });

      const drawing = await prisma.drawing.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!drawing || drawing.userId !== req.user.id) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      const users = await prisma.user.findMany({
        where: {
          isActive: true,
          id: { not: req.user.id },
          OR: [
            { email: { contains: q } },
            { name: { contains: q } },
            { username: { contains: q } },
          ],
        },
        select: { id: true, name: true, email: true },
        take: 10,
      });

      return res.json({ users });
    }),
  );

  app.get(
    "/drawings/:id/sharing",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;

      const drawing = await prisma.drawing.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!drawing || drawing.userId !== req.user.id) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      const [permissions, linkShares] = await Promise.all([
        prisma.drawingPermission.findMany({
          where: { drawingId: id },
          select: {
            id: true,
            granteeUserId: true,
            permission: true,
            createdAt: true,
            updatedAt: true,
            granteeUser: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.drawingLinkShare.findMany({
          where: { drawingId: id },
          select: {
            id: true,
            permission: true,
            expiresAt: true,
            revokedAt: true,
            createdAt: true,
            updatedAt: true,
            lastUsedAt: true,
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);

      return res.json({ permissions, linkShares });
    }),
  );

  app.post(
    "/drawings/:id/permissions",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;

      const drawing = await prisma.drawing.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!drawing || drawing.userId !== req.user.id) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      const granteeUserId =
        typeof req.body?.granteeUserId === "string"
          ? req.body.granteeUserId
          : null;
      const permission = normalizeDrawingPermission(req.body?.permission);
      if (!granteeUserId || !permission) {
        return res.status(400).json({
          error: "Validation error",
          message: "Invalid grantee or permission",
        });
      }
      if (granteeUserId === req.user.id) {
        return res.status(400).json({
          error: "Validation error",
          message: "Cannot share with yourself",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: granteeUserId },
        select: { id: true, isActive: true },
      });
      if (!user || !user.isActive) {
        return res.status(404).json({ error: "User not found" });
      }

      const saved = await prisma.drawingPermission.upsert({
        where: {
          drawingId_granteeUserId: { drawingId: id, granteeUserId },
        },
        update: { permission, createdByUserId: req.user.id },
        create: {
          drawingId: id,
          granteeUserId,
          permission,
          createdByUserId: req.user.id,
        },
        select: {
          id: true,
          granteeUserId: true,
          permission: true,
          createdAt: true,
          updatedAt: true,
          granteeUser: { select: { id: true, name: true, email: true } },
        },
      });

      invalidateDrawingsCache();

      if (config.enableAuditLogging) {
        await logAuditEvent({
          userId: req.user.id,
          action: "drawing_shared_user_upsert",
          resource: `drawing:${id}`,
          ipAddress: req.ip || req.connection.remoteAddress || undefined,
          userAgent: req.headers["user-agent"] || undefined,
          details: { drawingId: id, granteeUserId, permission },
        });
      }

      return res.json({ permission: saved });
    }),
  );

  app.delete(
    "/drawings/:id/permissions/:permId",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id, permId } = req.params;

      const drawing = await prisma.drawing.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!drawing || drawing.userId !== req.user.id) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      await prisma.drawingPermission.deleteMany({
        where: { id: permId, drawingId: id },
      });
      invalidateDrawingsCache();

      if (config.enableAuditLogging) {
        await logAuditEvent({
          userId: req.user.id,
          action: "drawing_shared_user_revoke",
          resource: `drawing:${id}`,
          ipAddress: req.ip || req.connection.remoteAddress || undefined,
          userAgent: req.headers["user-agent"] || undefined,
          details: { drawingId: id, permissionId: permId },
        });
      }

      return res.json({ success: true });
    }),
  );

  app.post(
    "/drawings/:id/link-shares",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id } = req.params;

      const drawing = await prisma.drawing.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!drawing || drawing.userId !== req.user.id) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      const permission = normalizeDrawingPermission(req.body?.permission);
      if (!permission) {
        return res
          .status(400)
          .json({ error: "Validation error", message: "Invalid permission" });
      }

      const rawExpiresAt =
        typeof req.body?.expiresAt === "string" ? req.body.expiresAt : null;
      const expiresAtText = (rawExpiresAt || "").trim();
      const requestedExpiresAt =
        expiresAtText.length > 0 ? new Date(expiresAtText) : null;
      const hasValidRequestedExpiry = Boolean(
        requestedExpiresAt && Number.isFinite(requestedExpiresAt.getTime()),
      );

      const now = Date.now();
      const maxTtlMs = resolveMaxTtlMs();
      const defaultTtlMs = resolveDefaultTtlMs(permission);

      let expiresAt: Date | null = null;
      // View links can be truly non-expiring unless an explicit expiry is provided.
      // Edit links default to an expiry window when none is provided.
      if (
        permission === "view" &&
        !hasValidRequestedExpiry &&
        expiresAtText.length === 0
      ) {
        expiresAt = null;
      } else {
        const candidateTtlMs =
          hasValidRequestedExpiry && requestedExpiresAt
            ? requestedExpiresAt.getTime() - now
            : defaultTtlMs;
        const ttlMs = Math.min(Math.max(candidateTtlMs, 60_000), maxTtlMs);
        expiresAt = new Date(now + ttlMs);
      }

      // Passphrase support is currently disabled. We keep passphraseHash nullable for backwards compatibility.
      const passphraseHashValue: string | null = null;

      // Enforce a single active "anyone with the link" policy per drawing. The public link is the drawing id,
      // so multiple active link-share rows would be confusing and could unintentionally widen access.
      await prisma.drawingLinkShare.updateMany({
        where: { drawingId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // Token is generated only to satisfy the current schema's tokenHash requirement.
      // Link access is based on drawing id + active policy (no secret token in the URL).
      const tokenHash = hashShareLinkToken(buildShareLinkToken());

      const created = await prisma.drawingLinkShare.create({
        data: {
          drawingId: id,
          permission,
          tokenHash,
          passphraseHash: passphraseHashValue,
          expiresAt,
          createdByUserId: req.user.id,
        },
        select: {
          id: true,
          permission: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
        },
      });

      if (config.enableAuditLogging) {
        await logAuditEvent({
          userId: req.user.id,
          action: "drawing_link_share_created",
          resource: `drawing:${id}`,
          ipAddress: req.ip || req.connection.remoteAddress || undefined,
          userAgent: req.headers["user-agent"] || undefined,
          details: {
            drawingId: id,
            permission,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
          },
        });
      }

      return res.json({ share: created });
    }),
  );

  app.delete(
    "/drawings/:id/link-shares/:shareId",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });
      const { id, shareId } = req.params;

      const drawing = await prisma.drawing.findUnique({
        where: { id },
        select: { userId: true },
      });
      if (!drawing || drawing.userId !== req.user.id) {
        return res.status(404).json({ error: "Drawing not found" });
      }

      await prisma.drawingLinkShare.updateMany({
        where: { id: shareId, drawingId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      if (config.enableAuditLogging) {
        await logAuditEvent({
          userId: req.user.id,
          action: "drawing_link_share_revoked",
          resource: `drawing:${id}`,
          ipAddress: req.ip || req.connection.remoteAddress || undefined,
          userAgent: req.headers["user-agent"] || undefined,
          details: { drawingId: id, shareId },
        });
      }

      return res.json({ success: true });
    }),
  );

  // Legacy share-token exchange endpoint removed: link access is based on drawing id + active policy.
};
