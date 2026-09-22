import React from "react";
import { useTranslation } from "react-i18next";

import type { PrReviewEvent } from "@src/api/tauri/github";
import Radio from "@src/components/Radio";
import type { RadioValue } from "@src/components/Radio";
import Textarea from "@src/components/Textarea";
import Modal from "@src/scaffold/ModalSystem";

interface PrReviewModalProps {
  reviewModalVisible: boolean;
  closeReviewModal: () => void;
  handleReview: () => Promise<void>;
  submittingReview: boolean;
  submitReviewDisabled: boolean;
  reviewDecision: PrReviewEvent;
  handleReviewDecisionChange: (value: RadioValue) => void;
  reviewBody: string;
  setReviewBody: (value: string) => void;
}

/** Whole-PR review dialog: head-commit notice, decision and comment body. */
export function PrReviewModal({
  reviewModalVisible,
  closeReviewModal,
  handleReview,
  submittingReview,
  submitReviewDisabled,
  reviewDecision,
  handleReviewDecisionChange,
  reviewBody,
  setReviewBody,
}: PrReviewModalProps): React.ReactNode {
  const { t } = useTranslation("common");

  return (
    <Modal
      visible={reviewModalVisible}
      title={t("git.pr.submitReview")}
      width={640}
      bodyClassName="p-0"
      okText={t("git.pr.submitReview")}
      cancelText={t("actions.cancel")}
      onCancel={closeReviewModal}
      onOk={handleReview}
      closable={!submittingReview}
      maskClosable={!submittingReview}
      escToExit={!submittingReview}
      okButtonProps={{
        loading: submittingReview,
        disabled: submitReviewDisabled,
      }}
      cancelButtonProps={{ disabled: submittingReview }}
    >
      <div
        className="flex flex-col gap-4 p-3"
        data-testid="pr-review-modal-body"
      >
        <p className="text-[13px] leading-5 text-text-3">
          {t("git.pr.reviewHeadNotice")}
        </p>

        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="sr-only">{t("git.pr.reviewDecision")}</legend>
          <div data-testid="pr-review-decision-row">
            <Radio.Group
              value={reviewDecision}
              onChange={handleReviewDecisionChange}
              disabled={submittingReview}
              direction="horizontal"
              size="small"
              className="flex-wrap gap-x-5 gap-y-2"
            >
              <Radio value="COMMENT">{t("git.pr.comment")}</Radio>
              <Radio value="APPROVE">{t("git.pr.approve")}</Radio>
              <Radio value="REQUEST_CHANGES">
                {t("git.pr.requestChanges")}
              </Radio>
            </Radio.Group>
          </div>
        </fieldset>

        <label
          htmlFor="pr-review-comment"
          className="block"
          data-testid="pr-review-comment-row"
        >
          <span className="sr-only">{t("git.pr.reviewComment")}</span>
          <Textarea
            id="pr-review-comment"
            data-testid="pr-review-comment"
            value={reviewBody}
            onChange={setReviewBody}
            placeholder={t("git.pr.reviewCommentPlaceholder")}
            autoSize={{ minRows: 4, maxRows: 8 }}
            resize="none"
            disabled={submittingReview}
          />
        </label>
      </div>
    </Modal>
  );
}
