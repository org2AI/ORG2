import React, {
  Suspense,
  lazy,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import DiffStatsBadge from "@src/components/DiffStatsBadge";
import Dropdown from "@src/components/Dropdown";
import type { DropdownOption } from "@src/components/Dropdown/types";
import TabPill from "@src/components/TabPill";
import {
  ArrowDown01Icon,
  ChevronsDownUpIcon,
  Copy01Icon,
  HugeiconsIcon,
  MoreHorizontalIcon,
  TextWrapIcon,
  Tick01Icon,
  UnfoldMoreIcon,
} from "@src/icons";
import Modal from "@src/scaffold/ModalSystem";

import type { MobileRpcClient } from "../../connection/mobileRpcClient";
import { useMobileRemotePlatform } from "../../platform";
import { MobileHeaderIconButton } from "../MobileHeaderIconButton";
import "../transcript/mobileToolPreview.scss";
import { useMobileCopyText } from "../transcript/useMobileCopyText";
import { MobileChangeFileHeader } from "./MobileChangeFileHeader";
import { MobileChangeReviewState } from "./MobileChangeReviewState";
import { MobileChangeSummary } from "./MobileChangeSummary";
import { MobilePatchDiff } from "./MobilePatchDiff";
import "./mobileChangeReview.scss";
import {
  type ChangeFile,
  type ChangeScope,
  useChangeReview,
} from "./useChangeReview";
import { useReviewViewport } from "./useReviewViewport";

const Editor = lazy(() => import("../transcript/MobileReadonlyEditor"));
const iconStyle: React.CSSProperties = {
  width: "var(--mobile-change-touch-size)",
  height: "var(--mobile-change-touch-size)",
  padding: 0,
  borderRadius: "var(--mobile-change-action-radius)",
};
type ExpansionCommand = { expanded: boolean };
interface Props {
  client: MobileRpcClient | null;
  sessionId: string;
  roundId: string | null;
  online: boolean;
  revision: string;
}

function ReviewDropdown({
  label,
  value,
  options,
  onSelect,
  searchable = false,
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  onSelect: (value: string) => void;
  searchable?: boolean;
}) {
  const { runtime } = useMobileRemotePlatform();
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const valueId = useId();
  const container = runtime.portalContainer?.();
  return (
    <div
      className="mobile-change-review__dropdown"
      onKeyDownCapture={(event) => {
        // Portaled menu events retain React ancestry. Keep Escape at the open
        // dropdown boundary instead of reaching the parent Modal's document handler.
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          event.currentTarget.querySelector("button")?.focus();
        }
      }}
    >
      <Dropdown
        trigger="click"
        position="bottom-end"
        getPopupContainer={
          container ? () => container as HTMLElement : undefined
        }
        avoidViewportOverflow
        className={`mobile-change-review-menu ${searchable ? "mobile-change-review-menu--files" : "mobile-change-review-menu--scope"}`}
        popupVisible={open}
        onVisibleChange={setOpen}
        options={options}
        value={value}
        showSearch={searchable}
        onSelect={(next) => {
          if (typeof next === "string") onSelect(next);
        }}
      >
        <Button
          variant="tertiary"
          className="mobile-change-review__dropdown-trigger"
          aria-labelledby={`${labelId} ${valueId}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={value}
        >
          <span id={labelId} className="sr-only">
            {label}
          </span>
          <span id={valueId} className="mobile-change-review__dropdown-label">
            {options.find((option) => option.value === value)?.label ?? value}
          </span>
          <HugeiconsIcon icon={ArrowDown01Icon} size={16} aria-hidden="true" />
        </Button>
      </Dropdown>
    </div>
  );
}

export function MobileChangeReview(props: Props) {
  const { runtime } = useMobileRemotePlatform();
  const [visible, setVisible] = useState(() => !runtime.isHidden());
  useEffect(() => {
    const update = () => setVisible(!runtime.isHidden());
    update();
    return runtime.subscribeVisibility(update);
  }, [runtime]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [selected, setSelected] = useState<string>();
  const enabled = props.online && visible;
  const review = useChangeReview(
    props.client,
    props.sessionId,
    props.roundId,
    "turn",
    enabled,
    props.revision
  );
  const files = review.value?.files;
  const panel = open ? (
    <ReviewPanel
      {...props}
      turnReview={review}
      online={enabled}
      selected={selected}
      onClose={() => setOpen(false)}
    />
  ) : null;
  // Product policy: a successful empty turn has no footer. Keep an already
  // opened review mounted so refresh cannot dismiss another selected scope.
  return (
    <>
      {files?.length !== 0 && (
        <MobileChangeSummary
          files={files}
          online={props.online}
          error={!!review.error}
          refreshing={review.refreshing}
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          onOpen={(path) => {
            setSelected(path);
            setOpen(true);
          }}
          onRetry={review.retry}
        />
      )}
      {panel}
    </>
  );
}

function ReviewPanel(
  props: Props & {
    selected?: string;
    onClose: () => void;
    turnReview: ReturnType<typeof useChangeReview>;
  }
) {
  const { t } = useTranslation("mobileRemote");
  const initialFocusRef = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<ChangeScope>("turn");
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState(props.selected);
  const [expandAll, setExpandAll] = useState<ExpansionCommand | null>(null);
  const scopedReview = useChangeReview(
    props.client,
    props.sessionId,
    props.roundId,
    scope,
    props.online && scope !== "turn",
    props.revision
  );
  // The footer owns the turn manifest. Opening its panel must not issue the
  // same request a second time (or maintain an independent stale result).
  const review = scope === "turn" ? props.turnReview : scopedReview;
  const files = review.value?.files;
  const selectedPath =
    files?.find((file) => file.path === selected)?.path ?? files?.[0]?.path;
  const total = (key: "additions" | "deletions") =>
    files?.every((file) => file[key] !== null)
      ? files.reduce((sum, file) => sum + file[key]!, 0)
      : null;
  const additions = total("additions");
  const deletions = total("deletions");
  return (
    <Modal
      visible
      size="fullscreen"
      className="mobile-tool-preview mobile-change-review-sheet"
      aria-label={t("changeReview.title")}
      title={
        <div
          ref={initialFocusRef}
          tabIndex={-1}
          className="mobile-change-review__title"
        >
          <span>
            {files
              ? t("changeReview.filesCount", { count: files.length })
              : t("changeReview.title")}
          </span>
          {files && (
            <div className="mobile-change-review__totals">
              {additions !== null && deletions !== null && (
                <DiffStatsBadge
                  additions={additions}
                  deletions={deletions}
                  variant="plain"
                  reserveValueWidth={false}
                  gapClassName="gap-2"
                />
              )}
            </div>
          )}
        </div>
      }
      initialFocusRef={initialFocusRef}
      closable={false}
      headerActions={
        <div className="mobile-change-review__header-actions">
          <MobileHeaderIconButton
            className="mobile-change-review__close"
            label={t("common:actions.close")}
            onClick={props.onClose}
          />
          {!full && (
            <Button
              iconOnly
              variant="tertiary"
              className="mobile-change-review__icon mobile-change-review__expand-all"
              style={iconStyle}
              disabled={!files?.length}
              aria-label={t(
                expandAll?.expanded
                  ? "changeReview.collapseAll"
                  : "changeReview.expandAll"
              )}
              title={t(
                expandAll?.expanded
                  ? "changeReview.collapseAll"
                  : "changeReview.expandAll"
              )}
              aria-pressed={expandAll?.expanded === true}
              onClick={() =>
                setExpandAll((command) => ({ expanded: !command?.expanded }))
              }
              icon={
                <HugeiconsIcon
                  icon={
                    expandAll?.expanded ? ChevronsDownUpIcon : UnfoldMoreIcon
                  }
                  size={18}
                  aria-hidden="true"
                  data-icon={
                    expandAll?.expanded
                      ? "chevrons-down-up"
                      : "chevrons-up-down"
                  }
                />
              }
            />
          )}
        </div>
      }
      onClose={props.onClose}
      bodyClassName="mobile-change-review__body"
    >
      <div className="mobile-change-review__controls">
        <div className="mobile-change-review__scope">
          <span>{t("changeReview.scope")}</span>
          <ReviewDropdown
            label={t("changeReview.scope")}
            value={scope}
            options={(["turn", "session", "workspace"] as const).map(
              (value) => ({ value, label: t(`changeReview.${value}`) })
            )}
            onSelect={(value) => {
              if (
                value === "turn" ||
                value === "session" ||
                value === "workspace"
              ) {
                setScope(value);
                setSelected(undefined);
              }
            }}
          />
        </div>
        <div className="mobile-change-review__toolbar">
          <TabPill
            variant="pill"
            appearance="layout"
            activeTone="neutral"
            buttonStyle
            fillWidth
            className="mobile-change-review__mode"
            activeTab={full ? "full" : "diff"}
            tabs={[
              {
                key: "diff",
                label: t("changeReview.diff"),
                badge: !full ? (
                  <span className="sr-only">{t("changeReview.selected")}</span>
                ) : undefined,
              },
              {
                key: "full",
                label: t("changeReview.full"),
                badge: full ? (
                  <span className="sr-only">{t("changeReview.selected")}</span>
                ) : undefined,
              },
            ]}
            onChange={(value) => setFull(value === "full")}
          />
        </div>
      </div>
      {!props.online ? (
        <MobileChangeReviewState state="offline" />
      ) : review.error && !review.value ? (
        <MobileChangeReviewState state="error" onRetry={review.retry} />
      ) : !review.value ? (
        <MobileChangeReviewState state="loading" />
      ) : (
        <>
          {(review.refreshing || review.error) && (
            <MobileChangeReviewState
              state={review.error ? "refresh-error" : "refreshing"}
              onRetry={review.retry}
              compact
            />
          )}
          {!review.value.complete && (
            <details className="mobile-change-review__disclosure">
              <summary>{t("fileViewer.partial")}</summary>
              <p>{t("changeReview.partial")}</p>
            </details>
          )}
          {review.value.files.length === 0 && (
            <MobileChangeReviewState state="empty" />
          )}
          {full && review.value.files.length > 1 && (
            <div className="mobile-change-review__file-picker">
              <ReviewDropdown
                label={t("changeReview.file")}
                value={selectedPath ?? ""}
                options={review.value.files.map((file) => ({
                  value: file.path,
                  label: file.path,
                }))}
                onSelect={setSelected}
                searchable
              />
            </div>
          )}
          {(full
            ? review.value.files.filter((f) => f.path === selectedPath)
            : review.value.files
          ).map((file, index) => (
            <FileReview
              key={`${scope}:${full}:${file.path}`}
              {...props}
              scope={scope}
              file={file}
              full={full}
              onOpenFull={() => {
                setSelected(file.path);
                setFull(true);
              }}
              expandAll={expandAll}
              selected={selected !== undefined && file.path === selectedPath}
              initialOpen={
                full || file.path === selectedPath || (!selected && index === 0)
              }
            />
          ))}
        </>
      )}
    </Modal>
  );
}

function FileReview(
  props: Props & {
    scope: ChangeScope;
    file: ChangeFile;
    full: boolean;
    initialOpen: boolean;
    expandAll: ExpansionCommand | null;
    selected: boolean;
    onOpenFull: () => void;
  }
) {
  const { t } = useTranslation("mobileRemote");
  const [expansion, setExpansion] = useState<{
    base: ExpansionCommand | null;
    value: boolean;
  } | null>(null);
  const expanded =
    props.full ||
    (expansion?.base === props.expandAll
      ? expansion.value
      : (props.expandAll?.expanded ?? props.initialOpen));
  const [element, setElement] = useState<HTMLElement | null>(null);
  const { onScreen, retainedHeight } = useReviewViewport(element, expanded);
  useEffect(() => {
    if (props.selected) element?.scrollIntoView({ block: "nearest" });
  }, [element, props.selected]);
  const [before, setBefore] = useState(false);
  const [wrap, setWrap] = useState(true);
  const detail = useChangeReview(
    props.client,
    props.sessionId,
    props.roundId,
    props.scope,
    props.online && expanded && onScreen,
    props.revision,
    props.file.path
  );
  const file = detail.value?.files.find((f) => f.path === props.file.path);
  const showBefore = file?.before != null && (before || file.after == null);
  const content = props.full
    ? showBefore
      ? file?.before
      : (file?.after ?? file?.before)
    : file?.patches.length
      ? file.patches.join("\n")
      : file?.after;
  const parts = props.file.path.split(/[\\/]/);
  parts.pop();
  const directory = parts.join("/");
  const copy = useMobileCopyText(content ?? "");
  return (
    <section
      ref={setElement}
      className="mobile-change-review__file"
      style={{
        minHeight:
          expanded && (!onScreen || !detail.value) ? retainedHeight : undefined,
      }}
    >
      <MobileChangeFileHeader
        file={file ?? props.file}
        expanded={expanded}
        full={props.full}
        onOpenFull={props.onOpenFull}
        onToggle={() =>
          setExpansion({ base: props.expandAll, value: !expanded })
        }
      />
      {expanded && onScreen ? (
        <details className="mobile-change-review__file-actions">
          <summary>
            <HugeiconsIcon
              icon={MoreHorizontalIcon}
              size={18}
              aria-hidden="true"
            />
            <span className="sr-only">{t("changeReview.moreActions")}</span>
          </summary>
          <div className="mobile-change-review__toolbar">
            {directory && (
              <details className="mobile-change-review__disclosure mobile-change-review__file-path">
                <summary aria-label={t("fileViewer.fileLocation")}>
                  <span>{directory}</span>
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={14}
                    aria-hidden="true"
                  />
                </summary>
                <p>{props.file.path}</p>
              </details>
            )}
            {props.full && (
              <Button
                variant="tertiary"
                className="mobile-change-review__version"
                style={{
                  height: "var(--mobile-change-touch-size)",
                  padding: "0 var(--mobile-change-action-padding)",
                  borderRadius: "var(--mobile-change-action-radius)",
                  fontSize: "inherit",
                }}
                disabled={file?.before == null || file?.after == null}
                onClick={() => setBefore((v) => !v)}
              >
                {t(showBefore ? "changeReview.before" : "changeReview.after")}
              </Button>
            )}
            <Button
              iconOnly
              className="mobile-change-review__icon mobile-change-review__wrap"
              style={iconStyle}
              variant="tertiary"
              aria-label={t("changeReview.wrap")}
              title={t("changeReview.wrap")}
              aria-pressed={wrap}
              onClick={() => setWrap((v) => !v)}
              icon={
                <HugeiconsIcon
                  icon={TextWrapIcon}
                  size={18}
                  aria-hidden="true"
                />
              }
            />
            <Button
              iconOnly
              variant="tertiary"
              className="mobile-change-review__icon"
              style={iconStyle}
              aria-label={t(
                copy.state === "copied"
                  ? "changeReview.copied"
                  : "changeReview.copy"
              )}
              title={t("changeReview.copy")}
              disabled={content == null || copy.state === "pending"}
              aria-busy={copy.state === "pending"}
              onClick={copy.copy}
              icon={
                <HugeiconsIcon
                  icon={copy.state === "copied" ? Tick01Icon : Copy01Icon}
                  size={18}
                  aria-hidden="true"
                />
              }
            />
          </div>
        </details>
      ) : undefined}
      {expanded && onScreen && (
        <>
          <span role="status" className="sr-only">
            {copy.state === "copied" ? t("changeReview.copied") : ""}
          </span>
          {copy.state === "failed" && (
            <p className="mobile-change-review__copy-error" role="alert">
              {t("changeReview.copyFailed")}
            </p>
          )}
          {(detail.refreshing || (detail.error && detail.value)) && (
            <MobileChangeReviewState
              state={detail.error ? "refresh-error" : "refreshing"}
              onRetry={detail.retry}
              compact
            />
          )}
          {!props.online ? (
            <MobileChangeReviewState state="offline" compact />
          ) : detail.error && !detail.value ? (
            <MobileChangeReviewState
              state="error"
              onRetry={detail.retry}
              compact
            />
          ) : !detail.value ? (
            <MobileChangeReviewState state="loading" compact />
          ) : !file || content == null ? (
            <MobileChangeReviewState state="unavailable" compact />
          ) : (
            <div
              className={`mobile-change-review__editor ${props.full ? "mobile-change-review__editor--full" : "mobile-change-review__editor--diff"}`}
            >
              {props.full &&
                file.availability === "reconstructed_from_history" && (
                  <p className="mobile-change-review__notice">
                    {t("changeReview.reconstructed")}
                  </p>
                )}
              {!props.full && file.patches.length > 0 ? (
                <MobilePatchDiff
                  patches={file.patches}
                  filePath={file.path}
                  wrap={wrap}
                />
              ) : (
                <Suspense
                  fallback={<MobileChangeReviewState state="loading" compact />}
                >
                  <Editor
                    content={content}
                    original={
                      !props.full && !file.patches.length && file.before != null
                        ? file.before
                        : undefined
                    }
                    filePath={file.path}
                    language={
                      !props.full && file.patches.length ? "diff" : undefined
                    }
                    wrap={wrap}
                    height={props.full ? "100%" : "auto"}
                  />
                </Suspense>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
