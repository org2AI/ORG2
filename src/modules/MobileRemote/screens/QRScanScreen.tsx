import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import PageNotice from "@src/components/PageNotice";
import Textarea from "@src/components/Textarea";

import { MobileActionButton } from "../components/MobileActionButton";
import { MobileTopBar } from "../components/MobileTopBar";
import { parseMobileRemoteWsUrl } from "../connection/parseMobileRemoteWsUrl";
import type { MobileConnectionConfig } from "../connection/types";
import { useMobileRemotePlatform } from "../platform";

export interface QRScanScreenProps {
  onBack?: () => void;
  onAcceptPairing?: (args: {
    config: MobileConnectionConfig;
    requiresSas: boolean;
    sasPhrase?: string;
  }) => void;
}

/** Camera and paste share the same pairing validation boundary. */
export function QRScanScreen({ onBack, onAcceptPairing }: QRScanScreenProps) {
  const { t } = useTranslation("mobileRemote");
  const platform = useMobileRemotePlatform();
  const [payload, setPayload] = useState("");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const accept = useCallback(
    (value: string) => {
      const result = parseMobileRemoteWsUrl(value);
      if (!result.ok) {
        setErrorKey(result.errorKey);
        return;
      }
      setErrorKey(null);
      onAcceptPairing?.({
        config: result.config,
        requiresSas: result.requiresSas,
        sasPhrase: result.sasPhrase,
      });
    },
    [onAcceptPairing]
  );

  useEffect(() => {
    if (!scanning || !videoRef.current) return;
    const controller = new AbortController();
    const stopWhenHidden = () => {
      if (platform.runtime.isHidden()) {
        controller.abort();
        setScanning(false);
      }
    };
    const unsubscribe = platform.runtime.subscribeVisibility(stopWhenHidden);
    if (platform.runtime.isHidden()) stopWhenHidden();
    const operation = platform.scanQr
      ? platform.scanQr(videoRef.current, controller.signal)
      : Promise.reject(new DOMException("Unavailable", "NotFoundError"));
    void operation
      .then((value) => {
        if (controller.signal.aborted) return;
        setScanning(false);
        accept(value);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setScanning(false);
        const name =
          error && typeof error === "object" && "name" in error
            ? error.name
            : "";
        setErrorKey(
          name === "NotAllowedError"
            ? "pairing.cameraDenied"
            : name === "NotFoundError" || name === "NotReadableError"
              ? "pairing.cameraUnavailable"
              : name === "TimeoutError"
                ? "pairing.scanTimeout"
                : "pairing.scanFailed"
        );
      });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [scanning, platform, accept]);

  return (
    <>
      <MobileTopBar title={t("pairing.scanTitle")} onBack={onBack} />
      <div className="flex flex-1 flex-col px-4 py-4">
        <p className="mb-3 text-sm text-text-2">{t("pairing.scanHint")}</p>
        {scanning ? (
          <div className="mb-4 flex flex-col gap-3">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label={t("pairing.cameraPreview")}
              className="aspect-square w-full rounded-xl bg-black object-cover"
            />
            <p role="status" className="text-sm text-text-2">
              {t("pairing.scanning")}
            </p>
            <MobileActionButton
              variant="secondary"
              className="w-full"
              onClick={() => setScanning(false)}
            >
              {t("pairing.cancelScan")}
            </MobileActionButton>
          </div>
        ) : (
          <div className="mb-4">
            <MobileActionButton
              variant="secondary"
              className="w-full"
              onClick={() => {
                setErrorKey(null);
                setScanning(true);
              }}
            >
              {t("pairing.scanCamera")}
            </MobileActionButton>
          </div>
        )}
        <Textarea
          disabled={scanning}
          value={payload}
          onChange={(value) => {
            setPayload(value);
            if (errorKey) setErrorKey(null);
          }}
          placeholder={t("pairing.urlPlaceholder")}
          rows={4}
          aria-label={t("pairing.urlPlaceholder")}
        />
        {errorKey ? (
          <PageNotice type="danger" role="alert" className="mt-2">
            {t(errorKey)}
          </PageNotice>
        ) : null}
        <div className="mt-4">
          <MobileActionButton
            variant="primary"
            className="w-full"
            disabled={scanning || payload.trim().length === 0}
            onClick={() => accept(payload)}
          >
            {t("pairing.connect")}
          </MobileActionButton>
        </div>
      </div>
    </>
  );
}

QRScanScreen.displayName = "QRScanScreen";
