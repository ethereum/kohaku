import { tv } from "tailwind-variants";
import { match, P } from "ts-pattern";

import type { AavePosition } from "../config/aave";

type Props = {
  position: AavePosition | undefined;
  isRefreshing: boolean;
  onRefresh: () => void;
};

const healthFactorText = tv({
  base: "font-mono text-lg font-semibold",
  variants: {
    status: {
      safe: "text-green-400",
      danger: "text-red-400",
      normal: "text-text-primary",
    },
  },
  defaultVariants: {
    status: "normal",
  },
});

export const AavePositionDisplay = ({
  position,
  isRefreshing,
  onRefresh,
}: Props) => {
  const getHealthFactorStatus = () => {
    return match(position?.healthFactor)
      .with(
        P.union(
          "Infinity",
          P.when((n) => typeof n === "number" && n > 2)
        ),
        () => "safe" as const
      )
      .with(
        P.when((n) => typeof n === "number" && n < 1.1),
        () => "danger" as const
      )
      .otherwise(() => "normal" as const);
  };

  const formatHealthFactor = () => {
    return match(position?.healthFactor)
      .with(undefined, () => "—")
      .with("Infinity", () => "∞")
      .with(P.number, (n) => n.toFixed(2))
      .otherwise(() => "—");
  };

  return (
    <div className="bg-bg-secondary border border-border rounded-lg p-6 mb-4">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-base font-semibold text-text-primary">
          Your Aave Position
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
        >
          <svg
            className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-bg-tertiary border border-border rounded-lg p-4 text-center">
          <div className="text-xs text-text-muted uppercase tracking-wide mb-2">
            Total Supplied
          </div>
          <div className="font-mono text-lg font-semibold text-green-400">
            ${position?.totalCollateralUSD.toFixed(2) ?? "0.00"}
          </div>
        </div>
        <div className="bg-bg-tertiary border border-border rounded-lg p-4 text-center">
          <div className="text-xs text-text-muted uppercase tracking-wide mb-2">
            Total Borrowed
          </div>
          <div className="font-mono text-lg font-semibold text-red-400">
            ${position?.totalDebtUSD.toFixed(2) ?? "0.00"}
          </div>
        </div>
        <div className="bg-bg-tertiary border border-border rounded-lg p-4 text-center">
          <div className="text-xs text-text-muted uppercase tracking-wide mb-2">
            Health Factor
          </div>
          <div
            className={healthFactorText({ status: getHealthFactorStatus() })}
          >
            {formatHealthFactor()}
          </div>
        </div>
      </div>

      {position &&
        (position.supplies.length > 0 || position.borrows.length > 0) && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-2">
                Supplied Assets
              </div>
              <div className="space-y-1">
                {position.supplies.length > 0 ? (
                  position.supplies.map((s) => (
                    <div
                      key={s.symbol}
                      className="flex justify-between items-center bg-bg-primary border border-border rounded px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{s.symbol}</span>
                      <span className="font-mono text-green-400">
                        {s.amount.toFixed(5)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-text-muted italic">
                    No supplies
                  </div>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-text-muted uppercase tracking-wide mb-2">
                Borrowed Assets
              </div>
              <div className="space-y-1">
                {position.borrows.length > 0 ? (
                  position.borrows.map((b) => (
                    <div
                      key={b.symbol}
                      className="flex justify-between items-center bg-bg-primary border border-border rounded px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{b.symbol}</span>
                      <span className="font-mono text-red-400">
                        {b.amount.toFixed(5)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-text-muted italic">
                    No borrows
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
};
