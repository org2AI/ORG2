/**
 * useSpotlightOverlayLayers Hook
 *
 * Owns the "which overlay layer is active" state for `GlobalSpotlightInner`
 * — workspace, organization, and GitHub import flows, branch/worktree pickers, session
 * searches, agent control, session creation, and the embedded editor palette —
 * plus their open/close handlers and the reset-on-close effect.
 */
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  SpotlightCollabOrgContext,
  SpotlightGitHubIssuesImportContext,
} from "@src/store/ui/uiAtom";

import {
  type EmbeddedEditorPaletteState,
  type WorkingDirectoryPickerMode,
  getEditorPaletteMode,
} from "../../globalSpotlight.helpers";
import type {
  BranchPaletteMode,
  WorktreePaletteMode,
} from "../../palettes/BranchPalette";
import type { EditorPaletteMode } from "../../palettes/EditorPalette/types";

// ============================================
// Types
// ============================================

interface UseSpotlightOverlayLayersResult {
  workingDirectoryPickerMode: WorkingDirectoryPickerMode | null;
  setWorkingDirectoryPickerMode: Dispatch<
    SetStateAction<WorkingDirectoryPickerMode | null>
  >;
  collabOrgContext: SpotlightCollabOrgContext | null;
  githubIssuesImportContext: SpotlightGitHubIssuesImportContext | null;
  embeddedBranchMode: BranchPaletteMode;
  setEmbeddedBranchMode: Dispatch<SetStateAction<BranchPaletteMode>>;
  embeddedWorktreeMode: WorktreePaletteMode;
  setEmbeddedWorktreeMode: Dispatch<SetStateAction<WorktreePaletteMode>>;
  branchPickerOpen: boolean;
  setBranchPickerOpen: Dispatch<SetStateAction<boolean>>;
  worktreePickerOpen: boolean;
  setWorktreePickerOpen: Dispatch<SetStateAction<boolean>>;
  agentSessionSearchOpen: boolean;
  allSessionsSearchOpen: boolean;
  agentControlOpen: boolean;
  sessionCreatorOpen: boolean;
  sessionImportOpen: boolean;
  embeddedEditorPalette: EmbeddedEditorPaletteState | null;
  lastActivatedItemIdRef: RefObject<string | null>;
  pendingRestoreItemId: string | null;
  setPendingRestoreItemId: Dispatch<SetStateAction<string | null>>;
  restoreLastActivatedItem: () => void;
  handleOpenWorkingDirectoryPicker: (mode: WorkingDirectoryPickerMode) => void;
  handleOpenCollabOrg: (context?: SpotlightCollabOrgContext) => void;
  handleOpenGitHubIssuesImport: (
    context?: SpotlightGitHubIssuesImportContext
  ) => void;
  handleOpenBranchPicker: () => void;
  handleOpenWorktreePicker: () => void;
  handleOpenAgentSessionSearch: () => void;
  handleOpenAllSessionsSearch: () => void;
  handleOpenAgentControl: () => void;
  handleOpenSessionCreator: () => void;
  handleOpenSessionImport: () => void;
  handleOpenEditorPalette: (query: string, mode?: EditorPaletteMode) => void;
  handleCloseWorkingDirectoryPicker: () => void;
  handleCloseCollabOrg: () => void;
  handleCloseGitHubIssuesImport: () => void;
  handleCloseBranchPicker: () => void;
  handleCloseWorktreePicker: () => void;
  handleCloseAgentSessionSearch: () => void;
  handleCloseAllSessionsSearch: () => void;
  handleCloseAgentControl: () => void;
  handleCloseSessionCreator: () => void;
  handleCloseSessionImport: () => void;
  handleCloseEditorPalette: () => void;
}

// ============================================
// Hook
// ============================================

