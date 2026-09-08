import { encodeAbiParameters, parseAbiParameters } from "viem";

import { WithdrawalPayload } from "../relayer/interfaces/relayer-client.interface";
import { WithdrawProveOutput } from "../state/thunks/withdrawThunk";
import { toWithdrawProof } from "../utils/encoding.utils";

/**
 * Encodes the userOp `paymasterData` field for the PrivacyPaymaster:
 * `abi.encode(PaymasterData{ address adapter; bytes adapterData })`.
 *
 * (Matches `@privacy-paymasters/sdk`'s `encodePaymasterData`; kept local so the
 * SDK stays a test-only dependency.)
 */
export function encodePaymasterData(
  adapter: `0x${string}`,
  adapterData: `0x${string}`,
): `0x${string}` {
  return encodeAbiParameters(parseAbiParameters("(address adapter, bytes adapterData)"), [
    { adapter, adapterData },
  ]);
}

/**
 * Encodes the paymaster `withdrawal.data` bytes the PrivacyPoolsFeeAdapter
 * expects: `abi.encode(FeeData{ address recipient; address feeRecipient; uint256 fee })`.
 * `fee` is an absolute amount in the pool asset (not basis points); `feeRecipient`
 * must be the paymaster. Bound into the proof's `context` signal.
 */
export function encodeFeeData(feeData: {
  recipient: `0x${string}`;
  feeRecipient: `0x${string}`;
  fee: bigint;
}): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters("(address recipient, address feeRecipient, uint256 fee)"),
    [feeData],
  );
}

/**
 * Encodes the PrivacyPoolsFeeAdapter's `adapterData`:
 * `abi.encode(AdapterData{ Withdrawal withdrawal; WithdrawProof proof })`. The
 * adapter acts as the withdrawal `processooor` and calls `pool.withdraw` directly
 * during paymaster validation.
 */
export function encodePrivacyPoolAdapterData(
  withdrawal: WithdrawalPayload,
  proof: WithdrawProveOutput,
): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters(
      "((address processooor, bytes data) withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)",
    ),
    [{ withdrawal, proof: toWithdrawProof(proof) }],
  );
}
