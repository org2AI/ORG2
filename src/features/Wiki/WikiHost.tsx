import { useAtomValue } from "jotai";
import React, { useEffect, useState } from "react";

import { devModeEnabledAtom } from "@src/store/platform/devModeAtom";

import WikiModal from "./WikiModal";
import { WIKI_OPEN_EVENT } from "./wikiEvents";

/** Listens for the sidebar's Wiki entry; dev mode only adds the tours tab. */
export default function WikiHost() {
  const [open, setOpen] = useState(false);
  const devModeEnabled = useAtomValue(devModeEnabledAtom);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener(WIKI_OPEN_EVENT, handleOpen);
    return () => window.removeEventListener(WIKI_OPEN_EVENT, handleOpen);
  }, []);

  return (
    <WikiModal
      open={open}
      onClose={() => setOpen(false)}
      showTutorials={devModeEnabled}
    />
  );
}
