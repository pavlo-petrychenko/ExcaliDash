import express from "express";
import { DashboardRouteDeps } from "./types";
import {
  buildS3Key,
  copyS3Object,
  deleteS3Object,
  drawingS3Prefix,
  getPublicUrl,
  getS3Config,
  isS3Enabled,
  listS3Objects,
} from "../../s3";
import { type DrawingPrincipal } from "../../authz/sharing";

export type DrawingRouteContext = DashboardRouteDeps & {
  getRequestPrincipal: (req: express.Request) => Promise<DrawingPrincipal | null>;
  resolveDefaultTtlMs: (permission: "view" | "edit") => number;
  resolveMaxTtlMs: () => number;
  respondWithAuthErrorIfPresent: (
    req: express.Request,
    res: express.Response,
  ) => boolean;
  cleanupS3FilesForDrawing: (drawingId: string, userId: string) => Promise<void>;
  cloneS3FileReferences: (
    sourceDrawingId: string,
    targetDrawingId: string,
    userId: string,
    files: Record<string, any>,
  ) => Promise<Record<string, any>>;
};

export const createDrawingRouteContext = (
  deps: DashboardRouteDeps,
): DrawingRouteContext => {
  const { prisma } = deps;

  const getRequestPrincipal = async (
    req: express.Request,
  ): Promise<DrawingPrincipal | null> => {
    if (req.user?.id) return { kind: "user", userId: req.user.id };
    return null;
  };

  const resolveDefaultTtlMs = (permission: "view" | "edit"): number => {
    const raw =
      permission === "edit"
        ? process.env.LINK_SHARE_EDIT_DEFAULT_TTL_MS
        : process.env.LINK_SHARE_VIEW_DEFAULT_TTL_MS;
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return permission === "edit"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
  };

  const resolveMaxTtlMs = (): number => {
    const parsed = Number(process.env.LINK_SHARE_MAX_TTL_MS);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return 90 * 24 * 60 * 60 * 1000;
  };

  const respondWithAuthErrorIfPresent = (
    req: express.Request,
    res: express.Response,
  ): boolean => {
    if (!req.authError) return false;
    res.status(401).json({
      error: "Unauthorized",
      message: "Invalid or expired token",
    });
    return true;
  };

  const cleanupS3FilesForDrawing = async (
    drawingId: string,
    userId: string,
  ): Promise<void> => {
    if (!isS3Enabled()) return;

    const [objects, records] = await Promise.all([
      listS3Objects(drawingS3Prefix(userId, drawingId)),
      prisma.s3File.findMany({ where: { drawingId, userId } }),
    ]);
    const keys = new Set<string>(objects.map((object) => object.key));
    for (const record of records) keys.add(record.s3Key);

    await Promise.allSettled([...keys].map((key) => deleteS3Object(key)));
    await prisma.s3File.deleteMany({ where: { drawingId, userId } });
  };

  const cloneS3FileReferences = async (
    sourceDrawingId: string,
    targetDrawingId: string,
    userId: string,
    files: Record<string, any>,
  ): Promise<Record<string, any>> => {
    if (!isS3Enabled()) return files;

    const records = await prisma.s3File.findMany({
      where: { drawingId: sourceDrawingId, userId },
    });
    if (records.length === 0) return files;

    const clonedFiles: Record<string, any> = { ...files };
    const cfg = getS3Config();
    await Promise.all(
      records.map(async (record) => {
        const extension = record.s3Key.includes(".")
          ? record.s3Key.substring(record.s3Key.lastIndexOf(".") + 1)
          : "bin";
        const targetKey = buildS3Key(userId, targetDrawingId, record.fileId, extension);
        await copyS3Object(record.s3Key, targetKey, record.mimeType);
        await prisma.s3File.upsert({
          where: { drawingId_fileId: { drawingId: targetDrawingId, fileId: record.fileId } },
          create: {
            drawingId: targetDrawingId,
            fileId: record.fileId,
            userId,
            s3Key: targetKey,
            mimeType: record.mimeType,
          },
          update: { s3Key: targetKey, mimeType: record.mimeType },
        });
        if (clonedFiles[record.fileId]) {
          clonedFiles[record.fileId] = {
            ...clonedFiles[record.fileId],
            dataURL: cfg?.publicUrl
              ? getPublicUrl(targetKey)
              : `/api/files/${targetDrawingId}/${record.fileId}`,
          };
        }
      }),
    );

    return clonedFiles;
  };

  return {
    ...deps,
    getRequestPrincipal,
    resolveDefaultTtlMs,
    resolveMaxTtlMs,
    respondWithAuthErrorIfPresent,
    cleanupS3FilesForDrawing,
    cloneS3FileReferences,
  };
};
