import type { ComponentProps } from "react";
import { tv, type VariantProps } from "tailwind-variants";

const button = tv({
  base: "font-medium text-sm rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed",
  variants: {
    variant: {
      primary: "bg-accent hover:bg-accent-hover text-white active:scale-[0.99]",
      secondary:
        "bg-bg-tertiary hover:bg-bg-primary border border-border hover:border-border-hover text-text-primary active:scale-[0.99]",
    },
    size: {
      default: "py-3 px-6",
      sm: "py-2.5 px-6",
    },
    fullWidth: {
      true: "w-full",
    },
  },
  defaultVariants: {
    variant: "primary",
    size: "default",
    fullWidth: false,
  },
});

type ButtonProps = ComponentProps<"button"> & VariantProps<typeof button>;

export const Button = ({
  className,
  variant,
  size,
  fullWidth,
  ...props
}: ButtonProps) => (
  <button
    className={button({ variant, size, fullWidth, className })}
    {...props}
  />
);
