import { type FC, type MouseEvent, memo } from "react";

import Button from "@src/components/Button";
import { File01Icon, HugeiconsIcon, Image01Icon } from "@src/icons";

const CachedFileChip: FC<{
  file: string;
  isPreviewOpen: boolean;
  onTogglePreview: (e: MouseEvent) => void;
  onClosePreview: (e: MouseEvent) => void;
}> = memo(({ file, isPreviewOpen, onTogglePreview, onClosePreview }) => {
  const isImg = /\.(png|jpg|jpeg|gif|webp)$/i.test(file);
  const fileName = file.split("/").pop();

  return (
    <div className="relative flex flex-col items-center">
      <div
        className="chat-block-content flex cursor-pointer items-center gap-1.5 rounded-md bg-fill-2 px-2.5 py-1 transition-colors hover:bg-fill-3"
        onClick={onTogglePreview}
      >
        {isImg ? (
          <HugeiconsIcon
            icon={Image01Icon}
            data-icon="image"
            size={13}
            strokeWidth={1.75}
            className="text-text-2"
          />
        ) : (
          <HugeiconsIcon
            icon={File01Icon}
            data-icon="file"
            size={13}
            strokeWidth={1.75}
            className="text-text-2"
          />
        )}
        <span className="text-text-2">{fileName}</span>
      </div>

      {isPreviewOpen && (
        <div
          className="absolute bottom-full left-1/2 z-50 mb-2 flex -translate-x-1/2 flex-col items-center rounded-xl bg-[#232325] p-3"
          style={{ minWidth: 180, maxWidth: 320 }}
        >
          <Button
            layout="custom"
            className="absolute top-2 right-2 text-lg text-white/70 hover:text-white"
            onClick={onClosePreview}
          >
            ×
          </Button>
          {isImg ? (
            <img
              src={file}
              alt="preview"
              className="rounded-lg object-contain"
              style={{ maxWidth: 200, maxHeight: 200 }}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center">
              <HugeiconsIcon
                icon={File01Icon}
                data-icon="file"
                size={32}
                strokeWidth={1.75}
                color="#888"
              />
              <div className="mt-2 text-white">{fileName}</div>
              <a
                href={file}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 text-blue-400 underline"
              >
                Open/Download
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
CachedFileChip.displayName = "CachedFileChip";

export default CachedFileChip;
