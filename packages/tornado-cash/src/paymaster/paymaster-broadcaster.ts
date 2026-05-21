import { BundlerClient, GasConfig, TornadoBuilder } from 'privacy-paymaster';
import { type Hash } from 'viem';
import { generatePrivateKey } from 'viem/accounts';

import { IPaymasterWithdrawalPayload, SignedDelegation } from '../plugin/interfaces/protocol-params.interface';
import { EthereumProvider } from '@kohaku-eth/provider';
import { reasonableGasUnits } from './fee';
import { signDelegationAuthorization } from './utils';

export interface PaymasterBroadcastResult {
  userOpHash: Hash;
}

export class PaymasterBroadcaster {
  constructor(
    private provider: EthereumProvider,
  ) { }

  async broadcast(
    withdrawals: IPaymasterWithdrawalPayload[],
  ): Promise<PaymasterBroadcastResult[]> {
    const results = await Promise.allSettled(
      withdrawals.map((w) => this.broadcastOne(w)),
    );

    const failed = results.filter((r) => r.status === 'rejected');

    if (failed.length > 0) {
      console.warn(
        `Some paymaster withdrawals failed.`,
        failed.map((e) => e.reason).join('\n'),
      );
    }

    return results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  private async broadcastOne(
    withdrawal: IPaymasterWithdrawalPayload,
  ): Promise<PaymasterBroadcastResult> {
    const {
      proof: { proof: proofHex, args: proofArgs },
      paymasterAddress,
      entryPointAddress,
      bundlerUrl,
      accountAddress,
    } = withdrawal;
    const [root, nullifierHash, recipient, _paymasterAddress, feeHex, _refund] = proofArgs;

    if (BigInt(paymasterAddress) !== BigInt(_paymasterAddress)) {
      throw new Error(`relayer must be paymaster when using the 4337 paymaster flow: ${paymasterAddress} != ${_paymasterAddress}`);
    }

    // Use pre-computed delegation (deterministic) or generate a random one
    const delegation = withdrawal.delegation
      ?? await this.generateRandomDelegation(accountAddress);

    const { senderAddress, authorization } = delegation;

    const bundlerClient = new BundlerClient(bundlerUrl, entryPointAddress);
    const { standard: { maxFeePerGas, maxPriorityFeePerGas } } = await bundlerClient.getUserOperationGasPrice();
    const gasMode: "manual" | "auto" = "manual";

    let gas: GasConfig;

    if (gasMode === "manual") {
      gas = {
        type: 'manual',
        ...reasonableGasUnits,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };
    } else {
      gas = { type: 'auto' };
    }

    const op = await new TornadoBuilder(senderAddress)
      .withPaymaster(paymasterAddress)
      .withAuthorization(authorization)
      .withWithdraw(
        proofHex,
        root,
        nullifierHash,
        recipient as `0x${string}`,
        _paymasterAddress as `0x${string}`,
        BigInt(feeHex),
      )
      .withGas(gas)
      .build(this.provider, bundlerClient);

    const userOpHash = await bundlerClient.sendUserOperation(op);

    await bundlerClient.waitForUserOperationReceipt(userOpHash);

    return { userOpHash };
  }

  private async generateRandomDelegation(
    accountAddress: `0x${string}`,
  ): Promise<SignedDelegation> {
    const privateKey = generatePrivateKey();
    const chainId = Number(await this.provider.getChainId());

    return signDelegationAuthorization({
      privateKey,
      accountAddress,
      chainId,
      nonce: 0,
    });
  }
}
