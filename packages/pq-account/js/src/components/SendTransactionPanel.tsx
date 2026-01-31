import { Field, useForm } from "@tanstack/react-form";
import React from "react";
import { useConnection } from "wagmi";

import { useAccountBalance } from "../hooks/useAccountBalance";
import { useConsole } from "../hooks/useConsole";
import { useSendTransaction } from "../hooks/useSendTransaction";
import { Console } from "./Console";

export function SendTransactionPanel() {
  const form = useForm({
    defaultValues: {
      pimlicoApiKey: "",
      accountAddress: "",
      targetAddress: "",
      sendValue: "0.0001",
      callData: "0x",
      preQuantumSeed:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      postQuantumSeed:
        "0x0000000000000000000000000000000000000000000000000000000000000001",
    },
    onSubmit: ({ value }) => {
      sendMutation.mutate({
        accountAddress: value.accountAddress,
        targetAddress: value.targetAddress,
        sendValue: value.sendValue,
        callData: value.callData,
        preQuantumSeed: value.preQuantumSeed,
        postQuantumSeed: value.postQuantumSeed,
        bundlerUrl: getBundlerUrl(),
        log,
        clear,
      });
    },
  });

  const { chainId } = useConnection();
  const accountAddress = form.getFieldValue("accountAddress");
  const { data: erc4337Balance } = useAccountBalance(accountAddress || null);
  const { output, log, clear } = useConsole("send");
  const sendMutation = useSendTransaction();

  const getBundlerUrl = () => {
    const key = form.getFieldValue("pimlicoApiKey").trim();

    return key && chainId
      ? `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${key}`
      : "";
  };

  const handleSendTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    form.handleSubmit();
  };

  return (
    <div className="panel active">
      <div className="card">
        <div className="card-header">
          <div className="card-icon">📡</div>
          <div>
            <div className="card-title">Bundler Configuration</div>
            <div className="card-subtitle">
              ERC4337 transaction relay service
            </div>
          </div>
        </div>

        <div className="info-box">
          <span className="info-box-icon">ℹ️</span>
          <div>
            A bundler is required to submit ERC4337 transactions. Get a free API
            key from{" "}
            <a
              href="https://dashboard.pimlico.io"
              target="_blank"
              rel="noopener noreferrer"
            >
              Pimlico Dashboard →
            </a>
          </div>
        </div>

        <div className="form-row single">
          <div className="form-group">
            <label className="form-label">Pimlico API Key</label>
            <Field
              form={form}
              name="pimlicoApiKey"
              children={(field: any) => (
                <input
                  type="text"
                  className="form-input"
                  placeholder="pim_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
            <div className="form-hint">
              Don't have an API key?{" "}
              <a
                href="https://dashboard.pimlico.io"
                target="_blank"
                rel="noopener noreferrer"
              >
                Create one for free →
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-icon">📋</div>
          <div>
            <div className="card-title">Transaction Details</div>
            <div className="card-subtitle">Configure your transfer</div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Your ERC4337 Account</label>
            <Field
              form={form}
              name="accountAddress"
              children={(field: any) => (
                <input
                  type="text"
                  className="form-input"
                  placeholder="0x..."
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
            <div className="form-hint">The account you deployed</div>
          </div>
          <div className="form-group">
            <label className="form-label">Account Balance</label>
            <div className="balance-display">
              <span className="balance-label">ETH:</span>
              <span className="balance-value">{erc4337Balance ?? "—"}</span>
            </div>
            <div className="form-hint">Balance of your ERC4337 account</div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Recipient Address</label>
            <Field
              form={form}
              name="targetAddress"
              children={(field: any) => (
                <input
                  type="text"
                  className="form-input"
                  placeholder="0x..."
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
            <div className="form-hint">Where to send ETH</div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Amount (ETH)</label>
            <Field
              form={form}
              name="sendValue"
              children={(field: any) => (
                <input
                  type="text"
                  className="form-input"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
            <div className="form-hint">Amount of ETH to send</div>
          </div>
          <div className="form-group">
            <label className="form-label">Call Data</label>
            <Field
              form={form}
              name="callData"
              children={(field: any) => (
                <input
                  type="text"
                  className="form-input"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
            <div className="form-hint">Leave as 0x for simple transfer</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-icon">🔑</div>
          <div>
            <div className="card-title">Signing Keys</div>
            <div className="card-subtitle">
              Same seeds used to create the account
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Pre-Quantum Seed (ECDSA)</label>
            <Field
              form={form}
              name="preQuantumSeed"
              children={(field: any) => (
                <input
                  type="text"
                  className="form-input"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Post-Quantum Seed (ML-DSA-44)</label>
            <Field
              form={form}
              name="postQuantumSeed"
              children={(field: any) => (
                <input
                  type="text"
                  className="form-input"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            />
          </div>
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={handleSendTransaction}
        disabled={sendMutation.isPending}
      >
        <span>📤</span>
        {sendMutation.isPending ? "Sending..." : "Sign & Submit UserOperation"}
      </button>

      <Console output={output} />
    </div>
  );
}
