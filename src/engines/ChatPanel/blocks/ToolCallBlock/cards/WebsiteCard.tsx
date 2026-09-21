import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  ICON_BUTTON_BASE,
} from "@src/config/workstation/tokens";
import { HugeiconsIcon, InternetIcon } from "@src/icons";
import { openLink } from "@src/util/ui/openLink";

import type { WebsiteCardData } from "../types";

interface WebsiteCardProps {
  card: WebsiteCardData;
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const WebsiteCard: React.FC<WebsiteCardProps> = ({ card }) => {
  const { t } = useTranslation("sessions");
  const [faviconStatus, setFaviconStatus] = useState<{
    src?: string;
    loaded: boolean;
    failed: boolean;
  }>({ loaded: false, failed: false });
  const domain = getDomain(card.url);
  const faviconLoaded =
    faviconStatus.src === card.favicon && faviconStatus.loaded;
  const faviconFailed =
    faviconStatus.src === card.favicon && faviconStatus.failed;
  const showFavicon = Boolean(card.favicon && faviconLoaded && !faviconFailed);

  function handleOpen() {
    openLink(card.url, { navigate: true });
  }

  return (
    <div className="group/website-card mx-3 my-2 flex min-w-0 items-center gap-3">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
        {card.favicon && !faviconFailed && (
          <img
            src={card.favicon}
            alt=""
            className={showFavicon ? "h-5 w-5 object-contain" : "hidden"}
            onLoad={() =>
              setFaviconStatus({
                src: card.favicon,
                loaded: true,
                failed: false,
              })
            }
            onError={() =>
              setFaviconStatus({
                src: card.favicon,
                loaded: false,
                failed: true,
              })
            }
          />
        )}
        {!showFavicon && (
          <HugeiconsIcon
            icon={InternetIcon}
            data-icon="globe"
            size={18}
            className="text-text-4"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="chat-block-content truncate font-medium text-text-1">
          {card.title ?? domain}
        </div>
        <div className="flex items-center gap-1.5 text-text-2">
          <span className="chat-block-content truncate text-xs">
            {card.url}
          </span>
        </div>
      </div>

      <Button
        variant="tertiary"
        size="sidebar"
        iconOnly
        icon={
          <HugeiconsIcon
            icon={InternetIcon}
            data-icon="chrome"
            size={14}
            strokeWidth={1.75}
            aria-hidden
          />
        }
        onClick={handleOpen}
        className={`flex ${ICON_BUTTON_BASE} ${BUTTON_SIZE.sm} ${BUTTON_VARIANT.noDrop} cursor-pointer border-none bg-transparent opacity-0 group-focus-within/website-card:opacity-100 group-hover/website-card:opacity-100 focus-visible:opacity-100`}
        title={t("cards.openLink")}
        aria-label={t("cards.openLink")}
      />
    </div>
  );
};

WebsiteCard.displayName = "WebsiteCard";

export default WebsiteCard;
