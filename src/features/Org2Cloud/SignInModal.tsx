import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import LoginFailureArtwork from "@src/assets/illustrations/login-failure.png";
import LoginSuccessArtwork from "@src/assets/illustrations/login-success.png";
import LoginWaitingArtwork from "@src/assets/illustrations/login-waiting.png";
import Illustration from "@src/components/Illustration";
import Modal from "@src/scaffold/ModalSystem";

import { SignInFeatures } from "./SignInFeatures";
import { org2CloudAuthAtom } from "./org2CloudAuthAtom";

const AUTH_SUCCESS_CLOSE_DELAY_MS = 30_000;

type SignInStage = "ready" | "waiting" | "failure";

export function SignInModal({
  onClose,
  onSignIn,
}: {
  onClose: () => void;
  onSignIn?: () => void | Promise<unknown>;
}) {
  const { t } = useTranslation(["navigation", "common", "auth"]);
  const auth = useAtomValue(org2CloudAuthAtom);
  const [stage, setStage] = useState<SignInStage>("ready");
  const displayStage = stage === "waiting" && auth !== null ? "success" : stage;

  useEffect(() => {
    if (displayStage !== "success") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleClose = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "hidden") {
        timer = setTimeout(onClose, AUTH_SUCCESS_CLOSE_DELAY_MS);
      }
    };
    scheduleClose();
    document.addEventListener("visibilitychange", scheduleClose);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", scheduleClose);
    };
  }, [displayStage, onClose]);

  const isWaiting = displayStage === "waiting";
  const isSuccess = displayStage === "success";
  const isFailure = displayStage === "failure";
  // Keep the frame and decoded images mounted across stages. Only the
  // visibility changes, so the modal's entrance animation never restarts.
  const headerMedia = (
    <div className="liquid-modal-image relative overflow-hidden">
      {displayStage === "ready" && <SignInFeatures />}
      {(
        [
          ["waiting", LoginWaitingArtwork],
          ["success", LoginSuccessArtwork],
          ["failure", LoginFailureArtwork],
        ] as const
      ).map(([imageStage, src]) => (
        <Illustration
          key={imageStage}
          src={src}
          className={`absolute inset-0 h-full w-full object-contain ${displayStage === imageStage ? "visible" : "invisible"}`}
        />
      ))}
    </div>
  );

  return (
    <Modal
      visible
      size="medium"
      // State artwork is absolutely positioned, so it cannot size the dialog.
      // Keep the initial carousel and all auth stages on the same media frame.
      width={600}
      headerMedia={headerMedia}
      title={
        isSuccess
          ? t("auth:loading.success")
          : isWaiting
            ? t("auth:loading.waiting")
            : isFailure
              ? t("auth:loading.failed")
              : t("cloud.signInModalTitle")
      }
      onCancel={onClose}
      onOk={async () => {
        if (isSuccess) return onClose();
        if (isWaiting) return;
        setStage("waiting");
        try {
          const result = await onSignIn?.();
          if (result === false) setStage("failure");
        } catch {
          setStage("failure");
        }
      }}
      okText={isSuccess ? t("common:actions.continue") : t("cloud.signIn")}
      cancelText={t("common:actions.cancel")}
      okButtonProps={{ loading: isWaiting }}
      closable={false}
      maskClosable={false}
    >
      <p role="status" aria-live="polite" className="text-sm text-text-2">
        {isSuccess ? t("cloud.signedInToast") : t("cloud.signInModalBody")}
      </p>
    </Modal>
  );
}
