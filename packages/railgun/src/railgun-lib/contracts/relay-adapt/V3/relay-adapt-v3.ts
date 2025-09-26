import {
  AbiCoder,
  Contract,
  ContractTransaction,
  Provider,
  Interface,
  TransactionRequest,
  Result,
  Log,
  toUtf8String,
} from 'ethers';
import { ABIRelayAdapt } from '../../../abi/abi';
import { TransactionReceiptLog } from '../../../models/formatted-types';
import { getTokenDataERC20 } from '../../../note/note-util';
import { ZERO_ADDRESS } from '../../../utils/constants';
import { RelayAdaptHelper } from '../relay-adapt-helper';
import { EngineDebug } from '../../../debugger/debugger';
import { ShieldRequestStruct } from '../../../abi/typechain/RailgunSmartWallet';
import { RelayAdapt } from '../../../abi/typechain/RelayAdapt';
import { PayableOverrides } from '../../../abi/typechain/common';
import { TransactionStructV2 } from '../../../models/transaction-types';

enum RelayAdaptEvent {
  CallError = 'CallError',
}

export const RETURN_DATA_RELAY_ADAPT_STRING_PREFIX = '0x5c0dee5d';
export const RETURN_DATA_STRING_PREFIX = '0x08c379a0';

// A low (or undefined) gas limit can cause the Relay Adapt module to fail.
// Set a high default that can be overridden by a developer.
export const MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT = BigInt(3_200_000);

export class RelayAdaptV3Contract {
  private readonly contract: RelayAdapt;

  readonly address: string;

  /**
   * Connect to Railgun instance on network
   * @param relayAdaptV3ContractAddress - address of Railgun relay adapt contract
   * @param provider - Network provider
   */
  constructor(relayAdaptV3ContractAddress: string, provider: Provider) {
    this.address = relayAdaptV3ContractAddress;
    this.contract = new Contract(
      relayAdaptV3ContractAddress,
      ABIRelayAdapt, // TODO-V3
      provider,
    ) as unknown as RelayAdapt;
  }

  async populateShieldBaseToken(shieldRequest: ShieldRequestStruct): Promise<ContractTransaction> {
    throw new Error('Not implemented.');
    const orderedCalls: ContractTransaction[] = await Promise.all([
      this.contract.wrapBase.populateTransaction(shieldRequest.preimage.value),
      this.populateRelayShields([shieldRequest]),
    ]);
    return this.populateRelayMulticall(orderedCalls, {
      value: shieldRequest.preimage.value,
    });
  }

  async populateMulticall(
    calls: ContractTransaction[],
    shieldRequests: ShieldRequestStruct[],
  ): Promise<ContractTransaction> {
    throw new Error('Not implemented.');
    const orderedCalls = await this.getOrderedCallsForCrossContractCalls(calls, shieldRequests);
    return this.populateRelayMulticall(orderedCalls, {});
  }

  /**
   * @returns Populated transaction
   */
  private populateRelayShields(
    shieldRequests: ShieldRequestStruct[],
  ): Promise<ContractTransaction> {
    throw new Error('Not implemented.');
    return this.contract.shield.populateTransaction(shieldRequests);
  }

  private async getOrderedCallsForUnshieldBaseToken(
    unshieldAddress: string,
  ): Promise<ContractTransaction[]> {
    throw new Error('Not implemented.');
    // Use 0x00 address ERC20 to represent base token.
    const baseTokenData = getTokenDataERC20(ZERO_ADDRESS);

    // Automatically unwraps and unshields all tokens.
    const value = 0n;

    const baseTokenTransfer: RelayAdapt.TokenTransferStruct = {
      token: baseTokenData,
      to: unshieldAddress,
      value,
    };

    return Promise.all([
      this.contract.unwrapBase.populateTransaction(value),
      this.populateRelayTransfers([baseTokenTransfer]),
    ]);
  }

