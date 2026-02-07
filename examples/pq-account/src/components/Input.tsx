import type { ComponentProps } from "react";
import { twMerge } from "tailwind-merge";

export const Input = ({ className, ...props }: ComponentProps<"input">) => (
  <input
    className={twMerge(
      "w-full bg-bg-primary border border-border rounded-lg px-3 py-2.5 font-mono text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-colors",
      className
    )}
    {...props}
  />
);
