/**
 * Commit message input shared by every `CommitControls` branch when the
 * message is shown (the modal). Placeholder and accessible label diverge
 * only while a merge is in progress.
 */
import Textarea from "@src/components/Textarea";

// TODO: Re-enable when a reliable LLM provider is wired up
const sparkleButton = null;

export function CommitMessageField({
  ariaLabel,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <div className="relative mb-2">
      <Textarea
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        autoFocus
        aria-label={ariaLabel}
        rows={2}
        className="textarea-pane-surface text-[13px]"
      />
      {sparkleButton}
    </div>
  );
}
