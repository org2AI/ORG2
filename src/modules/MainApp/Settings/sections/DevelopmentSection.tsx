import DevMockScenarioControls from "@src/features/DevMockScenarios/DevMockScenarioControls";

import IllustrationPreview from "./IllustrationPreview";

export default function DevelopmentSection({
  activeTab,
}: {
  activeTab?: string;
}) {
  if (process.env.NODE_ENV !== "development") return null;

  if (activeTab === "illustrations") return <IllustrationPreview />;

  // Same controls the ⇧⌘D dev mock modal renders — see
  // `@src/scaffold/ModalSystem/variants/DevMockScenarios`.
  return <DevMockScenarioControls />;
}
