import { useAtomValue } from "jotai";
import React, { useEffect, useState } from "react";

import { TUTORIALS_OPEN_EVENT } from "@src/scaffold/Tutorials/tutorialRegistry";
import { devModeEnabledAtom } from "@src/store/platform/devModeAtom";

import OnboardingModal from "./OnboardingModal";

function DevOnboarding() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(TUTORIALS_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(TUTORIALS_OPEN_EVENT, handleOpen);
  }, []);
  return <OnboardingModal open={open} onClose={() => setOpen(false)} />;
}

/** Unmounting resets the dialog and removes its event listener when dev mode ends. */
export default function OnboardingHost() {
  const enabled = useAtomValue(devModeEnabledAtom);
  return enabled ? <DevOnboarding /> : null;
}