  async getRelayAdaptParamsUnshieldBaseToken(
    dummyTransactions: TransactionStructV2[],
    unshieldAddress: string,
    random: string,
  ): Promise<string> {
    throw new Error('Not implemented.');
    const orderedCalls: ContractTransaction[] = await this.getOrderedCallsForUnshieldBaseToken(
      unshieldAddress,
    );

    const requireSuccess = true;
    return RelayAdaptHelper.getRelayAdaptParams(
      dummyTransactions,
      random,
      requireSuccess,
      orderedCalls,
    );
  }

  async populateUnshieldBaseToken(
    transactions: TransactionStructV2[],
    unshieldAddress: string,
    random31Bytes: string,
  ): Promise<ContractTransaction> {
    throw new Error('Not implemented.');
    const orderedCalls: ContractTransaction[] = await this.getOrderedCallsForUnshieldBaseToken(
      unshieldAddress,
    );

    const requireSuccess = true;
    return this.populateRelay(transactions, random31Bytes, requireSuccess, orderedCalls, {});
  }

  /**
   * @returns Populated transaction
   */
  private populateRelayTransfers(
    transfersData: RelayAdapt.TokenTransferStruct[],
  ): Promise<ContractTransaction> {
    throw new Error('Not implemented.');
    return this.contract.transfer.populateTransaction(transfersData);
  }

  private async getOrderedCallsForCrossContractCalls(
    crossContractCalls: ContractTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
  ): Promise<ContractTransaction[]> {
    throw new Error('Not implemented.');
    const orderedCallPromises: ContractTransaction[] = [...crossContractCalls];
    if (relayShieldRequests.length) {
      orderedCallPromises.push(await this.populateRelayShields(relayShieldRequests));
    }
    return orderedCallPromises;
  }

  private static shouldRequireSuccessForCrossContractCalls(
    isGasEstimate: boolean,
    isBroadcasterTransaction: boolean,
  ): boolean {
    throw new Error('Not implemented.');
    // If the cross contract calls (multicalls) fail, the Broadcaster Fee and Shields should continue to process.
    // We should only !requireSuccess for production broadcaster transactions (not gas estimates).
    const continueAfterMulticallFailure = isBroadcasterTransaction && !isGasEstimate;
    return !continueAfterMulticallFailure;
  }

  async getRelayAdaptParamsCrossContractCalls(
    dummyUnshieldTransactions: TransactionStructV2[],
    crossContractCalls: ContractTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
    random: string,
    isBroadcasterTransaction: boolean,
    minGasLimit?: bigint,
  ): Promise<string> {
    throw new Error('Not implemented.');
    const orderedCalls: ContractTransaction[] = await this.getOrderedCallsForCrossContractCalls(
      crossContractCalls,
      relayShieldRequests,
    );

    // Adapt params not required for gas estimates.
    const isGasEstimate = false;

    const requireSuccess = RelayAdaptV3Contract.shouldRequireSuccessForCrossContractCalls(
      isGasEstimate,
      isBroadcasterTransaction,
    );

    const minimumGasLimit = minGasLimit ?? MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT;
    const minGasLimitForContract =
      RelayAdaptV3Contract.getMinimumGasLimitForContract(minimumGasLimit);

    return RelayAdaptHelper.getRelayAdaptParams(
      dummyUnshieldTransactions,
      random,
      requireSuccess,
      orderedCalls,
      minGasLimitForContract,
    );
  }

