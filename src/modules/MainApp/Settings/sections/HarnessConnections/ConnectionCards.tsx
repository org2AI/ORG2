import React from "react";
import { useTranslation } from "react-i18next";

import type { HarnessConnectionView } from "@src/api/tauri/rpc/schemas/agentOrgs";
import Button from "@src/components/Button";

import ConnectionChoiceCard from "./ConnectionChoiceCard";

export default function ConnectionCards({
  choices,
  selected,
  active,
  disabled,
  onSelect,
  onAdd,
  description,
}: {
  choices: HarnessConnectionView["choices"];
  selected: string | readonly string[];
  active: string | readonly string[] | null;
  disabled: boolean;
  onSelect: (keyId: string) => void;
  onAdd?: () => void;
  description?: (keyId: string) => string;
}) {
  const { t } = useTranslation("settings");
  return (
    <div
      className="flex w-full flex-col gap-2"
      role="group"
      aria-label={t("harnessConnections.connection")}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {choices.map((choice) => (
          <ConnectionChoiceCard
            key={choice.keyId}
            disabled={disabled || Boolean(choice.reason)}
            aria-pressed={
              Array.isArray(selected)
                ? selected.includes(choice.keyId)
                : selected === choice.keyId
            }
            onClick={() => onSelect(choice.keyId)}
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-medium" title={choice.name}>
                {choice.name}
                {(Array.isArray(active)
                  ? active.includes(choice.keyId)
                  : active === choice.keyId) && (
                  <span className="ml-2 text-xs text-success-6">
                    {t("harnessConnections.current")}
                  </span>
                )}
              </span>
              {(choice.reason ||
                description?.(choice.keyId) ||
                choice.endpoint) && (
                <span className="text-xs break-words text-text-3">
                  {choice.reason ??
                    description?.(choice.keyId) ??
                    choice.endpoint}
                </span>
              )}
            </span>
          </ConnectionChoiceCard>
        ))}
      </div>
      {onAdd && (
        <div>
          <Button disabled={disabled} onClick={onAdd}>
            {t("harnessConnections.add")}
          </Button>
        </div>
      )}
    </div>
  );
}
