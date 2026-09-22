import React, { useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";

import type {
  BranchSwitchResult,
  SwitchPreparation,
  SwitchScope,
  SwitchStrategy,
} from "@src/api/http/git/branchSwitch";
import Button from "@src/components/Button";
import DisclosureChevron from "@src/components/DisclosureChevron";
import FileTypeIcon from "@src/components/FileTypeIcon";
import Modal from "@src/scaffold/ModalSystem";
import SelectionGrid from "@src/scaffold/WizardSystem/primitives/SelectionGrid";

export type CheckoutConflictResult = SwitchStrategy | "cancel";

/** Fixed so long branch names and paths truncate instead of resizing the modal. */
const DIALOG_WIDTH = "min(520px, calc(100vw - 32px))";

/** File row matching the workstation trail: type icon, name, dimmed folder. */
function FilePathRow({ path }: { path: string }) {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  const folder = slash > 0 ? path.slice(0, slash) : "";
  return (
    <li className="flex h-6 min-w-0 items-center gap-1.5 text-xs" title={path}>
      <FileTypeIcon
        fileName={name}
        size="small"
        className="size-3.5 shrink-0"
      />
      <span className="max-w-full shrink-0 truncate text-text-1">{name}</span>
      {folder && <span className="min-w-0 truncate text-text-3">{folder}</span>}
    </li>
  );
}
interface ViewProps {
  scope: SwitchScope;
  preparation?: SwitchPreparation;
  busy: boolean;
  result?: BranchSwitchResult;
  error?: string;
  onChoice: (choice: CheckoutConflictResult) => void;
  onClose: () => void;
}
export function BranchSwitchDialogView({
  preparation,
  busy,
  result,
  error,
  onChoice,
  onClose,
}: ViewProps) {
  const { t } = useTranslation("common");
  const [choice, setChoice] = useState<SwitchStrategy>(
    preparation?.default_strategy ?? "leave"
  );
  const [filesOpen, setFilesOpen] = useState(false);
  const terminal = Boolean(result || error);
  const title =
    result?.outcome === "switched_with_conflicts"
      ? t("git.branchSwitch.conflictsTitle")
      : error ||
          result?.outcome === "blocked" ||
          result?.outcome === "recovery_required"
        ? t("git.branchSwitch.blockedTitle")
        : t("git.branchSwitch.title");
  return (
    <Modal
      visible
      title={title}
      size="medium"
      width={DIALOG_WIDTH}
      maskClosable={false}
      closable={!busy}
      escToExit={!busy}
      onClose={busy ? undefined : onClose}
      onCancel={busy ? undefined : onClose}
      onOk={terminal ? onClose : () => onChoice(choice)}
      okText={
        terminal
          ? t("actions.close")
          : busy
            ? t("git.branchSwitch.working")
            : t("git.branchSwitch.title")
      }
      okButtonProps={{ loading: busy, disabled: busy }}
      cancelButtonProps={{ disabled: busy }}
      // Result states only acknowledge; the default footer drops Cancel.
      cancelText={terminal ? "" : t("actions.cancel")}
    >
      <div className="flex min-w-0 flex-col gap-4">
        {preparation && (
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-text-1">
            <span
              className="min-w-0 truncate"
              title={preparation.current_branch}
            >
              {preparation.current_branch}
            </span>
            <span className="shrink-0 text-text-3">→</span>
            <span
              className="min-w-0 truncate"
              title={preparation.target_branch}
            >
              {preparation.target_branch}
            </span>
          </p>
        )}
        {terminal ? (
          <div role="status" className="flex flex-col gap-2">
            {result && (
              <p className="truncate text-sm text-text-1">
                {t("git.branchSwitch.current", {
                  branch: result.current_branch,
                })}
              </p>
            )}
            <p className="text-sm break-words whitespace-pre-wrap text-text-2">
              {error || result?.message}
            </p>
            {result?.conflicts.length ? (
              <ul className="max-h-48 min-w-0 overflow-auto">
                {result.conflicts.map((file) => (
                  <FilePathRow key={file} path={file} />
                ))}
              </ul>
            ) : null}
          </div>
        ) : preparation ? (
          <>
            <div className="min-w-0">
              <Button
                variant="ghost"
                size="inline"
                layout="custom"
                className="group/files flex h-6 items-center gap-1 text-xs text-text-3 hover:text-text-2"
                aria-expanded={filesOpen}
                onClick={() => setFilesOpen((open) => !open)}
              >
                {t("git.branchSwitch.changedFiles", {
                  count: preparation.changed_files.length,
                })}
                <DisclosureChevron
                  expanded={filesOpen}
                  aria-hidden
                  className="shrink-0 text-text-3 group-hover/files:text-text-2"
                  size={14}
                  strokeWidth={1.75}
                />
              </Button>
              {filesOpen && (
                <ul className="mt-1 max-h-48 min-w-0 overflow-auto">
                  {preparation.changed_files.map((file) => (
                    <FilePathRow key={file} path={file} />
                  ))}
                </ul>
              )}
            </div>
            <fieldset disabled={busy} className="min-w-0">
              <legend className="mb-3 text-sm text-text-1">
                {t("git.branchSwitch.question")}
              </legend>
              <SelectionGrid
                vertical
                showRadio
                options={[
                  {
                    key: "leave",
                    label: t("git.branchSwitch.leave", {
                      branch: preparation.current_branch,
                    }),
                    description: t("git.branchSwitch.leaveDescription"),
                    disabled: busy,
                  },
                  {
                    key: "bring",
                    label: t("git.branchSwitch.bring", {
                      branch: preparation.target_branch,
                    }),
                    description: t("git.branchSwitch.bringDescription"),
                    disabled: busy,
                  },
                ]}
                selected={choice}
                onSelect={setChoice}
              />
            </fieldset>
          </>
        ) : (
          <p role="status" className="text-sm text-text-2">
            {t("git.branchSwitch.working")}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Per-operation controller; no retained singleton state or detached modal roots. */
export function createBranchSwitchDialog(scope: SwitchScope) {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let preparation: SwitchPreparation | undefined;
  let resolveChoice: ((choice: CheckoutConflictResult) => void) | undefined;
  let busy = false;
  const dispose = () => {
    resolveChoice?.("cancel");
    resolveChoice = undefined;
    const oldRoot = root;
    const oldContainer = container;
    root = undefined;
    container = undefined;
    queueMicrotask(() => {
      oldRoot?.unmount();
      oldContainer?.remove();
    });
  };
  const render = (result?: BranchSwitchResult, error?: string) => {
    if (!root) {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
    }
    root.render(
      <BranchSwitchDialogView
        scope={scope}
        preparation={preparation}
        busy={busy}
        result={result}
        error={error}
        onClose={dispose}
        onChoice={(choice) => {
          const resolve = resolveChoice;
          resolveChoice = undefined;
          if (choice === "cancel") dispose();
          else {
            busy = true;
            render();
          }
          resolve?.(choice);
        }}
      />
    );
  };
  return {
    choose: (value: SwitchPreparation) =>
      new Promise<CheckoutConflictResult>((resolve) => {
        preparation = value;
        resolveChoice = resolve;
        render();
      }),
    executing: () => {
      busy = true;
      render();
    },
    complete: async (value: BranchSwitchResult) => {
      busy = false;
      if (value.outcome === "switched") dispose();
      else render(value);
    },
    blocked: async (message: string, currentBranch?: string) => {
      busy = false;
      if (currentBranch)
        render({
          outcome: "blocked",
          current_branch: currentBranch,
          message,
          snapshot_id: null,
          conflicts: [],
        });
      else render(undefined, message);
    },
    dispose,
  };
}
