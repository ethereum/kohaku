import { Field, useForm } from "@tanstack/react-form";
import { useState } from "react";
import { formatEther } from "viem";
import { useBalance, useConnection } from "wagmi";

import { getFactoryAddress } from "../config/wagmi";
import { useAccountBalance } from "../hooks/useAccountBalance";
import { useConsole } from "../hooks/useConsole";
import { useDeployAccount } from "../hooks/useDeployAccount";
import { useFundAccount } from "../hooks/useFundAccount";
import { Console } from "./Console";

export function CreateAccountPanel() {
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
            log("❌ " + error.message);
          },
        }
      );
    },
  });

  const [deployedAddress, setDeployedAddress] = useState<string | null>(null);

  const { address, chain } = useConnection();
  const { data: walletBalanceData } = useBalance({ address });
  const { data: newAccountBalance } = useAccountBalance(deployedAddress);

  const factoryAddress = getFactoryAddress(chain?.id);
  const walletBalance = walletBalanceData
    ? `${formatEther(walletBalanceData.value).slice(0, 10)} ETH`
    : "—";

  const deployMutation = useDeployAccount();
  const fundMutation = useFundAccount();

  const handleDeploy = () => {
    form.handleSubmit();
  };

  const handleFundAccount = () => {
    if (!deployedAddress) {
      log("❌ No account address! Deploy an account first.");

      return;
    }

    const fundAmount = form.getFieldValue("fundAmount");

    fundMutation.mutate({ address: deployedAddress, amount: fundAmount });
  };

  return (
    <div className={`panel active`}>
      <div className="warning-box">
        <span className="warning-box-icon">⚠️</span>
        <div>
          <strong>Security Note:</strong> These seeds will generate your
          account's public keys. Do not use real seeds in production on a public
          website. This is for testing purposes only.
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-icon">⚙️</div>
          <div>
            <div className="card-title">Configuration</div>
            <div className="card-subtitle">Network and account settings</div>
          </div>
        </div>

        <div className="form-row single">
          <div className="form-group">
            <label className="form-label">Factory Address</label>
            <div className="static-info">
              <span
                className="value"
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: "0.8rem",
                }}
              >
                {factoryAddress}
              </span>
            </div>
          </div>
        </div>

        <div className="form-row single">
          <div className="form-group">
            <label className="form-label">Connected Wallet Balance</label>
            <div className="balance-display">
              <span className="balance-label">ETH:</span>
              <span className="balance-value">{walletBalance}</span>
            </div>
            <div className="form-hint">
              Balance of your connected wallet (used for gas)
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-icon">🔑</div>
          <div>
            <div className="card-title">Signing Keys</div>
            <div className="card-subtitle">
              Generate deterministic keypairs from seeds
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Pre-Quantum Seed (ECDSA)</label>
            <Field
              form={form}
              name="preQuantumSeed"
              children={(field) => (
                <input
                  type="text"
                  className="form-input"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
            <div className="form-hint">32 bytes for ECDSA key generation</div>
          </div>
          <div className="form-group">
            <label className="form-label">Post-Quantum Seed (ML-DSA-44)</label>
            <Field
              form={form}
              name="postQuantumSeed"
              children={(field) => (
                <input
                  type="text"
                  className="form-input"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
            <div className="form-hint">32 bytes for ML-DSA key generation</div>
          </div>
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={handleDeploy}
        disabled={deployMutation.isPending}
      >
        <span>🚀</span>
        {deployMutation.isPending
          ? "Deploying..."
          : "Connect Wallet & Deploy Account"}
      </button>

      <div className="card" style={{ marginTop: "1.5rem" }}>
        <div className="card-header">
          <div className="card-icon">💰</div>
          <div>
            <div className="card-title">Send ETH to New Account</div>
            <div className="card-subtitle">Fund your ERC4337 account</div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">New Account Address</label>
            <div className="balance-display" style={{ flex: 1 }}>
              <span
                className="balance-value"
                style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}
              >
                {deployedAddress || "Deploy first to see address"}
              </span>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">New Account Balance</label>
            <div className="balance-display">
              <span className="balance-label">ETH:</span>
              <span className="balance-value">{newAccountBalance ?? "—"}</span>
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Amount to Send (ETH)</label>
            <Field
              form={form}
              name="fundAmount"
              children={(field) => (
                <input
                  type="text"
                  className="form-input"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
            <div className="form-hint">
              ETH to transfer from connected wallet
            </div>
          </div>
          <div
            className="form-group"
            style={{ display: "flex", alignItems: "flex-end" }}
          >
            <button
              className="btn btn-secondary"
              onClick={handleFundAccount}
              disabled={fundMutation.isPending}
              style={{ width: "100%" }}
            >
              <span>📤</span>
              {fundMutation.isPending ? "Sending..." : "Send ETH to Account"}
            </button>
          </div>
        </div>
      </div>

      <Console output={output} />
    </div>
  );
}
