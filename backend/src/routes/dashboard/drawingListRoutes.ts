import express from "express";
import { Prisma } from "../../generated/client";
import { normalizeDrawingPermission } from "../../authz/sharing";
import { getUserTrashCollectionId, toPublicTrashCollectionId } from "./trash";
import { SortDirection, SortField } from "./types";
import type { DrawingRouteContext } from "./drawingRouteContext";

export const registerDrawingListRoutes = (
  app: express.Express,
  context: DrawingRouteContext,
) => {
  const {
    prisma,
    requireAuth,
    asyncHandler,
    parseJsonField,
    buildDrawingsCacheKey,
    getCachedDrawingsBody,
    cacheDrawingsResponse,
    MAX_PAGE_SIZE,
  } = context;
  app.get(
    "/drawings",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const trashCollectionId = getUserTrashCollectionId(req.user.id);
      const {
        search,
        collectionId,
        includeData,
        includePreview,
        limit,
        offset,
        sortField,
        sortDirection,
      } = req.query;
      const where: Prisma.DrawingWhereInput = { userId: req.user.id };
      const searchTerm =
        typeof search === "string" && search.trim().length > 0
          ? search.trim()
          : undefined;

      if (searchTerm) {
        where.name = { contains: searchTerm };
      }

      let collectionFilterKey = "default";
      if (collectionId === "null") {
        where.collectionId = null;
        collectionFilterKey = "null";
      } else if (collectionId) {
        const normalizedCollectionId = String(collectionId);
        if (normalizedCollectionId === "trash") {
          where.collectionId = { in: [trashCollectionId, "trash"] };
          collectionFilterKey = "trash";
        } else {
          const collection = await prisma.collection.findFirst({
            where: { id: normalizedCollectionId },
          });
          if (!collection) {
            return res.status(404).json({ error: "Collection not found" });
          }

          // Check if user is owner or has a share entry
          const isOwner = collection.userId === req.user.id;
          if (!isOwner) {
            const share = await prisma.collectionShare.findFirst({
              where: {
                collectionId: normalizedCollectionId,
                granteeUserId: req.user.id,
              },
            });
            if (!share) {
              return res.status(404).json({ error: "Collection not found" });
            }
          }
          // Always fetch all drawings in the collection regardless of who created them
          delete (where as any).userId;

          where.collectionId = normalizedCollectionId;
          collectionFilterKey = `id:${normalizedCollectionId}`;
        }
      } else {
        where.OR = [
          { collectionId: { notIn: [trashCollectionId, "trash"] } },
          { collectionId: null },
        ];
      }

      const shouldIncludeData =
        typeof includeData === "string"
          ? includeData.toLowerCase() === "true" || includeData === "1"
          : false;
      const shouldIncludePreview =
        typeof includePreview === "string"
          ? includePreview.toLowerCase() === "true" || includePreview === "1"
          : false;
      const parsedSortField: SortField =
        sortField === "name" ||
        sortField === "createdAt" ||
        sortField === "updatedAt"
          ? sortField
          : "updatedAt";
      const parsedSortDirection: SortDirection =
        sortDirection === "asc" || sortDirection === "desc"
          ? sortDirection
          : parsedSortField === "name"
            ? "asc"
            : "desc";

      const rawLimit = limit ? Number.parseInt(limit as string, 10) : undefined;
      const rawOffset = offset
        ? Number.parseInt(offset as string, 10)
        : undefined;
      const parsedLimit =
        rawLimit !== undefined && Number.isFinite(rawLimit)
          ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_SIZE)
          : undefined;
      const parsedOffset =
        rawOffset !== undefined && Number.isFinite(rawOffset)
          ? Math.max(rawOffset, 0)
          : undefined;

      const cacheKey =
        buildDrawingsCacheKey({
          userId: req.user.id,
          searchTerm: searchTerm ?? "",
          collectionFilter: collectionFilterKey,
          includeData: shouldIncludeData,
          sortField: parsedSortField,
          sortDirection: parsedSortDirection,
        }) + `:${parsedLimit}:${parsedOffset}:preview=${shouldIncludePreview ? "1" : "0"}`;

      const cachedBody = getCachedDrawingsBody(cacheKey);
      if (cachedBody) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Content-Type", "application/json");
        return res.send(cachedBody);
      }

      const summarySelect: Prisma.DrawingSelect = {
        id: true,
        name: true,
        collectionId: true,
        ...(shouldIncludePreview ? { preview: true } : {}),
        version: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true } },
      };

      const orderBy: Prisma.DrawingOrderByWithRelationInput =
        parsedSortField === "name"
          ? { name: parsedSortDirection }
          : parsedSortField === "createdAt"
            ? { createdAt: parsedSortDirection }
            : { updatedAt: parsedSortDirection };

      const queryOptions: Prisma.DrawingFindManyArgs = { where, orderBy };
      if (parsedLimit !== undefined) queryOptions.take = parsedLimit;
      if (parsedOffset !== undefined) queryOptions.skip = parsedOffset;
      if (!shouldIncludeData) queryOptions.select = summarySelect;

      const [drawings, totalCount] = await Promise.all([
        prisma.drawing.findMany(queryOptions),
        prisma.drawing.count({ where }),
      ]);

      let responsePayload: any[] = drawings as any[];
      if (shouldIncludeData) {
        responsePayload = (drawings as any[]).map((d: any) => ({
          ...d,
          collectionId: toPublicTrashCollectionId(d.collectionId, req.user!.id),
          elements: parseJsonField(d.elements, []),
          appState: parseJsonField(d.appState, {}),
          files: parseJsonField(d.files, {}),
          creatorName: d.user?.name ?? null,
          user: undefined,
        }));
      } else {
        responsePayload = (drawings as any[]).map((d: any) => ({
          ...d,
          collectionId: toPublicTrashCollectionId(d.collectionId, req.user!.id),
          creatorName: d.user?.name ?? null,
          user: undefined,
        }));
      }

      const finalResponse = {
        drawings: responsePayload,
        totalCount,
        limit: parsedLimit,
        offset: parsedOffset,
      };

      const body = cacheDrawingsResponse(cacheKey, finalResponse);
      res.setHeader("X-Cache", "MISS");
      res.setHeader("Content-Type", "application/json");
      return res.send(body);
    }),
  );

  // Shared with me list (does not mix into /drawings cache semantics)
  // Must be registered before `/drawings/:id` so it doesn't get treated as a drawing id.
  app.get(
    "/drawings/shared",
    requireAuth,
    asyncHandler(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Unauthorized" });

      const { search, includeData, includePreview, limit, offset, sortField, sortDirection } =
        req.query;
      const searchTerm =
        typeof search === "string" && search.trim().length > 0
          ? search.trim()
          : undefined;

      const shouldIncludeData =
        typeof includeData === "string"
          ? includeData.toLowerCase() === "true" || includeData === "1"
          : false;
      const shouldIncludePreview =
        typeof includePreview === "string"
          ? includePreview.toLowerCase() === "true" || includePreview === "1"
          : false;
      const parsedSortField: SortField =
        sortField === "name" ||
        sortField === "createdAt" ||
        sortField === "updatedAt"
          ? sortField
          : "updatedAt";
      const parsedSortDirection: SortDirection =
        sortDirection === "asc" || sortDirection === "desc"
          ? sortDirection
          : parsedSortField === "name"
            ? "asc"
            : "desc";

      const rawLimit = limit ? Number.parseInt(limit as string, 10) : undefined;
      const rawOffset = offset
        ? Number.parseInt(offset as string, 10)
        : undefined;
      const parsedLimit =
        rawLimit !== undefined && Number.isFinite(rawLimit)
          ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_SIZE)
          : undefined;
      const parsedOffset =
        rawOffset !== undefined && Number.isFinite(rawOffset)
          ? Math.max(rawOffset, 0)
          : undefined;

      const orderBy: Prisma.DrawingOrderByWithRelationInput =
        parsedSortField === "name"
          ? { name: parsedSortDirection }
          : parsedSortField === "createdAt"
            ? { createdAt: parsedSortDirection }
            : { updatedAt: parsedSortDirection };

      // Get collection IDs shared with this user to exclude drawings already visible via collection sharing
      const sharedCollectionIds = await prisma.collectionShare.findMany({
        where: { granteeUserId: req.user.id },
        select: { collectionId: true },
      });
      const sharedColIds = sharedCollectionIds.map((s) => s.collectionId);

      const whereDrawing: Prisma.DrawingWhereInput = {
        // "Shared with me" should only include drawings owned by someone else.
        // Some deployments keep an owner self-permission row for access control; exclude those.
        userId: { not: req.user.id },
        permissions: {
          some: {
            granteeUserId: req.user.id,
          },
        },
        // Exclude drawings already accessible via a shared collection
        ...(sharedColIds.length > 0 && {
          NOT: {
            collectionId: { in: sharedColIds },
          },
        }),
      };
      if (searchTerm) {
        whereDrawing.name = { contains: searchTerm };
      }

      const summarySelect: Prisma.DrawingSelect = {
        id: true,
        name: true,
        collectionId: true,
        ...(shouldIncludePreview ? { preview: true } : {}),
        version: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        permissions: {
          where: { granteeUserId: req.user.id },
          select: { permission: true },
        },
      };

      const queryOptions: Prisma.DrawingFindManyArgs = {
        where: whereDrawing,
        orderBy,
      };
      if (parsedLimit !== undefined) queryOptions.take = parsedLimit;
      if (parsedOffset !== undefined) queryOptions.skip = parsedOffset;
      if (!shouldIncludeData) queryOptions.select = summarySelect;

      const [drawings, totalCount] = await Promise.all([
        prisma.drawing.findMany(queryOptions),
        prisma.drawing.count({ where: whereDrawing }),
      ]);

      const normalize = (d: any) => {
        const rawPerm = Array.isArray(d?.permissions)
          ? d.permissions[0]?.permission
          : null;
        const perm = normalizeDrawingPermission(rawPerm) ?? "view";
        const { permissions: _permissions, ...rest } = d;
        return {
          ...rest,
          // Collections are owner-scoped; don't leak the owner's collection ids to viewers.
          collectionId: null,
          accessLevel: perm,
        };
      };

      let responsePayload: any[] = drawings as any[];
      if (shouldIncludeData) {
        responsePayload = (drawings as any[]).map((d: any) => {
          const normalized = normalize(d);
          return {
            ...normalized,
            elements: parseJsonField(d.elements, []),
            appState: parseJsonField(d.appState, {}),
            files: parseJsonField(d.files, {}),
          };
        });
      } else {
        responsePayload = (drawings as any[]).map((d: any) => normalize(d));
      }

      return res.json({
        drawings: responsePayload,
        totalCount,
        limit: parsedLimit,
        offset: parsedOffset,
      });
    }),
  );

};
