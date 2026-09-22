import Button from "@src/components/Button";
import { ArrowRight01Icon, HugeiconsIcon } from "@src/icons";

const SELECTED_ROW_CLASS = "settings-table-row-selected";

export function selectedRowClassName<T>(
  getKey: (row: T) => string,
  selectedId: string | undefined | null
): ((row: T, index: number) => string) | undefined {
  if (!selectedId) return undefined;
  return (row: T) => (getKey(row) === selectedId ? SELECTED_ROW_CLASS : "");
}

export { default as StatusDot } from "@src/components/StatusDot";

export function RowChevron({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="tertiary"
      size="mini"
      iconOnly
      icon={
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          data-icon="chevron-right"
          size={14}
        />
      }
      onClick={onClick}
      className="ml-auto hover:bg-fill-2 hover:text-text-1"
    />
  );
}
