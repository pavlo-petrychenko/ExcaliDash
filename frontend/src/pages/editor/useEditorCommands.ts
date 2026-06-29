import { useCallback, useEffect } from "react";
import type { FormEvent, MutableRefObject } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import * as api from "../../api";
import { exportFromEditor } from "../../utils/exportUtils";
import { hasRenderableElements } from "./shared";

type EditorCommandRefs = {
  excalidrawAPI: MutableRefObject<any>;
  hasSceneChangesSinceLoad: MutableRefObject<boolean>;
  latestFiles: MutableRefObject<any>;
  saveData: MutableRefObject<
    | ((
        drawingId: string,
        elements: readonly any[],
        appState: any,
        files?: Record<string, any>,
      ) => Promise<void>)
    | null
  >;
  savePreview: MutableRefObject<
    | ((
        drawingId: string,
        elements: readonly any[],
        appState: any,
        files: any,
      ) => Promise<void>)
    | null
  >;
  suspiciousBlankLoad: MutableRefObject<boolean>;
};

type UseEditorCommandsParams = {
  autoHideEnabled: boolean;
  canEdit: boolean;
  debouncedSaveLibrary: (items: any[]) => void;
  drawingId: string | undefined;
  drawingName: string;
  isSavingOnLeave: boolean;
  newName: string;
  refs: EditorCommandRefs;
  resolveSafeSnapshot: (candidateSnapshot?: readonly any[]) => {
    snapshot: readonly any[];
    prevented: boolean;
    staleEmptySnapshot: boolean;
    staleNonRenderableSnapshot: boolean;
  };
  enqueueSceneSave: (
    drawingId: string,
    elements: readonly any[],
    appState: any,
    files?: Record<string, any>,
    options?: { suppressErrors?: boolean },
  ) => Promise<void>;
  setAutoHideEnabled: (enabled: boolean) => void;
  setDrawingName: (name: string) => void;
  setIsHeaderVisible: (visible: boolean) => void;
  setIsRenaming: (isRenaming: boolean) => void;
  setIsSavingOnLeave: (isSaving: boolean) => void;
  setNewName: (name: string) => void;
  user: unknown;
};

export const useEditorCommands = ({
  autoHideEnabled,
  canEdit,
  debouncedSaveLibrary,
  drawingId,
  drawingName,
  enqueueSceneSave,
  isSavingOnLeave,
  newName,
  refs,
  resolveSafeSnapshot,
  setAutoHideEnabled,
  setDrawingName,
  setIsHeaderVisible,
  setIsRenaming,
  setIsSavingOnLeave,
  setNewName,
  user,
}: UseEditorCommandsParams) => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (!canEdit) return;
        if (
          !(
            refs.excalidrawAPI.current &&
            refs.saveData.current &&
            refs.savePreview.current
          )
        ) {
          return;
        }
        if (!drawingId) return;
        const elements =
          refs.excalidrawAPI.current.getSceneElementsIncludingDeleted();
        const { snapshot: safeElements } = resolveSafeSnapshot(elements);
        const appState = refs.excalidrawAPI.current.getAppState();
        const files = refs.excalidrawAPI.current.getFiles() || {};
        refs.latestFiles.current = files;
        await enqueueSceneSave(drawingId, safeElements, appState, files);
        refs.savePreview.current(drawingId, safeElements, appState, files);
        toast.success("Saved changes to server");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, drawingId, enqueueSceneSave, refs, resolveSafeSnapshot]);

  const handleRenameSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canEdit) return;
      if (newName.trim() && drawingId) {
        setDrawingName(newName);
        setIsRenaming(false);
        try {
          await api.updateDrawing(drawingId, { name: newName });
        } catch (err) {
          console.error("Failed to rename", err);
        }
      }
    },
    [canEdit, drawingId, newName, setDrawingName, setIsRenaming],
  );

  const handleLibraryChange = useCallback(
    (items: readonly any[]) => {
      if (!canEdit || !user) return;
      debouncedSaveLibrary([...items]);
    },
    [canEdit, debouncedSaveLibrary, user],
  );

  const handleBackClick = useCallback(async () => {
    if (isSavingOnLeave) return;
    setIsSavingOnLeave(true);
    let shouldNavigate = false;
    try {
      if (
        !(
          refs.excalidrawAPI.current &&
          refs.saveData.current &&
          refs.savePreview.current
        )
      ) {
        shouldNavigate = true;
      } else if (!canEdit || !refs.hasSceneChangesSinceLoad.current) {
        shouldNavigate = true;
      } else if (!drawingId) {
        shouldNavigate = true;
      } else {
        const elements =
          refs.excalidrawAPI.current.getSceneElementsIncludingDeleted();
        const { snapshot: safeElements } = resolveSafeSnapshot(elements);
        const appState = refs.excalidrawAPI.current.getAppState();
        const files = refs.excalidrawAPI.current.getFiles() || {};
        refs.latestFiles.current = files;
        if (
          refs.suspiciousBlankLoad.current &&
          !hasRenderableElements(safeElements)
        ) {
          toast.warning(
            "Blank scene detected on load. Skipping save to protect existing data.",
          );
          shouldNavigate = true;
        } else {
          await Promise.all([
            enqueueSceneSave(drawingId, safeElements, appState, files, {
              suppressErrors: false,
            }),
            refs.savePreview.current(drawingId, safeElements, appState, files),
          ]);
          shouldNavigate = true;
        }
      }
    } catch (err) {
      console.error("Failed to save on back navigation", err);
      toast.error("Failed to save changes. Please retry before leaving.");
    } finally {
      setIsSavingOnLeave(false);
    }
    if (shouldNavigate) navigate("/");
  }, [
    canEdit,
    drawingId,
    enqueueSceneSave,
    isSavingOnLeave,
    navigate,
    refs,
    resolveSafeSnapshot,
    setIsSavingOnLeave,
  ]);

  const handleExportClick = useCallback(() => {
    if (!refs.excalidrawAPI.current) return;
    const elements =
      refs.excalidrawAPI.current.getSceneElementsIncludingDeleted();
    const appState = refs.excalidrawAPI.current.getAppState();
    const files = refs.excalidrawAPI.current.getFiles() || {};
    exportFromEditor(drawingName, elements, appState, files);
    toast.success("Drawing exported");
  }, [drawingName, refs]);

  const handleToggleAutoHide = useCallback(() => {
    setAutoHideEnabled(!autoHideEnabled);
    setIsHeaderVisible(true);
  }, [autoHideEnabled, setAutoHideEnabled, setIsHeaderVisible]);

  const handleRenameStart = useCallback(() => {
    if (!canEdit) return;
    setNewName(drawingName);
    setIsRenaming(true);
  }, [canEdit, drawingName, setIsRenaming, setNewName]);

  return {
    handleBackClick,
    handleExportClick,
    handleLibraryChange,
    handleRenameStart,
    handleRenameSubmit,
    handleToggleAutoHide,
  };
};
