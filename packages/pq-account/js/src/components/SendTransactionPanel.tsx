import { Field, useForm, useStore } from "@tanstack/react-form";
import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";
import { encodeFunctionData, parseUnits } from "viem";
import { useConnection } from "wagmi";

import { ERC20_ABI } from "../config/aave";
import { useConsole } from "../hooks/useConsole";
import { useSendTransaction } from "../hooks/useSendTransaction";
import { useSession } from "../hooks/useSession";
import { useTokenBalances } from "../hooks/useTokenBalances";
import { Button } from "./Button";
import { Console } from "./Console";
import { Input } from "./Input";

export const SendTransactionPanel = () => {
  const { output } = useConsole("send");
  const { session, updateSession } = useSession();
  const [selectedToken, setSelectedToken] = useState("ETH");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const form = useForm({
    defaultValues: {
      pimlicoApiKey: session.pimlicoApiKey,
      accountAddress: session.accountAddress,
      targetAddress: "",
      sendValue: "0.0001",
      preQuantumSeed: session.preQuantumSeed,
      postQuantumSeed: session.postQuantumSeed,
    },
    onSubmit: ({ value }) => {
      const selectedTokenData = balances.find(
        (b) => b.token.symbol === selectedToken
      );

      if (!selectedTokenData) {
        throw new Error("Selected token not found");
      }

      let { targetAddress } = value;
      let sendValue = "0";
      let callData = "0x";

      if (selectedTokenData.token.address === null) {
        ({ sendValue } = value);
      } else {
        const amount = parseUnits(
          value.sendValue,
          selectedTokenData.token.decimals
        );

        callData = encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [value.targetAddress as `0x${string}`, amount],
        });

        targetAddress = selectedTokenData.token.address;
        sendValue = "0";
      }

      sendMutation.mutate({
        accountAddress: value.accountAddress,
        targetAddress,
        sendValue,
        callData,
        preQuantumSeed: value.preQuantumSeed,
        postQuantumSeed: value.postQuantumSeed,
        bundlerUrl: getBundlerUrl(),
      });
    },
  });

  const { chainId } = useConnection();
  const accountAddress = useStore(form.store, (s) => s.values.accountAddress);
  const pimlicoApiKey = useStore(form.store, (s) => s.values.pimlicoApiKey);
  const preQuantumSeed = useStore(form.store, (s) => s.values.preQuantumSeed);
  const postQuantumSeed = useStore(form.store, (s) => s.values.postQuantumSeed);

  const { balances, refetch } = useTokenBalances(
    accountAddress || null,
    chainId
  );
  const sendMutation = useSendTransaction();

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

  const getBundlerUrl = () => {
    const key = form.getFieldValue("pimlicoApiKey").trim();

    return key && chainId
      ? `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${key}`
      : "";
  };

  const handleSendTransaction = () => {
    form.handleSubmit();
  };

  return (
    <div className="animate-fadeIn">
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
                />
              )}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-text-primary">
                Token Balances
              </label>
              <button
                type="button"
                onClick={async () => {
                  setIsRefreshing(true);
                  await refetch();
                  setIsRefreshing(false);
                }}
                disabled={isRefreshing}
                className="text-xs text-accent hover:text-accent-hover font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <svg
                  className={`w-3.5 h-3.5 ${
                    isRefreshing ? "animate-spin" : ""
                  }`}
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
                Refresh Balances
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {balances.map(({ token, formatted }) => (
                <button
                  key={token.symbol}
                  type="button"
                  onClick={() => setSelectedToken(token.symbol)}
                  className={twMerge(
                    "bg-bg-tertiary border rounded-lg p-3 text-left transition-all",
                    selectedToken === token.symbol
                      ? "border-accent bg-accent/5"
                      : "border-border hover:border-border-hover"
                  )}
                >
                  <div className="text-xs font-medium text-text-secondary mb-1">
                    {token.symbol}
                  </div>
                  <div className="font-mono text-sm font-semibold text-text-primary">
                    {formatted}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="bg-bg-secondary border border-border rounded-lg p-6 mb-4">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-text-primary mb-1">
            Transaction Details
          </h3>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Recipient Address
            </label>
            <Field
              form={form}
              name="targetAddress"
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

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Amount ({selectedToken})
            </label>
            <Field
              form={form}
              name="sendValue"
              children={(field) => (
                <div className="relative">
                  <Input
                    type="text"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-text-muted">
                    {selectedToken}
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      </div>

      <div className="bg-bg-secondary border border-border rounded-lg p-6 mb-4">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-text-primary mb-1">
            Signing Keys
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

      <Button
        variant="primary"
        fullWidth
        onClick={handleSendTransaction}
        disabled={sendMutation.isPending}
      >
        {sendMutation.isPending ? "Sending..." : "Sign & Submit Transaction"}
      </Button>

      <Console output={output} />
    </div>
  );
};