export function useSpotlightOverlayLayers(
  isOpen: boolean
): UseSpotlightOverlayLayersResult {
  const [workingDirectoryPickerMode, setWorkingDirectoryPickerMode] =
    useState<WorkingDirectoryPickerMode | null>(null);
  const [collabOrgContext, setCollabOrgContext] =
    useState<SpotlightCollabOrgContext | null>(null);
  const [githubIssuesImportContext, setGitHubIssuesImportContext] =
    useState<SpotlightGitHubIssuesImportContext | null>(null);
  const [embeddedBranchMode, setEmbeddedBranchMode] =
    useState<BranchPaletteMode>("checkout");
  const [embeddedWorktreeMode, setEmbeddedWorktreeMode] =
    useState<WorktreePaletteMode>("switch");
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [worktreePickerOpen, setWorktreePickerOpen] = useState(false);
  const [agentSessionSearchOpen, setAgentSessionSearchOpen] = useState(false);
  const [allSessionsSearchOpen, setAllSessionsSearchOpen] = useState(false);
  const [agentControlOpen, setAgentControlOpen] = useState(false);
  const [sessionCreatorOpen, setSessionCreatorOpen] = useState(false);
  const [sessionImportOpen, setSessionImportOpen] = useState(false);
  const [embeddedEditorPalette, setEmbeddedEditorPalette] =
    useState<EmbeddedEditorPaletteState | null>(null);
  const lastActivatedItemIdRef = useRef<string | null>(null);
  const [pendingRestoreItemId, setPendingRestoreItemId] = useState<
    string | null
  >(null);

  const handleOpenWorkingDirectoryPicker = useCallback(
    (mode: WorkingDirectoryPickerMode) => {
      setWorkingDirectoryPickerMode(mode);
    },
    []
  );

  const handleOpenCollabOrg = useCallback(
    (context: SpotlightCollabOrgContext = {}) => {
      setCollabOrgContext(context);
    },
    []
  );

  const handleOpenGitHubIssuesImport = useCallback(
    (context: SpotlightGitHubIssuesImportContext = {}) => {
      setGitHubIssuesImportContext(context);
    },
    []
  );

  const handleOpenBranchPicker = useCallback(() => {
    setBranchPickerOpen(true);
  }, []);

  const handleOpenWorktreePicker = useCallback(() => {
    setEmbeddedWorktreeMode("switch");
    setWorktreePickerOpen(true);
  }, []);

  const handleOpenAgentSessionSearch = useCallback(() => {
    setAgentSessionSearchOpen(true);
  }, []);

  const handleOpenAllSessionsSearch = useCallback(() => {
    setAllSessionsSearchOpen(true);
  }, []);

  const handleOpenAgentControl = useCallback(() => {
    setAgentControlOpen(true);
  }, []);

  const handleOpenSessionImport = useCallback(
    () => setSessionImportOpen(true),
    []
  );

  const handleOpenSessionCreator = useCallback(() => {
    setSessionCreatorOpen(true);
  }, []);

  const handleOpenEditorPalette = useCallback(
    (query: string, mode?: EditorPaletteMode) => {
      setEmbeddedEditorPalette({
        mode: mode ?? getEditorPaletteMode(query),
        query,
      });
    },
    []
  );

  const restoreLastActivatedItem = useCallback(() => {
    setPendingRestoreItemId(lastActivatedItemIdRef.current);
  }, []);

  const handleCloseWorkingDirectoryPicker = useCallback(() => {
    setWorkingDirectoryPickerMode(null);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  const handleCloseCollabOrg = useCallback(() => {
    setCollabOrgContext(null);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  const handleCloseGitHubIssuesImport = useCallback(() => {
    setGitHubIssuesImportContext(null);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  const handleCloseBranchPicker = useCallback(() => {
    setBranchPickerOpen(false);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  const handleCloseWorktreePicker = useCallback(() => {
    setWorktreePickerOpen(false);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  const handleCloseAgentSessionSearch = useCallback(() => {
    setAgentSessionSearchOpen(false);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  const handleCloseAllSessionsSearch = useCallback(() => {
    setAllSessionsSearchOpen(false);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  const handleCloseAgentControl = useCallback(() => {
    setAgentControlOpen(false);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  const handleCloseSessionImport = useCallback(() => {
    setSessionImportOpen(false);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  const handleCloseSessionCreator = useCallback(() => {
    setSessionCreatorOpen(false);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  const handleCloseEditorPalette = useCallback(() => {
    setEmbeddedEditorPalette(null);
    restoreLastActivatedItem();
  }, [restoreLastActivatedItem]);

  useEffect(() => {
    if (isOpen) return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setWorkingDirectoryPickerMode(null);
      setCollabOrgContext(null);
      setGitHubIssuesImportContext(null);
      setBranchPickerOpen(false);
      setWorktreePickerOpen(false);
      setAgentSessionSearchOpen(false);
      setAllSessionsSearchOpen(false);
      setAgentControlOpen(false);
      setSessionCreatorOpen(false);
      setSessionImportOpen(false);
      setEmbeddedEditorPalette(null);
      lastActivatedItemIdRef.current = null;
      setPendingRestoreItemId(null);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  return {
    workingDirectoryPickerMode,
    setWorkingDirectoryPickerMode,
    collabOrgContext,
    githubIssuesImportContext,
    embeddedBranchMode,
    setEmbeddedBranchMode,
    embeddedWorktreeMode,
    setEmbeddedWorktreeMode,
    branchPickerOpen,
    setBranchPickerOpen,
    worktreePickerOpen,
    setWorktreePickerOpen,
    agentSessionSearchOpen,
    allSessionsSearchOpen,
    agentControlOpen,
    sessionCreatorOpen,
    sessionImportOpen,
    embeddedEditorPalette,
    lastActivatedItemIdRef,
    pendingRestoreItemId,
    setPendingRestoreItemId,
    restoreLastActivatedItem,
    handleOpenWorkingDirectoryPicker,
    handleOpenCollabOrg,
    handleOpenGitHubIssuesImport,
    handleOpenBranchPicker,
    handleOpenWorktreePicker,
    handleOpenAgentSessionSearch,
    handleOpenAllSessionsSearch,
    handleOpenAgentControl,
    handleOpenSessionCreator,
    handleOpenSessionImport,
    handleOpenEditorPalette,
    handleCloseWorkingDirectoryPicker,
    handleCloseCollabOrg,
    handleCloseGitHubIssuesImport,
    handleCloseBranchPicker,
    handleCloseWorktreePicker,
    handleCloseAgentSessionSearch,
    handleCloseAllSessionsSearch,
    handleCloseAgentControl,
    handleCloseSessionCreator,
    handleCloseSessionImport,
    handleCloseEditorPalette,
  };
}
