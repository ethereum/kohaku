import { Link } from "@tanstack/react-router";
import { tv } from "tailwind-variants";

const tabLink = tv({
  base: "px-4 py-2 text-sm font-medium transition-colors rounded-md",
  variants: {
    active: {
      true: "bg-bg-secondary text-text-primary shadow-sm",
      false: "text-text-secondary hover:text-text-primary",
    },
  },
  defaultVariants: {
    active: false,
  },
});

const TABS = [
  { to: "/create", label: "Create Account" },
  { to: "/send", label: "Send Transaction" },
  { to: "/aave", label: "Aave DeFi" },
] as const;

export const Tabs = () => {
  return (
    <div className="inline-flex gap-2 mb-6 bg-bg-tertiary p-1 rounded-lg border border-border">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={tabLink({ active: false })}
          activeProps={{
            className: tabLink({ active: true }),
          }}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
};