  async populateCrossContractCalls(
    unshieldTransactions: TransactionStructV2[],
    crossContractCalls: ContractTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
    random31Bytes: string,
    isGasEstimate: boolean,
    isBroadcasterTransaction: boolean,
    minGasLimit?: bigint,
  ): Promise<ContractTransaction> {
    throw new Error('Not implemented.');
    const orderedCalls: ContractTransaction[] = await this.getOrderedCallsForCrossContractCalls(
      crossContractCalls,
      relayShieldRequests,
    );

    const requireSuccess = RelayAdaptV3Contract.shouldRequireSuccessForCrossContractCalls(
      isGasEstimate,
      isBroadcasterTransaction,
    );

    const minimumGasLimit = minGasLimit ?? MINIMUM_RELAY_ADAPT_CROSS_CONTRACT_CALLS_GAS_LIMIT;
    const minGasLimitForContract =
      RelayAdaptV3Contract.getMinimumGasLimitForContract(minimumGasLimit);

    const populatedTransaction = await this.populateRelay(
      unshieldTransactions,
      random31Bytes,
      requireSuccess,
      orderedCalls,
      {},
      minGasLimitForContract,
    );

    // Set default gas limit for cross-contract calls.
    populatedTransaction.gasLimit = minimumGasLimit;

    return populatedTransaction;
  }

  static getMinimumGasLimitForContract(minimumGasLimit: bigint) {
    throw new Error('Not implemented.');
    // Contract call needs ~50,000-150,000 less gas than the gasLimit setting.
    // This can be more if there are complex UTXO sets for the unshield.
    return minimumGasLimit - 150_000n;
  }

