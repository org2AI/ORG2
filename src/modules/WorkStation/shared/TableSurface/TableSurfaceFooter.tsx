import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

import { TABLE_ROW_HEIGHT } from "./tableSurfaceUtils";

interface TableSurfaceFooterProps {
  hasMoreRows: boolean;
  loadingMoreRows: boolean;
  loadMoreTop: number;
  scrollLeft: number;
  viewportWidth: number;
  onLoadMoreRows?: () => void | Promise<void>;
}

export function TableSurfaceFooter({
  hasMoreRows,
  loadingMoreRows,
  loadMoreTop,
  scrollLeft,
  viewportWidth,
  onLoadMoreRows,
}: TableSurfaceFooterProps) {
  const { t } = useTranslation();

  if (!hasMoreRows || !onLoadMoreRows) return null;

  return (
    <Button
      layout="custom"
      className="table-surface__load-more-row"
      style={{
        width: viewportWidth,
        height: TABLE_ROW_HEIGHT,
        transform: `translate3d(${scrollLeft}px, ${loadMoreTop}px, 0)`,
      }}
      disabled={loadingMoreRows}
      onClick={() => void onLoadMoreRows()}
    >
      <span>{t("common:actions.loadMore")}</span>
    </Button>
  );
}
