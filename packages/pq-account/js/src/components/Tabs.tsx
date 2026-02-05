import { Link } from "@tanstack/react-router";

export const Tabs = () => {
  return (
    <div className="inline-flex gap-2 mb-6 bg-bg-tertiary p-1 rounded-lg border border-border">
      <Link
        to="/create"
        className="px-4 py-2 text-sm font-medium transition-colors rounded-md"
        activeProps={{
          className: "bg-bg-secondary text-text-primary shadow-sm",
        }}
        inactiveProps={{
          className: "text-text-secondary hover:text-text-primary",
        }}
      >
        Create Account
      </Link>
      <Link
        to="/send"
        className="px-4 py-2 text-sm font-medium transition-colors rounded-md"
        activeProps={{
          className: "bg-bg-secondary text-text-primary shadow-sm",
        }}
        inactiveProps={{
          className: "text-text-secondary hover:text-text-primary",
        }}
      >
        Send Transaction
      </Link>
    </div>
  );
};
