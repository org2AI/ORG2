import React from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";

import ActionCard from "@src/components/ActionCard";
import {
  openCollabOrgSpotlight,
  openSessionCreatorSpotlight,
  openWorkingDirectorySpotlight,
} from "@src/scaffold/GlobalSpotlight/openSpotlight";
import Modal from "@src/scaffold/ModalSystem";
import { GUIDE_TARGETS } from "@src/scaffold/Tutorials/guideTargets";
import { TUTORIALS } from "@src/scaffold/Tutorials/tutorialRegistry";

import { FEATURE_UPDATES } from "./featureUpdates";

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

/** Optional discovery cards. Product actions retain their existing state owners. */
export default function OnboardingModal({
  open,
  onClose,
}: OnboardingModalProps) {
  const { t } = useTranslation(["onboarding", "navigation", "common"]);
  const runAction = (action: () => void) => {
    // Release the focus trap and native overlay before a card opens its destination.
    flushSync(onClose);
    action();
  };

  return (
    <Modal
      visible={open}
      onCancel={onClose}
      title={t("onboarding:discovery.title")}
      footer={null}
      width={720}
      bodyClassName="p-4"
    >
      <div
        className="flex flex-col gap-6"
        data-guide-target={GUIDE_TARGETS.TUTORIALS_MODAL}
        data-testid="onboarding-modal"
      >
        <section
          aria-labelledby="onboarding-start-title"
          className="flex flex-col gap-3"
        >
          <h2
            id="onboarding-start-title"
            className="text-sm font-semibold text-text-1"
          >
            {t("onboarding:discovery.getStarted")}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ActionCard
              title={t("navigation:sidebar.guide.startSession")}
              onClick={() => runAction(openSessionCreatorSpotlight)}
              showArrow
              dataTestId="onboarding-start-session"
            />
            <ActionCard
              title={t(
                "common:selectors.spotlight.actions.switchWorkspace.label"
              )}
              onClick={() =>
                runAction(() => openWorkingDirectorySpotlight("switch"))
              }
              showArrow
              dataTestId="onboarding-working-directories"
            />
            <ActionCard
              title={t("navigation:sidebar.guide.connectOrganization")}
              onClick={() => runAction(() => openCollabOrgSpotlight())}
              showArrow
              dataTestId="onboarding-workspace"
            />
            {TUTORIALS.map((tutorial) => (
              <ActionCard
                key={tutorial.id}
                title={t(`onboarding:${tutorial.titleKey}`)}
                description={t(`onboarding:${tutorial.descriptionKey}`)}
                badge={t(`onboarding:${tutorial.durationKey}`)}
                onClick={() =>
                  runAction(() =>
                    window.dispatchEvent(new CustomEvent(tutorial.eventName))
                  )
                }
                showArrow
                dataTestId={`onboarding-tour-${tutorial.id}`}
              />
            ))}
          </div>
        </section>
        <section
          aria-labelledby="onboarding-features-title"
          className="flex flex-col gap-3"
        >
          <h2
            id="onboarding-features-title"
            className="text-sm font-semibold text-text-1"
          >
            {t("onboarding:discovery.newFeatures")}
          </h2>
          {FEATURE_UPDATES.map((feature) => (
            <ActionCard
              key={feature.id}
              title={t(`onboarding:${feature.titleKey}`)}
              description={t(`onboarding:${feature.descriptionKey}`)}
              onClick={() => runAction(feature.onOpen)}
              showArrow
              dataTestId={`onboarding-feature-${feature.id}`}
            />
          ))}
        </section>
      </div>
    </Modal>
  );
}
