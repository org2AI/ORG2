import Button, { type ButtonProps } from "@src/components/Button";

/** Selectable cards own multiline content and padding. The normal action-button
 * layout adds a single-line label wrapper and inline sizing, which clips cards. */
export default function ConnectionChoiceCard({
  children,
  ...props
}: Pick<ButtonProps, "children" | "disabled" | "aria-pressed" | "onClick">) {
  return (
    <Button
      {...props}
      layout="custom"
      className="flex w-full min-w-0 items-start rounded-md border border-border-2 bg-bg-2 p-3 text-left text-sm whitespace-normal text-text-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-6 enabled:hover:border-border-3 disabled:cursor-not-allowed disabled:opacity-50 aria-pressed:border-primary-6 aria-pressed:text-primary-6"
    >
      {children}
    </Button>
  );
}
