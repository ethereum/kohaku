import { Field, useForm } from "@tanstack/react-form";
import { useState } from "react";
import { type Address, formatEther, isAddress } from "viem";
import { useBalance, useConnection } from "wagmi";

import { getFactoryAddress } from "../config/wagmi";
import { useConsole } from "../hooks/useConsole";
import { useDeployAccount } from "../hooks/useDeployAccount";
import { useFundAccount } from "../hooks/useFundAccount";
import { Button } from "./Button";
import { Console } from "./Console";
import { Input } from "./Input";

export const CreateAccountPanel = () => {
  const { output, log } = useConsole("create");

  const form = useForm({
    defaultValues: {
      preQuantumSeed:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      postQuantumSeed:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      fundAmount: "0.01",
    },
    onSubmit: ({ value }) => {
      deployMutation.mutate(
        {
          factoryAddress,
          preQuantumSeed: value.preQuantumSeed,
          postQuantumSeed: value.postQuantumSeed,
        },
        {
          onSuccess: (result) => {
            if (result.success && result.address) {
              setDeployedAddress(result.address);
            }
          },
          onError: (error) => {
            log("Error: " + error.message);
          },
        }
      );
    },
  });

  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);

  const { address, chain } = useConnection();
  const { data: walletBalanceData } = useBalance({ address });
  const { data: newAccountBalanceData } = useBalance({
    address:
      deployedAddress && isAddress(deployedAddress)
        ? (deployedAddress as Address)
        : undefined,
    query: {
      enabled: !!deployedAddress && isAddress(deployedAddress),
    },
  });

  const factoryAddress = getFactoryAddress(chain?.id);
  const walletBalance = walletBalanceData
    ? `${formatEther(walletBalanceData.value).slice(0, 10)} ETH`
    : "—";
  const newAccountBalance = newAccountBalanceData
    ? `${formatEther(newAccountBalanceData.value).slice(0, 10)} ETH`
    : "—";

  const deployMutation = useDeployAccount();
  const fundMutation = useFundAccount();

  const handleDeploy = () => {
    form.handleSubmit();
  };

  const handleFundAccount = () => {
    if (!deployedAddress) {
      log("Error: No account address! Deploy an account first.");

      return;
    }

    const fundAmount = form.getFieldValue("fundAmount");

    fundMutation.mutate({ address: deployedAddress, amount: fundAmount });
  };

  return (
    <div className="animate-fadeIn">
      <div className="bg-bg-secondary border border-border rounded-lg p-6 mb-4">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-text-primary mb-1">
            Configuration
          </h3>
          <p className="text-sm text-text-muted">
            Network and account settings
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Factory Address
            </label>
            <div className="bg-bg-primary border border-border rounded-lg px-4 py-3">
              <span className="font-mono text-sm text-text-secondary">
                {factoryAddress}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Connected Wallet Balance
            </label>
            <div className="bg-bg-primary border border-border rounded-lg px-4 py-2.5">
              <span className="font-mono text-sm text-text-primary font-medium">
                {walletBalance}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-bg-secondary border border-border rounded-lg p-6 mb-4">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-text-primary mb-1">
            Signing Keys
          </h3>
          <p className="text-sm text-text-muted">
            Generate deterministic keypairs from seeds
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
        className="mb-4"
        variant="primary"
        fullWidth
        onClick={handleDeploy}
        disabled={deployMutation.isPending}
      >
        {deployMutation.isPending ? "Deploying..." : "Deploy Account"}
      </Button>

      <div className="bg-bg-secondary border border-border rounded-lg p-6">
        <div className="mb-5">
          <h3 className="text-base font-semibold text-text-primary mb-1">
            Fund Account
          </h3>
          <p className="text-sm text-text-muted">
            Send ETH to your deployed account
          </p>
        </div>

        <div className="space-y-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Account Address
            </label>
            <div className="bg-bg-primary border border-border rounded-lg px-4 py-2.5">
              <span className="font-mono text-sm text-text-secondary">
                {deployedAddress || "Deploy account first"}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Balance
            </label>
            <div className="bg-bg-primary border border-border rounded-lg px-4 py-2.5">
              <span className="font-mono text-sm text-text-primary font-medium">
                {newAccountBalance}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Amount (ETH)
            </label>
            <Field
              form={form}
              name="fundAmount"
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
              &nbsp;
            </label>
            <Button
              variant="secondary"
              size="sm"
              fullWidth
              onClick={handleFundAccount}
              disabled={fundMutation.isPending}
            >
              {fundMutation.isPending ? "Sending..." : "Send ETH"}
            </Button>
          </div>
        </div>
      </div>

      <Console output={output} />
    </div>
  );
};
