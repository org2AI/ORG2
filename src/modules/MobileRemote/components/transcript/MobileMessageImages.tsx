import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { createLogger } from "@src/hooks/logger";
import Modal from "@src/scaffold/ModalSystem";

import { MobileHeaderIconButton } from "../MobileHeaderIconButton";

export type LoadMessageImage = (
  eventId: string,
  imageIndex: number
) => Promise<string>;

/** One transcript owns at most eight decoded previews; no app-global cache. */
export function createImageRetention() {
  const retained = new Map<string, () => void>();
  return {
    retain(key: string, evict: () => void) {
      retained.get(key)?.();
      retained.delete(key);
      retained.set(key, evict);
      while (retained.size > 8) {
        const oldest = retained.keys().next().value!;
        const dispose = retained.get(oldest)!;
        retained.delete(oldest);
        dispose();
      }
      return () => {
        if (retained.get(key) === evict) retained.delete(key);
      };
    },
  };
}
type ImageRetention = ReturnType<typeof createImageRetention>;

/** Images are explicitly loaded, not embedded in every transcript snapshot. */
function MessageImage({
  eventId,
  index,
  loadImage,
  retention,
}: {
  eventId: string;
  index: number;
  loadImage?: LoadMessageImage;
  retention?: ImageRetention;
}) {
  const { t } = useTranslation("mobileRemote");
  const generation = useRef(0);
  const busy = useRef(false);
  const release = useRef<(() => void) | undefined>(undefined);
  const [state, setState] = useState<{
    phase: "loading" | "ready" | "error";
    url?: string;
  }>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    busy.current = false;
    setState(undefined);
    setOpen(false);
    return () => {
      generation.current += 1;
      release.current?.();
    };
  }, [eventId, index, retention]);
  useEffect(() => {
    // Transport availability is not image ownership. Keep completed previews
    // across reconnects, but never accept a result from a retired RPC client.
    busy.current = false;
    setState((current) => (current?.phase === "loading" ? undefined : current));
    return () => {
      generation.current += 1;
    };
  }, [loadImage]);
  const current = state;
  const load = async () => {
    if (!loadImage || busy.current) return;
    busy.current = true;
    const request = generation.current;
    setState({ phase: "loading" });
    try {
      const url = await loadImage(eventId, index);
      if (request === generation.current) {
        release.current?.();
        release.current = retention?.retain(`${eventId}:${index}`, () => {
          setState(undefined);
          setOpen(false);
        });
        setState({ phase: "ready", url });
      }
    } catch {
      if (request === generation.current) setState({ phase: "error" });
    } finally {
      if (request === generation.current) busy.current = false;
    }
  };
  const fail = () => {
    release.current?.();
    setState({ phase: "error" });
    setOpen(false);
  };
  const label = t("images.label", { number: index + 1 });
  return (
    <div className="my-2" aria-busy={current?.phase === "loading"}>
      {current?.phase === "ready" && current.url ? (
        <>
          <Button
            variant="tertiary"
            className="max-w-full"
            style={{ height: "auto", minHeight: 44, padding: 0 }}
            aria-label={label}
            onClick={() => setOpen(true)}
          >
            <img
              src={current.url}
              alt={label}
              className="max-h-64 max-w-full rounded-lg object-contain"
              onError={fail}
            />
          </Button>
          {open && (
            <Modal
              visible
              title={label}
              onClose={() => setOpen(false)}
              closable={false}
              headerActions={
                <MobileHeaderIconButton
                  label={t("common:actions.close")}
                  onClick={() => setOpen(false)}
                />
              }
            >
              <img
                src={current.url}
                alt={label}
                className="h-auto w-full object-contain"
                onError={fail}
              />
            </Modal>
          )}
        </>
      ) : (
        <Button
          style={{ minHeight: 44 }}
          disabled={!loadImage || current?.phase === "loading"}
          onClick={() => {
            void load().catch((error) =>
              logger.warn("Background operation failed", error)
            );
          }}
        >
          {!loadImage
            ? t("images.unavailable")
            : current?.phase === "loading"
              ? t("images.loading")
              : current?.phase === "error"
                ? t("images.retry")
                : t("images.load", { number: index + 1 })}
        </Button>
      )}
    </div>
  );
}

export function MobileMessageImages({
  eventId,
  count,
  loadImage,
  retention,
}: {
  eventId: string;
  count: number;
  loadImage?: LoadMessageImage;
  retention?: ImageRetention;
}) {
  return (
    <>
      {Array.from({ length: Math.min(Math.max(0, count), 8) }, (_, index) => (
        <MessageImage
          key={`${eventId}:${index}`}
          eventId={eventId}
          index={index}
          loadImage={loadImage}
          retention={retention}
        />
      ))}
    </>
  );
}

const logger = createLogger("MobileMessageImages");
