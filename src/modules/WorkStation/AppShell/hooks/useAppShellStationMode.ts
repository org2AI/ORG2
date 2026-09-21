import { useAtomValue } from "jotai";

import { replayModeAtom } from "@src/engines/SessionCore";
import {
  type StationMode,
  simulatorSessionPlaybackPlayingAtom,
  stationModeAtom,
} from "@src/store/ui/simulatorAtom";

interface AppShellStationModeState {
  stationMode: StationMode;
  isAgentStation: boolean;
  illuminateAgentStationChrome: boolean;
}

export function useAppShellStationMode(): AppShellStationModeState {
  const stationMode = useAtomValue(stationModeAtom);
  const isAgentStation = stationMode === "agent-station";
  const replayMode = useAtomValue(replayModeAtom);
  const sessionPlaybackPlaying = useAtomValue(
    simulatorSessionPlaybackPlayingAtom
  );

  const illuminateAgentStationChrome =
    isAgentStation &&
    (replayMode === "follow" ||
      (replayMode === "replay" && sessionPlaybackPlaying));

  return {
    stationMode,
    isAgentStation,
    illuminateAgentStationChrome,
  };
}
