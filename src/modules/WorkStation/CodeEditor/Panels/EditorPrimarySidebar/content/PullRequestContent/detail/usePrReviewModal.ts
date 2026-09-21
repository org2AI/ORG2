import { useCallback, useState } from "react";

import type { PrReviewEvent } from "@src/api/tauri/github";
import type { RadioValue } from "@src/components/Radio";

interface UsePrReviewModalOptions {
  submittingReview: boolean;
  onSubmitReview: (event: PrReviewEvent, body: string) => Promise<void>;
}

/** Whole-PR review modal state: visibility, decision, body and submission. */
export function usePrReviewModal({
  submittingReview,
  onSubmitReview,
}: UsePrReviewModalOptions) {
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewDecision, setReviewDecision] =
    useState<PrReviewEvent>("COMMENT");
  const [reviewBody, setReviewBody] = useState("");

  const resetReviewModal = useCallback(() => {
    setReviewDecision("COMMENT");
    setReviewBody("");
  }, []);

  const closeReviewModal = useCallback(() => {
    if (submittingReview) return;
    setReviewModalVisible(false);
    resetReviewModal();
  }, [resetReviewModal, submittingReview]);

  const handleReviewDecisionChange = useCallback((value: RadioValue) => {
    setReviewDecision(value as PrReviewEvent);
  }, []);

  const handleReview = useCallback(async () => {
    const body = reviewBody.trim();
    if (
      submittingReview ||
      (reviewDecision !== "APPROVE" && body.length === 0)
    ) {
      return;
    }
    await onSubmitReview(reviewDecision, body);
    setReviewModalVisible(false);
    resetReviewModal();
  }, [
    onSubmitReview,
    resetReviewModal,
    reviewBody,
    reviewDecision,
    submittingReview,
  ]);

  const reviewBodyRequired = reviewDecision !== "APPROVE";
  const submitReviewDisabled =
    submittingReview || (reviewBodyRequired && !reviewBody.trim());

  return {
    reviewModalVisible,
    setReviewModalVisible,
    reviewDecision,
    reviewBody,
    setReviewBody,
    closeReviewModal,
    handleReviewDecisionChange,
    handleReview,
    submitReviewDisabled,
  };
}
