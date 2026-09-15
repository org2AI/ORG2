import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";

import { MarketLaunchError, prepareLaunch } from "./launch";
import type { Connection } from "./rpc";

export default function WorkspaceLaunch({
  connection,
  selection,
  model,
  onClose,
}: {
  connection: Connection;
  selection: string | null;
  model: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("integrations");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true),
    running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const launch = async () => {
    if (running.current || !selection) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const folder = await open({ directory: true, multiple: false });
      if (!active.current || typeof folder !== "string") return;
      await prepareLaunch(
        connection,
        selection,
        model,
        folder,
        () => active.current
      );
      onClose();
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof MarketLaunchError ? failure.reason : "launchFailed"
        );
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        loading={busy}
        disabled={!selection}
        onClick={() => void launch()}
      >
        {t("marketConnection.openWorkspace")}
      </Button>
      <p className="text-text-2">{t("marketConnection.launchNote")}</p>
      {error && <p role="alert">{t(`marketConnection.${error}`)}</p>}
    </div>
  );
}
