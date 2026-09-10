import React, { useCallback } from "react";

import Input, { type InputProps } from "@src/components/Input";
import type { ControlAppearance } from "@src/components/controlAppearance";

interface TimePickerProps {
  mode?: "time";
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  minuteStep?: number;
  disabled?: boolean;
  className?: string;
  appearance?: ControlAppearance;
}

function formatTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const [hourPart, minutePart] = value.split(":");
  const parsedHour = Number(hourPart);
  const parsedMinute = Number(minutePart);

  if (
    !Number.isInteger(parsedHour) ||
    !Number.isInteger(parsedMinute) ||
    parsedHour < 0 ||
    parsedHour > 23 ||
    parsedMinute < 0 ||
    parsedMinute > 59
  ) {
    return null;
  }

  return { hour: parsedHour, minute: parsedMinute };
}

interface DateTimePickerProps extends Omit<InputProps, "type" | "step"> {
  mode: "datetime";
  /** Hours by default; opt into minutes. Seconds are never shown. */
  precision?: "hour" | "minute";
}

const TimeOnlyPicker: React.FC<TimePickerProps> = ({
  hour,
  minute,
  onChange,
  minuteStep = 5,
  disabled = false,
  className = "",
  appearance = "default",
}) => {
  const handleTimeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = parseTime(event.target.value);
      if (!parsed) return;
      onChange(parsed.hour, parsed.minute);
    },
    [onChange]
  );

  return (
    <Input
      size="small"
      appearance={appearance}
      inputClassName="scheme-light-dark tabular-nums"
      type="time"
      value={formatTime(hour, minute)}
      onChange={(_, event) => handleTimeChange(event)}
      disabled={disabled}
      step={minuteStep * 60}
      className={className}
    />
  );
};

export default function TimePicker(
  props: TimePickerProps | DateTimePickerProps
) {
  if (props.mode !== "datetime") return <TimeOnlyPicker {...props} />;
  const { mode: _mode, precision = "hour", value, onChange, ...rest } = props;
  const normalize = (next: string) =>
    next
      ? `${next.slice(0, 13)}:${precision === "hour" ? "00" : next.slice(14, 16)}`
      : "";
  return (
    <Input
      {...rest}
      type="datetime-local"
      step={precision === "hour" ? 3600 : 60}
      inputClassName="scheme-light-dark tabular-nums"
      value={value === undefined ? undefined : normalize(value)}
      onChange={(next, event) => onChange?.(normalize(next), event)}
    />
  );
}