  static async estimateGasWithErrorHandler(
    provider: Provider,
    transaction: ContractTransaction | TransactionRequest,
  ): Promise<bigint> {
    throw new Error('Not implemented.');
    try {
      const gasEstimate = await provider.estimateGas(transaction);
      return gasEstimate;
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Non-error thrown from estimateGas', { cause });
      }
      const { callFailedIndexString, errorMessage } =
        RelayAdaptV3Contract.extractGasEstimateCallFailedIndexAndErrorText(cause.message);
      throw new Error(
        `RelayAdapt multicall failed at index ${callFailedIndexString} with ${errorMessage}`,
      );
    }
  }

  static extractGasEstimateCallFailedIndexAndErrorText(errMessage: string) {
    throw new Error('Not implemented.');
    try {
      // Sample error text from ethers v6.4.0: 'execution reverted (unknown custom error) (action="estimateGas", data="0x5c0dee5d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000", reason=null, transaction={ "data": "0x28223a77000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000007a00000000000000000000000000000000000000000000000000…00000000004640cd6086ade3e984b011b4e8c7cab9369b90499ab88222e673ec1ae4d2c3bf78ae96e95f9171653e5b1410273269edd64a0ab792a5d355093caa9cb92406125c7803a48028503783f2ab5e84f0ea270ce770860e436b77c942ed904a5d577d021cf0fd936183e0298175679d63d73902e116484e10c7b558d4dc84e113380500000000000000000000000000000000000000000000000000000000", "from": "0x000000000000000000000000000000000000dEaD", "to": "0x0355B7B8cb128fA5692729Ab3AAa199C1753f726" }, invocation=null, revert=null, code=CALL_EXCEPTION, version=6.4.0)'
      const prefixSplit = ` (action="estimateGas", data="`;
      const splitResult = errMessage.split(prefixSplit);
      const callFailedMessage = splitResult[0]; // execution reverted (unknown custom error)
      const dataMessage = splitResult[1].split(`"`)[0]; // 0x5c0dee5d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000
      const parsedDataMessage = this.parseRelayAdaptReturnValue(dataMessage);
      const callFailedIndexString: string = parsedDataMessage?.callIndex?.toString() ?? 'UNKNOWN';
      return {
        callFailedIndexString,
        errorMessage: `'${callFailedMessage}': ${parsedDataMessage?.error ?? dataMessage}`,
      };
    } catch (err) {
      console.error(err);
      return {
        callFailedIndexString: 'UNKNOWN',
        errorMessage: `error: ${errMessage}`,
      };
    }
  }

  /**
   * Generates Relay multicall given a list of ordered calls.
   * @returns populated transaction
   */
  private async populateRelayMulticall(
    calls: ContractTransaction[],
    overrides: PayableOverrides,
  ): Promise<ContractTransaction> {
    throw new Error('Not implemented.');
    // Always requireSuccess when there is no Broadcaster payment.
    const requireSuccess = true;
    const populatedTransaction = await this.contract.multicall.populateTransaction(
      requireSuccess,
      RelayAdaptHelper.formatCalls(calls),
      overrides,
    );
    return populatedTransaction;
  }

  /**
   * Generates Relay multicall given a list of transactions and ordered calls.
   * @returns populated transaction
   */
  private async populateRelay(
    transactions: TransactionStructV2[],
    random31Bytes: string,
    requireSuccess: boolean,
    calls: ContractTransaction[],
    overrides: PayableOverrides,
    minimumGasLimit = BigInt(0),
  ): Promise<ContractTransaction> {
    throw new Error('Not implemented.');
    const actionData: RelayAdapt.ActionDataStruct = RelayAdaptHelper.getActionData(
      random31Bytes,
      requireSuccess,
      calls,
      minimumGasLimit,
    );
    const populatedTransaction = await this.contract.relay.populateTransaction(
      transactions,
      actionData,
      overrides,
    );
    return populatedTransaction;
  }

  private static getCallErrorTopic() {
    throw new Error('Not implemented.');
    const iface = new Interface(ABIRelayAdapt);
    return iface.encodeFilterTopics(RelayAdaptEvent.CallError, [])[0];
  }

  static getRelayAdaptCallError(
    receiptLogs: TransactionReceiptLog[] | readonly Log[],
  ): Optional<string> {
    const topic = this.getCallErrorTopic();
    try {
      for (const log of receiptLogs) {
        if (log.topics[0] === topic) {
          const parsed = this.customRelayAdaptErrorParse(log.data);
          if (parsed) {
            return parsed.error;
          }
        }
      }
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Non-error thrown from getRelayAdaptCallError.', { cause });
      }
      const err = new Error('Relay Adapt log parsing error', { cause });
      EngineDebug.error(err);
      throw err;
    }
    return undefined;
  }

  static parseRelayAdaptReturnValue(
    returnValue: string,
  ): Optional<{ callIndex?: number; error: string }> {
    if (returnValue.match(RETURN_DATA_RELAY_ADAPT_STRING_PREFIX)) {
      const strippedReturnValue = returnValue.replace(RETURN_DATA_RELAY_ADAPT_STRING_PREFIX, '0x');
      return this.customRelayAdaptErrorParse(strippedReturnValue);
    }
    if (returnValue.match(RETURN_DATA_STRING_PREFIX)) {
      return { error: this.parseRelayAdaptStringError(returnValue) };
    }
    return {
      error: `Not a RelayAdapt return value: must be prefixed with ${RETURN_DATA_RELAY_ADAPT_STRING_PREFIX} or ${RETURN_DATA_STRING_PREFIX}`,
    };
  }

  private static customRelayAdaptErrorParse(
    data: string,
  ): Optional<{ callIndex: number; error: string }> {
    // Force parse as bytes
    const decoded: Result = AbiCoder.defaultAbiCoder().decode(
      ['uint256 callIndex', 'bytes revertReason'],
      data,
    );

    const callIndex = Number(decoded[0]);


    const revertReasonBytes: string = decoded[1];

    // Map function to try parsing bytes as string
    const error = this.parseRelayAdaptStringError(revertReasonBytes);
    return { callIndex, error };
  }

  private static parseRelayAdaptStringError(revertReason: string): string {
    if (revertReason.match(RETURN_DATA_STRING_PREFIX)) {
      const strippedReturnValue = revertReason.replace(RETURN_DATA_STRING_PREFIX, '0x');
      const result = AbiCoder.defaultAbiCoder().decode(['string'], strippedReturnValue);
      return result[0];
    }
    try {
      const utf8 = toUtf8String(revertReason);
      if (utf8.length === 0) {
        throw new Error('No utf8 string parsed from revert reason.');
      }
      return utf8;
    } catch (err) {

      return `Unknown Relay Adapt error: ${err?.message ?? err}`;
    }
  }
}
