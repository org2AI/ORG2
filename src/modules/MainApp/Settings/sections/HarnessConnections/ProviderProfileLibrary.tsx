import { useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  HarnessConnectionView,
  HarnessProviderProfile,
} from "@src/api/tauri/rpc/schemas/agentOrgs";
import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { SECTION_DESCRIPTION_CLASSES } from "@src/modules/shared/layouts/SectionLayout";

import { profileDefaultModel } from "./useProviderProfileEditor";

export default function ProviderProfileLibrary({
  view,
  selected,
  disabled,
  canConnect,
  testedProfileId,
  busy,
  onEdit,
  onDuplicate,
  onTest,
  onApply,
}: {
  view: HarnessConnectionView | null;
  selected?: string;
  disabled: boolean;
  canConnect: boolean;
  testedProfileId?: string;
  busy: string | null;
  onEdit: (profile: HarnessProviderProfile) => void;
  onDuplicate: (profile: HarnessProviderProfile) => void;
  onTest: (profile: HarnessProviderProfile) => void;
  onApply: (profile: HarnessProviderProfile) => void;
}) {
  const { t } = useTranslation("settings");
  const [query, setQuery] = useState("");
  const profiles = view?.profiles ?? [];
  const search = query.trim().toLocaleLowerCase();
  const visible = profiles.filter((profile) => {
    const credential = view?.choices.find(
      (choice) => choice.keyId === profile.keyId
    );
    return [
      profile.name,
      profile.endpoint,
      credential?.name ?? "",
      ...(profile.target === "codex"
        ? [profile.models.model]
        : Object.values(profile.models.roles).flatMap((role) => [
            role.model,
            role.displayName,
          ])),
    ].some((value) => value.toLocaleLowerCase().includes(search));
  });
  return (
    <div
      className="flex w-full flex-col gap-3"
      data-testid="provider-profile-library"
    >
      {profiles.length > 0 && (
        <Input
          aria-label={t("providerLibrary.search")}
          placeholder={t("providerLibrary.search")}
          value={query}
          onChange={setQuery}
          disabled={disabled}
          allowClear
        />
      )}
      {profiles.length === 0 ? (
        <p className={SECTION_DESCRIPTION_CLASSES}>
          {t("claudeProfiles.empty")}
        </p>
      ) : visible.length === 0 ? (
        <p role="status" className={SECTION_DESCRIPTION_CLASSES}>
          {t("providerLibrary.noResults")}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visible.map((profile) => {
            const credential = view?.choices.find(
              (choice) => choice.keyId === profile.keyId
            );
            const active = view?.appliedProfile?.id === profile.id;
            const blocked =
              disabled ||
              !canConnect ||
              !credential ||
              Boolean(credential.reason);
            return (
              <div
                key={profile.id}
                role="group"
                aria-label={profile.name}
                data-testid={`provider-profile-${profile.id}`}
                className={`flex min-w-0 flex-col gap-3 rounded-xl border p-4 ${selected === profile.id ? "border-primary-6 bg-fill-2" : "border-border-2 bg-bg-2"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 font-medium break-words text-text-1">
                    {profile.name}
                  </span>
                  {active && (
                    <span className="text-xs text-success-6">
                      {t(
                        view?.appliedProfile?.revision === profile.revision
                          ? "claudeProfiles.active"
                          : "claudeProfiles.updatePending"
                      )}
                    </span>
                  )}
                  {testedProfileId === profile.id && (
                    <span className="text-xs text-primary-6">
                      {t("providerLibrary.tested")}
                    </span>
                  )}
                </div>
                <dl className="flex flex-col gap-1 text-xs text-text-2">
                  <div>
                    <dt className="inline text-text-3">
                      {t("claudeProfiles.credential")}:{" "}
                    </dt>
                    <dd className="inline break-words">
                      {credential?.name ?? t("harnessConnections.missingKey")}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-text-3">
                      {t("harnessConnections.endpoint")}:{" "}
                    </dt>
                    <dd className="inline break-all">{profile.endpoint}</dd>
                  </div>
                  <div>
                    <dt className="inline text-text-3">
                      {t("providerLibrary.defaultModel")}:{" "}
                    </dt>
                    <dd className="inline break-all">
                      {profileDefaultModel(profile)}
                    </dd>
                  </div>
                </dl>
                {credential?.reason && (
                  <p className="text-xs text-warning-6">{credential.reason}</p>
                )}
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={disabled}
                    onClick={() => onEdit(profile)}
                  >
                    {t("providerLibrary.edit")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={disabled}
                    onClick={() => onDuplicate(profile)}
                  >
                    {t("providerLibrary.duplicate")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="small"
                    disabled={blocked}
                    loading={selected === profile.id && busy === "test"}
                    onClick={() => onTest(profile)}
                  >
                    {t("claudeProfiles.test")}
                  </Button>
                  <Button
                    size="small"
                    disabled={blocked || testedProfileId !== profile.id}
                    loading={selected === profile.id && busy === "apply"}
                    onClick={() => onApply(profile)}
                  >
                    {t("harnessConnections.apply")}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
