import {
  buildFilesDiff,
  collectReferencedFileIds,
  fileIdFromS3Key,
  type S3FileRecord,
  type S3ObjectRecord,
} from "./helpers";

export type FilesJson = Record<string, any>;

export const buildTrimPlan = (elements: any[], files: FilesJson) => {
  const activeElements = elements.filter((el) => !el.isDeleted);
  const survivingFileIds = collectReferencedFileIds(activeElements, false);
  const cleanedFiles: FilesJson = {};

  for (const [fileId, value] of Object.entries(files)) {
    if (survivingFileIds.has(fileId)) {
      cleanedFiles[fileId] = value;
    }
  }

  return {
    activeElements,
    cleanedFiles,
    survivingFileIds,
    elementsRemoved: elements.length - activeElements.length,
    filesRemoved: Object.keys(files).length - Object.keys(cleanedFiles).length,
  };
};

export const buildTrimS3CleanupPlan = ({
  survivingFileIds,
  s3FileRecords,
  s3Objects,
}: {
  survivingFileIds: Set<string>;
  s3FileRecords: S3FileRecord[];
  s3Objects: S3ObjectRecord[];
}) => {
  const orphanKeys = new Set<string>();
  const orphanFileIds = new Set<string>();

  for (const record of s3FileRecords) {
    if (!survivingFileIds.has(record.fileId)) {
      orphanKeys.add(record.s3Key);
      orphanFileIds.add(record.fileId);
    }
  }

  for (const obj of s3Objects) {
    const fileId = fileIdFromS3Key(obj.key);
    if (fileId && !survivingFileIds.has(fileId)) {
      orphanKeys.add(obj.key);
    }
  }

  return {
    orphanKeys: Array.from(orphanKeys),
    orphanFileIds: Array.from(orphanFileIds),
  };
};

export const buildFilesDiffResponse = ({
  elements,
  files,
  s3FileRecords,
  s3Objects,
}: {
  elements: any[];
  files: FilesJson;
  s3FileRecords: S3FileRecord[];
  s3Objects: S3ObjectRecord[];
}) => {
  const allCanvasRefs = collectReferencedFileIds(elements, true);
  const activeCanvasRefs = collectReferencedFileIds(elements, false);
  const sqliteFileIds = new Set(Object.keys(files));

  return {
    summary: {
      totalCanvasRefs: allCanvasRefs.size,
      totalSqliteFiles: sqliteFileIds.size,
      totalS3Files: s3Objects.length,
    },
    files: buildFilesDiff({
      allCanvasRefs,
      activeCanvasRefs,
      sqliteFileIds,
      s3FileRecords,
      s3Objects,
    }),
  };
};

export const buildOrphanDeletePlan = ({
  elements,
  files,
  fileIds,
}: {
  elements: any[];
  files: FilesJson;
  fileIds: string[];
}) => {
  const activeRefs = collectReferencedFileIds(elements, false);
  const blockedIds = fileIds.filter((fid) => activeRefs.has(fid));
  const deletedFileIdSet = new Set(fileIds);
  const cleanedFiles = { ...files };

  for (const fileId of fileIds) {
    delete cleanedFiles[fileId];
  }

  const cleanedElements = elements.filter((el: any) => {
    return !(
      el.isDeleted &&
      el.type === "image" &&
      typeof el.fileId === "string" &&
      deletedFileIdSet.has(el.fileId)
    );
  });

  return {
    blockedIds,
    cleanedFiles,
    cleanedElements,
    deletedCount: fileIds.length,
  };
};
