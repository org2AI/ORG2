import {
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  cloneElement,
  useId,
} from "react";

import Form from "@src/components/Form";

interface ControlProps {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}
interface SpotlightFormFieldProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  label: ReactNode;
  children: ReactElement<ControlProps>;
  required?: boolean;
  help?: ReactNode;
  error?: boolean;
  className?: string;
}

/** Associated label and help text for one shared form control; never creates a nested form. */
export function SpotlightFormField({
  label,
  children,
  required,
  help,
  error,
  className,
  ...props
}: SpotlightFormFieldProps) {
  const generatedId = useId();
  const id = children.props.id ?? generatedId;
  const helpId = help ? `${id}-help` : undefined;
  const describedBy =
    [children.props["aria-describedby"], helpId].filter(Boolean).join(" ") ||
    undefined;
  return (
    <Form.Item
      {...props}
      presentation="compact"
      htmlFor={id}
      label={label}
      required={required}
      help={help}
      helpId={helpId}
      validateStatus={error ? "error" : undefined}
      className={className}
    >
      {cloneElement(children, {
        id,
        required: required ?? children.props.required,
        "aria-describedby": describedBy,
        "aria-invalid": error || children.props["aria-invalid"],
      })}
    </Form.Item>
  );
}
