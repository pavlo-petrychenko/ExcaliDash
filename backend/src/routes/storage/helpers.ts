export type S3FileRecord = {
  fileId: string;
  s3Key: string;
  mimeType: string;
};

export type S3ObjectRecord = {
  key: string;
  size: number;
};

export const VALID_STORAGE_FILE_ID = /^[\w-]{1,200}$/;

export const collectReferencedFileIds = (
  elements: any[],
  includeDeleted: boolean,
): Set<string> => {
  const ids = new Set<string>();
  for (const el of elements) {
    if (!includeDeleted && el.isDeleted) continue;
    if (el.type === "image" && typeof el.fileId === "string" && el.fileId) {
      ids.add(el.fileId);
    }
  }
  return ids;
};

export const fileIdFromS3Key = (key: string): string | null => {
  const lastSegment = key.split("/").pop();
  if (!lastSegment) return null;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0) return lastSegment;
  return lastSegment.substring(0, dotIndex);
};

export const buildFilesDiff = ({
  allCanvasRefs,
  activeCanvasRefs,
  sqliteFileIds,
  s3FileRecords,
  s3Objects,
}: {
  allCanvasRefs: Set<string>;
  activeCanvasRefs: Set<string>;
  sqliteFileIds: Set<string>;
  s3FileRecords: S3FileRecord[];
  s3Objects: S3ObjectRecord[];
}) => {
  const s3RecordMap = new Map(s3FileRecords.map((record) => [record.fileId, record]));
  const s3ObjectMap = new Map(
    s3Objects.map((object) => [fileIdFromS3Key(object.key), object] as const),
  );
  const allFileIds = new Set<string>([
    ...allCanvasRefs,
    ...sqliteFileIds,
    ...s3FileRecords.map((record) => record.fileId),
  ]);
  for (const object of s3Objects) {
    const fileId = fileIdFromS3Key(object.key);
    if (fileId) allFileIds.add(fileId);
  }

  return Array.from(allFileIds).map((fileId) => {
    const s3Record = s3RecordMap.get(fileId);
    const s3Object = s3ObjectMap.get(fileId);
    return {
      fileId,
      inCanvas: allCanvasRefs.has(fileId),
      inCanvasActive: activeCanvasRefs.has(fileId),
      inSqlite: sqliteFileIds.has(fileId),
      inS3: Boolean(s3Object),
      inS3Record: Boolean(s3Record),
      s3Key: s3Record?.s3Key ?? s3Object?.key ?? null,
      mimeType: s3Record?.mimeType ?? null,
      s3SizeBytes: s3Object?.size ?? null,
    };
  });
};
