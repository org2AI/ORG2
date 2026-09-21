import React from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";

import onboardingImage from "@src/assets/illustrations/onboarding.png";
import ActionCard from "@src/components/ActionCard";
import Illustration from "@src/components/Illustration";
import { BookOpen01Icon } from "@src/icons";
import Modal from "@src/scaffold/ModalSystem";
import { GUIDE_TARGETS } from "@src/scaffold/Tutorials/guideTargets";
import { TUTORIALS } from "@src/scaffold/Tutorials/tutorialRegistry";
import { openLink } from "@src/util/ui/openLink";

import { ORG2_WIKI_URL } from "./wikiEvents";

const SECTION_TITLE_CLASS_NAME = "text-sm font-semibold text-text-1";

interface WikiModalProps {
  open: boolean;
  onClose: () => void;
  /** Guided tours are still a development-only surface. */
  showTutorials: boolean;
}

/**
 * The Wiki dialog: the hosted wiki and, in dev mode, the guided tours. Product
 * actions the tours drive retain their existing state owners.
 */
export default function WikiModal({
  open,
  onClose,
  showTutorials,
}: WikiModalProps) {
  const { t } = useTranslation("onboarding");
  const runAction = (action: () => void) => {
    // Release the focus trap and native overlay before a card opens its destination.
    flushSync(onClose);
    action();
  };

  return (
    <Modal
      visible={open}
      onCancel={onClose}
      title="Wiki"
      headerMedia={
        <Illustration src={onboardingImage} className="liquid-modal-image" />
      }
      footer={null}
      width={720}
    >
      <div
        className="flex flex-col gap-6"
        data-guide-target={GUIDE_TARGETS.TUTORIALS_MODAL}
        data-testid="wiki-modal"
      >
        <section
          aria-labelledby="wiki-section-title"
          className="flex flex-col gap-3"
          data-testid="wiki-section-wiki"
        >
          <h2 id="wiki-section-title" className={SECTION_TITLE_CLASS_NAME}>
            Wiki
          </h2>
          <ActionCard
            title="github.com/org2AI/ORG2/wiki"
            icon={BookOpen01Icon}
            onClick={() =>
              runAction(() => openLink(ORG2_WIKI_URL, { navigate: true }))
            }
            showArrow
            dataTestId="wiki-open-link"
          />
        </section>
        {showTutorials && (
          <section
            aria-labelledby="wiki-start-title"
            className="flex flex-col gap-3"
            data-testid="wiki-section-tutorials"
          >
            <h2 id="wiki-start-title" className={SECTION_TITLE_CLASS_NAME}>
              {t("discovery.getStarted")}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TUTORIALS.map((tutorial) => (
                <ActionCard
                  key={tutorial.id}
                  title={t(tutorial.titleKey)}
                  description={t(tutorial.descriptionKey)}
                  badge={t(tutorial.durationKey)}
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
        )}
      </div>
    </Modal>
  );
}
