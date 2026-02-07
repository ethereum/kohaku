import { Field, useForm, useStore } from "@tanstack/react-form";
import { useEffect, useState } from "react";
import { tv } from "tailwind-variants";
import { match } from "ts-pattern";
import { useConnection } from "wagmi";

import { AAVE_CONFIG } from "../config/aave";
import {
  useAaveBorrow,
  useAaveFaucet,
  useAaveRepay,
  useAaveSupply,
  useAaveWithdraw,
  useTokenApproval,
} from "../hooks/useAaveOperations";
import { useAavePosition } from "../hooks/useAavePosition";
import { useConsole } from "../hooks/useConsole";
import { useSession } from "../hooks/useSession";
import { useTokenBalances } from "../hooks/useTokenBalances";
import { AavePositionDisplay } from "./AavePositionDisplay";
import { Button } from "./Button";
import { Console } from "./Console";
import { Input } from "./Input";
import { Select } from "./Select";

type AaveOperation =
  | "supply"
  | "borrow"
  | "repay"
  | "withdraw"
  | "approve"
  | "faucet";

const operationTab = tv({
  base: "px-4 py-2 text-sm font-medium rounded-lg transition-all",
  variants: {
    active: {
      true: "bg-accent text-white",
      false:
        "bg-bg-tertiary text-text-secondary hover:text-text-primary border border-border",
    },
  },
  defaultVariants: {
    active: false,
  },
});

const OPERATION_TABS = [
  { id: "faucet", label: "Faucet", emoji: "💧" },
  { id: "supply", label: "Supply", emoji: "📥" },
  { id: "borrow", label: "Borrow", emoji: "💸" },
  { id: "repay", label: "Repay", emoji: "💳" },
  { id: "withdraw", label: "Withdraw", emoji: "📤" },
  { id: "approve", label: "Approve", emoji: "🔓" },
] as const;

