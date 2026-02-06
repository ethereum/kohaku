import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const input = tv({
  base: "w-full bg-bg-primary border border-border rounded-lg px-3 py-2.5 font-mono text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-colors",
  variants: {
    hasPlaceholder: {
      true: "placeholder:text-text-muted",
    },
  },
});

export const Input = ({
  className,
  placeholder,
  ...props
}: ComponentProps<"input">) => (
  <input
    className={input({ hasPlaceholder: !!placeholder, className })}
    placeholder={placeholder}
    {...props}
  />
);
