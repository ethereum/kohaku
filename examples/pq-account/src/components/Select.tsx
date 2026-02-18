import type { ComponentProps } from "react";
import { twMerge } from "tailwind-merge";

export const Select = ({ className, ...props }: ComponentProps<"select">) => (
  <select
    className={twMerge(
      "w-full bg-bg-primary border border-border rounded-lg px-3 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-colors",
      className
    )}
    {...props}
  />
);