export const AavePanel = () => {
  const { output } = useConsole("aave");
  const { session, updateSession } = useSession();
  const [operation, setOperation] = useState<AaveOperation>("faucet");
  const [selectedAsset, setSelectedAsset] = useState("USDC");
  const [approvalType, setApprovalType] = useState<
    "unlimited" | "0" | "custom"
  >("unlimited");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const form = useForm({
    defaultValues: {
      pimlicoApiKey: session.pimlicoApiKey,
      accountAddress: session.accountAddress,
      amount: "0.001",
      customApprovalAmount: "1000",
      preQuantumSeed: session.preQuantumSeed,
      postQuantumSeed: session.postQuantumSeed,
    },
    onSubmit: ({ value }) => {
      const params = {
        accountAddress: value.accountAddress,
        asset: selectedAsset,
        amount: value.amount,
        preQuantumSeed: value.preQuantumSeed,
        postQuantumSeed: value.postQuantumSeed,
        bundlerUrl: getBundlerUrl(),
      };

      match(operation)
        .with("faucet", () =>
          faucetMutation.mutate({
            accountAddress: value.accountAddress,
            asset: selectedAsset,
            amount: value.amount,
          })
        )
        .with("supply", () => supplyMutation.mutate(params))
        .with("borrow", () => borrowMutation.mutate(params))
        .with("repay", () => repayMutation.mutate(params))
        .with("withdraw", () => withdrawMutation.mutate(params))
        .with("approve", () =>
          approveMutation.mutate({
            ...params,
            approvalType:
              approvalType === "custom"
                ? value.customApprovalAmount
                : approvalType,
          })
        )
        .exhaustive();
    },
  });

  const { chain } = useConnection();
  const chainId = chain?.id;
  const config = chainId ? AAVE_CONFIG[chainId] ?? null : null;
  const configTokens = config ? Object.keys(config.tokens) : [];
  const allTokens = ["ETH", ...configTokens];
  const faucetTokens = configTokens;
  const tokens = operation === "faucet" ? faucetTokens : allTokens;
  const accountAddress = useStore(form.store, (s) => s.values.accountAddress);
  const pimlicoApiKey = useStore(form.store, (s) => s.values.pimlicoApiKey);
  const preQuantumSeed = useStore(form.store, (s) => s.values.preQuantumSeed);
  const postQuantumSeed = useStore(form.store, (s) => s.values.postQuantumSeed);

  const { data: position, refetch: refetchPosition } = useAavePosition(
    accountAddress || null,
    chainId
  );
  const { balances, refetch: refetchBalances } = useTokenBalances(
    accountAddress || null,
    chainId
  );

  const faucetMutation = useAaveFaucet();
  const supplyMutation = useAaveSupply();
  const borrowMutation = useAaveBorrow();
  const repayMutation = useAaveRepay();
  const withdrawMutation = useAaveWithdraw();
  const approveMutation = useTokenApproval();

  useEffect(() => {
    updateSession({
      pimlicoApiKey,
      accountAddress,
      preQuantumSeed,
      postQuantumSeed,
    });
  }, [
    pimlicoApiKey,
    accountAddress,
    preQuantumSeed,
    postQuantumSeed,
    updateSession,
  ]);

  const isPending =
    faucetMutation.isPending ||
    supplyMutation.isPending ||
    borrowMutation.isPending ||
    repayMutation.isPending ||
    withdrawMutation.isPending ||
    approveMutation.isPending;

  const getBundlerUrl = () => {
    const key = form.getFieldValue("pimlicoApiKey").trim();

    return key && chainId
      ? `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${key}`
      : "";
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([refetchPosition(), refetchBalances()]);
    setIsRefreshing(false);
  };

  const getOperationButton = () => {
    return match(operation)
      .with("faucet", () => ({ label: "Mint from Faucet", emoji: "💧" }))
      .with("supply", () => ({ label: "Supply to Aave", emoji: "📥" }))
      .with("borrow", () => ({ label: "Borrow from Aave", emoji: "💸" }))
      .with("repay", () => ({ label: "Repay Loan", emoji: "💳" }))
      .with("withdraw", () => ({ label: "Withdraw from Aave", emoji: "📤" }))
      .with("approve", () => ({ label: "Approve Token", emoji: "🔓" }))
      .exhaustive();
  };

  const buttonInfo = getOperationButton();

  if (!config) {
    return (
      <div className="animate-fadeIn">
        <div className="bg-bg-secondary border border-border rounded-lg p-6 text-center">
          <p className="text-text-secondary">
            Aave V3 is not available on this network. Please switch to Sepolia
            testnet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      <div className="bg-bg-secondary border border-border rounded-lg p-4 mb-4 flex items-center gap-3">
        <span className="text-text-muted text-lg">ℹ️</span>
        <div className="text-sm text-text-secondary">
          <strong className="text-text-primary">
            Aave V3 on {config.name}
          </strong>{" "}
          - Supply assets as collateral and borrow against them.{" "}
          <a
            href="https://app.aave.com/?marketName=proto_sepolia_v3"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:text-accent-hover"
          >
            Open Aave UI
          </a>
        </div>
      </div>

      <AavePositionDisplay
        position={position}
        isRefreshing={isRefreshing}
        onRefresh={handleRefresh}
      />

      <div className="bg-bg-secondary border border-border rounded-lg p-6 mb-4">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-text-primary mb-1">
            💼 Account Info
          </h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              ERC4337 Account Address
            </label>
            <Field
              form={form}
              name="accountAddress"
              children={(field) => (
                <Input
                  type="text"
                  placeholder="0x..."
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
          </div>

          {operation !== "faucet" && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Pimlico API Key
              </label>
              <Field
                form={form}
                name="pimlicoApiKey"
                children={(field) => (
                  <Input
                    type="text"
                    placeholder="pim_xxx..."
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="blur-sm hover:blur-none focus:blur-none"
                  />
                )}
              />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-text-primary">
                Token Balances
              </label>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {balances.map(({ token, formatted }) => (
                <div
                  key={token.symbol}
                  className="bg-bg-tertiary border border-border rounded-lg p-2 text-center"
                >
                  <div className="text-xs font-medium text-text-secondary">
                    {token.symbol}
                  </div>
                  <div className="font-mono text-sm font-semibold text-text-primary">
                    {formatted}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-bg-secondary border border-border rounded-lg p-6 mb-4">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-text-primary mb-1">
            🏦 Aave Operations
          </h3>
          {operation === "faucet" && (
            <p className="text-sm text-text-muted mt-2">
              Mint testnet tokens to your account address from the Aave faucet
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {OPERATION_TABS.map((op) => (
            <button
              key={op.id}
              type="button"
              onClick={() => setOperation(op.id)}
              className={operationTab({ active: operation === op.id })}
            >
              {op.emoji} {op.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Asset
            </label>
            <Select
              value={selectedAsset}
              onChange={(e) => setSelectedAsset(e.target.value)}
            >
              {tokens.map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </Select>
          </div>

          {operation !== "approve" && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Amount
              </label>
              <Field
                form={form}
                name="amount"
                children={(field) => (
                  <div className="relative">
                    <Input
                      type="text"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-text-muted">
                      {selectedAsset}
                    </div>
                  </div>
                )}
              />
            </div>
          )}

          {operation === "approve" && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Approval Amount
              </label>
              <Select
                value={approvalType}
                onChange={(e) =>
                  setApprovalType(
                    e.target.value as "unlimited" | "0" | "custom"
                  )
                }
              >
                <option value="unlimited">Unlimited</option>
                <option value="0">Revoke (0)</option>
                <option value="custom">Custom Amount</option>
              </Select>
            </div>
          )}
        </div>

        {operation === "approve" && approvalType === "custom" && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-text-primary mb-2">
              Custom Approval Amount
            </label>
            <Field
              form={form}
              name="customApprovalAmount"
              children={(field) => (
                <Input
                  type="text"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
          </div>
        )}
      </div>

      {operation !== "faucet" && (
        <div className="bg-bg-secondary border border-border rounded-lg p-6 mb-4">
          <div className="mb-5">
            <h3 className="text-base font-semibold text-text-primary mb-1">
              🔑 Signing Keys
            </h3>
            <p className="text-sm text-text-muted">
              Same seeds used to create the account
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Pre-Quantum Seed (ECDSA)
              </label>
              <Field
                form={form}
                name="preQuantumSeed"
                children={(field) => (
                  <Input
                    type="text"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Post-Quantum Seed (ML-DSA-44)
              </label>
              <Field
                form={form}
                name="postQuantumSeed"
                children={(field) => (
                  <Input
                    type="text"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              />
            </div>
          </div>
        </div>
      )}

      <Button
        variant="primary"
        fullWidth
        onClick={() => form.handleSubmit()}
        disabled={isPending}
      >
        {isPending
          ? "Processing..."
          : `${buttonInfo.emoji} ${buttonInfo.label}`}
      </Button>

      <Console output={output} />
    </div>
  );
};
