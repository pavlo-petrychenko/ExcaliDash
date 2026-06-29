import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFileRoutes } from "./files";

const s3Mocks = vi.hoisted(() => ({
  isS3Enabled: vi.fn(),
  generatePresignedDownloadUrl: vi.fn(),
}));

vi.mock("../s3", () => s3Mocks);

describe("file routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    s3Mocks.isS3Enabled.mockReturnValue(true);
    s3Mocks.generatePresignedDownloadUrl.mockResolvedValue(
      "https://signed.example/file",
    );
  });

  it("allows private S3 redirects for users with collection share access", async () => {
    const prisma = {
      drawing: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce({
            userId: "owner-user",
          })
          .mockResolvedValueOnce({
            collectionId: "shared-collection",
            userId: "owner-user",
          }),
      },
      drawingPermission: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      collection: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      collectionShare: {
        findFirst: vi.fn().mockResolvedValue({ role: "view" }),
      },
      drawingLinkShare: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      s3File: {
        findUnique: vi.fn().mockResolvedValue({
          s3Key: "excalidash/owner-user/drawing-1/file-1.png",
        }),
      },
    };
    const app = express();
    registerFileRoutes(app, {
      prisma: prisma as any,
      requireAuth: (_req, _res, next) => next(),
      optionalAuth: (req, _res, next) => {
        req.user = {
          id: "viewer-user",
          email: "viewer@test.local",
          name: "Viewer",
          role: "USER",
        };
        next();
      },
      asyncHandler: (fn) => (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
      },
    });

    const response = await request(app).get("/files/drawing-1/file-1");

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("https://signed.example/file");
    expect(prisma.collectionShare.findFirst).toHaveBeenCalledWith({
      where: {
        collectionId: "shared-collection",
        granteeUserId: "viewer-user",
      },
      select: { role: true },
    });
  });
});
