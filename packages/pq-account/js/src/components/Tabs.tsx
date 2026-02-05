/* eslint-disable sonarjs/no-duplicate-string */
import { Link } from "@tanstack/react-router";

const INACTIVE_TAB_CLASS = "text-text-secondary hover:text-text-primary";
const LINK_BASE_CLASS =
  "px-4 py-2 text-sm font-medium transition-colors rounded-md";

export const Tabs = () => {
  return (
    <div className="inline-flex gap-2 mb-6 bg-bg-tertiary p-1 rounded-lg border border-border">
      <Link
        to="/create"
        className={LINK_BASE_CLASS}
        activeProps={{
          className: "bg-bg-secondary text-text-primary shadow-sm",
        }}
        inactiveProps={{
          className: INACTIVE_TAB_CLASS,
        }}
      >
        Create Account
      </Link>
      <Link
        to="/send"
        className={LINK_BASE_CLASS}
        activeProps={{
          className: "bg-bg-secondary text-text-primary shadow-sm",
        }}
        inactiveProps={{
          className: INACTIVE_TAB_CLASS,
        }}
      >
        Send Transaction
      </Link>
      <Link
        to="/aave"
        className={LINK_BASE_CLASS}
        activeProps={{
          className: "bg-bg-secondary text-text-primary shadow-sm",
        }}
        inactiveProps={{
          className: INACTIVE_TAB_CLASS,
        }}
      >
        Aave DeFi
      </Link>
    </div>
  );
};
