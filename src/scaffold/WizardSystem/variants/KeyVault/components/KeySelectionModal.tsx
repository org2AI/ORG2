/**
 * KeySelectionModal
 *
 * Modal for choosing between multiple detected keys (e.g., OAuth + API key).
 * Uses design system tokens for consistent theming.
 */
import React from "react";
import { useTranslation } from "react-i18next";

import type { DetectedKey, ModelType } from "@src/api/types/keys";
import PageNotice from "@src/components/PageNotice";
import {
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  HugeiconsIcon,
  Key01Icon,
  Key02Icon,
  Tick01Icon,
} from "@src/icons";
import { PanelFooter } from "@src/modules/shared/layouts/blocks";
import Modal from "@src/scaffold/ModalSystem";

import { findEndpointByBaseUrl, useProviderConfig } from "../config";

interface KeySelectionModalProps {
  keys: DetectedKey[];
  /** Provider the detected keys belong to — supplies the endpoint labels. */
  agentType: ModelType;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}

const KeySelectionModal: React.FC<KeySelectionModalProps> = ({
  keys,
  agentType,
  selectedIndex,
  onSelectIndex,
  onConfirm,
  onClose,
}) => {
  const { t } = useTranslation("integrations");
  const { config: providerConfig } = useProviderConfig(agentType);

  // Detected keys can come from different endpoints of the same provider
  // (OpenCode tiers, Zhipu regions and credential types). Name each target.
  const endpointLabel = (baseUrl?: string | null): string | null =>
    findEndpointByBaseUrl(providerConfig?.endpoints ?? [], baseUrl)?.label ??
    null;
  return (
    <Modal
      visible
      title={t("keyVault.quickActions.multipleKeysFound")}
      onClose={onClose}
      width={448}
      bodyClassName="p-0"
      footer={
        <PanelFooter
          secondaryActions={[
            { label: t("common:actions.cancel"), onClick: onClose },
          ]}
          primaryAction={{
            label: t("keyVault.quickActions.useSelected"),
            onClick: onConfirm,
            disabled: !keys[selectedIndex]?.validated,
          }}
        />
      }
    >
      {/* Body */}
      <div className="p-4">
        <p className="mb-4 text-[13px] text-text-2">
          {t("keyVault.keysFoundForAgent", {
            count: keys.length,
          })}
        </p>

        <div className="space-y-3">
          {keys.map((cred, index) => (
            <button
              key={cred.id}
              onClick={() => cred.validated && onSelectIndex(index)}
              disabled={!cred.validated}
              className={`w-full rounded-lg border p-4 text-left transition-all ${
                !cred.validated
                  ? "cursor-not-allowed border-dashed border-danger-3 bg-danger-1"
                  : selectedIndex === index
                    ? "border-primary-6 bg-primary-1"
                    : "border-border-2 bg-fill-2 hover:border-border-3 hover:bg-fill-1"
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Selection indicator */}
                {cred.validated ? (
                  selectedIndex === index ? (
                    <HugeiconsIcon
                      icon={Tick01Icon}
                      data-icon="check"
                      size={16}
                      className="mt-0.5 shrink-0 text-primary-6"
                    />
                  ) : (
                    <div className="mt-0.5 h-4 w-4 shrink-0" />
                  )
                ) : (
                  <HugeiconsIcon
                    icon={AlertCircleIcon}
                    data-icon="alert-circle"
                    size={16}
                    className="mt-0.5 shrink-0 text-danger-6"
                  />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {cred.auth_method === "oauth" ? (
                      <HugeiconsIcon
                        icon={Key02Icon}
                        data-icon="key-round"
                        size={16}
                        className={
                          cred.validated ? "text-primary-6" : "text-danger-6"
                        }
                      />
                    ) : (
                      <HugeiconsIcon
                        icon={Key01Icon}
                        data-icon="key"
                        size={16}
                        className={
                          cred.validated ? "text-success-6" : "text-danger-6"
                        }
                      />
                    )}
                    <span
                      className={`text-[14px] font-medium ${cred.validated ? "text-text-1" : "text-danger-6"}`}
                    >
                      {cred.auth_method === "oauth"
                        ? "OAuth"
                        : t("keyVault.apiKeyLabel")}
                    </span>
                    {/* Validation status badge */}
                    {endpointLabel(cred.base_url) && (
                      <span className="rounded-full bg-fill-3 px-2 py-0.5 text-[10px] text-text-2">
                        {endpointLabel(cred.base_url)}
                      </span>
                    )}
                    {cred.validated === true ? (
                      <span className="flex items-center gap-1 rounded-full bg-success-1 px-2 py-0.5 text-[10px] text-success-6">
                        <HugeiconsIcon
                          icon={CheckmarkCircle01Icon}
                          data-icon="check-circle"
                          size={10}
                        />
                        {t("keyVault.quickActions.valid")}
                      </span>
                    ) : cred.validated === false ? (
                      <span className="flex items-center gap-1 rounded-full bg-danger-1 px-2 py-0.5 text-[10px] font-medium text-danger-6">
                        <HugeiconsIcon
                          icon={AlertCircleIcon}
                          data-icon="alert-circle"
                          size={10}
                        />
                        {t("keyVault.quickActions.invalid")}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={`mt-1 text-[12px] ${cred.validated ? "text-text-3" : "text-danger-6/70"}`}
                  >
                    {cred.auth_method === "oauth" ? (
                      <>
                        {cred.quota_info?.plan_type && (
                          <span className="mr-2">
                            {t("keyVault.quickActions.planType", {
                              plan: cred.quota_info.plan_type,
                            })}
                          </span>
                        )}
                        {typeof cred.quota_info?.remaining_percentage ===
                          "number" && (
                          <span className="text-success-6">
                            {t("keyVault.quickActions.percentRemaining", {
                              percent: Math.round(
                                cred.quota_info.remaining_percentage
                              ),
                            })}
                          </span>
                        )}
                        {!cred.quota_info?.plan_type &&
                          !cred.quota_info?.remaining_percentage && (
                            <span>{t("keyVault.fromCodexAuthLogin")}</span>
                          )}
                      </>
                    ) : (
                      <>
                        {cred.api_key && (
                          <span>
                            {cred.api_key.slice(0, 8)}...
                            {cred.api_key.slice(-4)}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {cred.validated === false && cred.validation_message && (
                    <PageNotice type="danger">
                      {cred.validation_message}
                    </PageNotice>
                  )}
                  {cred.validated &&
                    cred.available_models &&
                    cred.available_models.length > 0 && (
                      <div className="mt-2 text-[11px] text-text-3">
                        {t("keyVault.quickActions.modelsAvailable", {
                          count: cred.available_models.length,
                        })}
                      </div>
                    )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
};

export default KeySelectionModal;
