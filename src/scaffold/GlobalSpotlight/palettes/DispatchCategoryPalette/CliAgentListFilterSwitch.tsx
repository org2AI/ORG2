import SegmentedTextPill from "@src/components/SegmentedTextPill";
import { CLI_LAUNCH_MODE, type CliLaunchMode } from "@src/store/session";

interface CliAgentListFilterSwitchProps {
  mode: CliLaunchMode;
  onModeChange: (mode: CliLaunchMode) => void;
  className?: string;
}

export function CliAgentListFilterSwitch({
  mode,
  onModeChange,
  className,
}: CliAgentListFilterSwitchProps) {
  return (
    <SegmentedTextPill
      ariaLabel="GUI / TUI"
      value={mode}
      onChange={onModeChange}
      className={className}
      options={[
        { value: CLI_LAUNCH_MODE.GUI, label: "GUI" },
        { value: CLI_LAUNCH_MODE.TUI, label: "TUI" },
      ]}
    />
  );
}
