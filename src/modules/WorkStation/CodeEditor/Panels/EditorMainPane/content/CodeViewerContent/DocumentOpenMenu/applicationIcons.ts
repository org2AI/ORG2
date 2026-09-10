import AcrobatIcon from "@src/assets/documentApps/adobeacrobatreader.svg?url";
import BooksIcon from "@src/assets/documentApps/books.png";
import KeynoteIcon from "@src/assets/documentApps/keynote.png";
import LibreOfficeIcon from "@src/assets/documentApps/libreoffice.svg?url";
import ExcelIcon from "@src/assets/documentApps/microsoftexcel.svg?url";
import PowerPointIcon from "@src/assets/documentApps/microsoftpowerpoint.svg?url";
import WordIcon from "@src/assets/documentApps/microsoftword.svg?url";
import NumbersIcon from "@src/assets/documentApps/numbers.svg?url";
import PagesIcon from "@src/assets/documentApps/pages.png";
import PreviewIcon from "@src/assets/documentApps/preview.png";
import QuickTimeIcon from "@src/assets/documentApps/quicktime.svg?url";

const APPLICATION_ICONS: Record<string, string> = {
  "microsoft excel.app": ExcelIcon,
  "microsoft word.app": WordIcon,
  "microsoft powerpoint.app": PowerPointIcon,
  "libreoffice.app": LibreOfficeIcon,
  "adobe acrobat.app": AcrobatIcon,
  "adobe acrobat reader.app": AcrobatIcon,
  "adobe acrobat reader dc.app": AcrobatIcon,
  "numbers.app": NumbersIcon,
  "pages.app": PagesIcon,
  "keynote.app": KeynoteIcon,
  "preview.app": PreviewIcon,
  "books.app": BooksIcon,
  "ibooks.app": BooksIcon,
  "quicktime player.app": QuickTimeIcon,
};

export function getDocumentApplicationIcon(path?: string): string | undefined {
  const basename = path?.split("/").pop()?.toLowerCase() ?? "";
  return APPLICATION_ICONS[basename];
}
