import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: "primary" | "ghost";
};

export function Button({
  children,
  variant = "primary",
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  const variantClass =
    variant === "primary" ? "prism-btn prism-btn-primary" : "prism-btn prism-btn-ghost";

  return (
    <button type={type} className={`${variantClass} ${className}`.trim()} {...rest}>
      {children}
    </button>
  );
}
