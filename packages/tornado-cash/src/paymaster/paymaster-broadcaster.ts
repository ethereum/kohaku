import { BundlerClient, GasConfig, TornadoBuilder } from '@privacy-paymasters/sdk';
import { type Hash } from 'viem';
import { generatePrivateKey } from 'viem/accounts';

import { EthereumProvider } from '@kohaku-eth/provider';
import { reasonableGasUnits } from './fee';
import { signDelegationAuthorization } from './utils';
import { IGenericPaymasterWithdrawalPayload, IPaymasterBroadcasterClient, SignedDelegation } from '../relayer/interfaces/paymaster-client.interface';
import { IPaymasterConfig } from '../plugin/interfaces/protocol-params.interface';
import { Address } from '../interfaces/types.interface';

export interface PaymasterBroadcastResult {
  userOpHash: Hash;
}

export class PaymasterBroadcaster implements IPaymasterBroadcasterClient {
  constructor(
    private provider: EthereumProvider,
    private options: Record<number, IPaymasterConfig>,
  ) { }

  async broadcast(
    withdrawals: IGenericPaymasterWithdrawalPayload[],
  ): Promise<PaymasterBroadcastResult[]> {
    const chainId = Number(await this.provider.getChainId()) as 1 | 11155111;

    const {
      poolsAccountsMap: rawPoolsAccountsMap,
    } = this.options[chainId]!;

    const poolAcountsMap = new Map(
      Object.entries(rawPoolsAccountsMap)
        .map(([poolAccount, tornadoAccount]) => [
          BigInt(poolAccount) as Address,
          tornadoAccount
        ] as const)
      )

    const results = await Promise.allSettled(
      withdrawals.map((w) => PaymasterBroadcaster.broadcastOne({
        ...w,
        accountAddress: poolAcountsMap.get(w.poolAddress)!
      }, this.provider)),
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

  static async broadcastOne(
    withdrawal: IGenericPaymasterWithdrawalPayload,
    provider: EthereumProvider,
  ): Promise<PaymasterBroadcastResult> {
    const {
      proof: { proof: proofHex, args: proofArgs },
      paymasterAddress,
      entryPointAddress,
      bundlerUrl,
      accountAddress,
      isERC20,
    } = withdrawal;
    const [root, nullifierHash, recipient, _paymasterAddress, feeHex] = proofArgs;

    if (BigInt(paymasterAddress) !== BigInt(_paymasterAddress)) {
      throw new Error(`relayer must be paymaster when using the 4337 paymaster flow: ${paymasterAddress} != ${_paymasterAddress}`);
    }

    // Use pre-computed delegation (deterministic) or generate a random one
    const delegation = withdrawal.delegation
      ?? await PaymasterBroadcaster.generateRandomDelegation(accountAddress, provider);

    const { senderAddress, authorization } = delegation;

    const bundlerClient = new BundlerClient(bundlerUrl, entryPointAddress);
    const { standard: { maxFeePerGas, maxPriorityFeePerGas } } = await bundlerClient.getUserOperationGasPrice();
    const gasMode: "manual" | "auto" = "manual";

    let gas: GasConfig;

    if (gasMode === "manual") {
      gas = {
        type: 'manual',
        ...reasonableGasUnits(isERC20),
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
      .build(provider, bundlerClient);

    const userOpHash = await bundlerClient.sendUserOperation(op);

    await bundlerClient.waitForUserOperationReceipt(userOpHash);

    return { userOpHash };
  }

  static async generateRandomDelegation(
    accountAddress: `0x${string}`,
    provider: EthereumProvider
  ): Promise<SignedDelegation> {
    const privateKey = generatePrivateKey();
    const chainId = Number(await provider.getChainId());

    return signDelegationAuthorization({
      privateKey,
      accountAddress,
      chainId,
      nonce: 0,
    });
  }
}
