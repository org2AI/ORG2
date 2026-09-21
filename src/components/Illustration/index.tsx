import "./index.scss";

/** Decorative monochrome artwork; surrounding copy conveys its meaning. */
export default function Illustration({
  src,
  className = "",
  theme,
  loading,
}: {
  src: string;
  className?: string;
  /** Local preview override; omitted in normal app surfaces. */
  theme?: "light" | "dark";
  loading?: "lazy" | "eager";
}) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      data-illustration-theme={theme}
      loading={loading}
      className={`app-illustration ${className}`}
    />
  );
}
