import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  PERMISSION_TIER,
  type PairingInitOutput,
  type PermissionTier,
  mobileRemoteApi,
} from "@src/api/tauri/mobileRemote";
import Button from "@src/components/Button";
import Message from "@src/components/Message";
import SegmentedTextPill from "@src/components/SegmentedTextPill";
import { SectionRow } from "@src/components/layout/Section";

import MobileRemoteOutdoorPairingDetails from "./MobileRemoteOutdoorPairingDetails";
import { suggestOutdoorPairingPhoneLabel } from "./pairedDeviceDisplay";

type PairingState =
  | { phase: "idle" }
  | { phase: "choosing"; tier: PermissionTier }
  | {
      phase: "generating";
      tier: PermissionTier;
      pairing: PairingInitOutput | null;
    }
  | {
      phase: "reviewing" | "confirming";
      tier: PermissionTier;
      pairing: PairingInitOutput;
    };

interface MobileRemotePairingFlowProps {
  available: boolean;
  onPaired: () => void;
}

/** The parent keys this workflow by account, relay URL and enabled settings. */
const MobileRemotePairingFlow: React.FC<MobileRemotePairingFlowProps> = ({
  available,
  onPaired,
}) => {
  const { t } = useTranslation(["settings", "common"]);
  const [state, setState] = useState<PairingState>({ phase: "idle" });
  const requestIdRef = useRef(0);
  // Synchronous lock also covers repeated clicks before React commits a render.
  const pendingRequestRef = useRef<"generating" | "confirming" | null>(null);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    []
  );

  const handleCancel = () => {
    // Confirmation has already sent an authorization request that cannot be undone.
    if (
      state.phase === "confirming" ||
      pendingRequestRef.current === "confirming"
    ) {
      return;
    }
    requestIdRef.current += 1;
    pendingRequestRef.current = null;
    setState({ phase: "idle" });
  };

  const handleGenerate = async () => {
    if (
      !available ||
      pendingRequestRef.current ||
      (state.phase !== "choosing" && state.phase !== "reviewing")
    ) {
      return;
    }
    const tier = state.tier;
    const previousPairing = state.phase === "reviewing" ? state.pairing : null;
    const requestId = ++requestIdRef.current;
    pendingRequestRef.current = "generating";
    setState({ phase: "generating", tier, pairing: previousPairing });
    try {
      const pairing = await mobileRemoteApi.pairInit({
        tier,
        label: suggestOutdoorPairingPhoneLabel(),
        isPrimary: true,
      });
      if (requestId !== requestIdRef.current) return;
      setState({ phase: "reviewing", tier, pairing });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState(
        previousPairing
          ? { phase: "reviewing", tier, pairing: previousPairing }
          : { phase: "choosing", tier }
      );
      Message.error({
        content: `${t("mobileRemote.pairingFailed")}: ${String(error)}`,
      });
    } finally {
      if (requestId === requestIdRef.current) {
        pendingRequestRef.current = null;
      }
    }
  };

  const handleConfirm = async () => {
    if (
      !available ||
      pendingRequestRef.current ||
      state.phase !== "reviewing"
    ) {
      return;
    }
    const { pairing, tier } = state;
    const requestId = ++requestIdRef.current;
    pendingRequestRef.current = "confirming";
    setState({ phase: "confirming", pairing, tier });
    try {
      await mobileRemoteApi.pairComplete({
        pairingCode: pairing.pairingCode,
        tier,
      });
      if (requestId !== requestIdRef.current) return;
      setState({ phase: "idle" });
      Message.success({ content: t("mobileRemote.pairingConfirmed") });
      onPaired();
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState({ phase: "reviewing", pairing, tier });
      Message.error({ content: String(error) });
    } finally {
      if (requestId === requestIdRef.current) {
        pendingRequestRef.current = null;
      }
    }
  };

  const pairing = "pairing" in state ? state.pairing : null;
  const permissionLocked = state.phase !== "choosing";

  return (
    <SectionRow layout="vertical" indent>
      {state.phase === "idle" ? (
        <Button
          variant="primary"
          disabled={!available}
          onClick={() =>
            setState({ phase: "choosing", tier: PERMISSION_TIER.FULL })
          }
        >
          {t("mobileRemote.addPhone")}
        </Button>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-text-2">
              {t("mobileRemote.pairingPermission")}
            </span>
            <SegmentedTextPill<PermissionTier>
              ariaLabel={t("mobileRemote.pairingPermission")}
              value={state.tier}
              options={[
                {
                  value: PERMISSION_TIER.FULL,
                  label: t("mobileRemote.deviceTierFull"),
                  disabled: permissionLocked,
                },
                {
                  value: PERMISSION_TIER.READ_ONLY,
                  label: t("mobileRemote.deviceTierReadOnly"),
                  disabled: permissionLocked,
                },
              ]}
              onChange={(tier) => {
                if (state.phase === "choosing" && !pendingRequestRef.current) {
                  setState({ phase: "choosing", tier });
                }
              }}
            />
          </div>
          {pairing ? (
            <>
              <p className="text-sm text-text-3">
                {t("mobileRemote.sasDesktopHint")}
              </p>
              <MobileRemoteOutdoorPairingDetails
                pairing={pairing}
                confirming={state.phase === "confirming"}
                regenerating={state.phase === "generating"}
                onConfirm={() => void handleConfirm()}
                onRegenerate={() => void handleGenerate()}
              />
            </>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {!pairing ? (
              <Button
                variant="primary"
                loading={state.phase === "generating"}
                disabled={!available || state.phase === "generating"}
                onClick={() => void handleGenerate()}
              >
                {t("mobileRemote.startOutdoorPairing")}
              </Button>
            ) : null}
            <Button
              variant="tertiary"
              disabled={state.phase === "confirming"}
              onClick={handleCancel}
            >
              {t("common:actions.cancel")}
            </Button>
          </div>
        </div>
      )}
    </SectionRow>
  );
};

export default MobileRemotePairingFlow;
