import { ContractTransaction, Provider, TransactionRequest } from 'ethers';
import { ContractStore } from '../contract-store';
import { Chain } from '../../models/engine-types';
import { TXIDVersion } from '../../models/poi-types';
import { ShieldRequestStruct } from '../../abi/typechain/RelayAdapt';
import { TransactionReceiptLog, TransactionStructV2, TransactionStructV3 } from '../../models';
import { RelayAdaptV2Contract } from './V2/relay-adapt-v2';
import { RelayAdaptV3Contract } from './V3/relay-adapt-v3';

export class RelayAdaptVersionedSmartContracts {
  static getRelayAdaptContract(txidVersion: TXIDVersion, chain: Chain) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return ContractStore.relayAdaptV2Contracts.getOrThrow(null, chain);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return ContractStore.relayAdaptV3Contracts.getOrThrow(null, chain);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static populateShieldBaseToken(
    txidVersion: TXIDVersion,
    chain: Chain,
    shieldRequest: ShieldRequestStruct,
  ): Promise<ContractTransaction> {
    return this.getRelayAdaptContract(txidVersion, chain).populateShieldBaseToken(shieldRequest);
  }

  static populateUnshieldBaseToken(
    txidVersion: TXIDVersion,
    chain: Chain,
    transactions: (TransactionStructV2 | TransactionStructV3)[],
    unshieldAddress: string,
    random31Bytes: string,
    useDummyProof: boolean,
  ): Promise<ContractTransaction> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.relayAdaptV2Contracts.getOrThrow(null, chain);
        return contractV2.populateUnshieldBaseToken(
          transactions as TransactionStructV2[],
          unshieldAddress,
          random31Bytes,
          useDummyProof,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3 = ContractStore.relayAdaptV3Contracts.getOrThrow(null, chain);
        return contractV3.populateUnshieldBaseToken(
          transactions as TransactionStructV2[],
          unshieldAddress,
          random31Bytes,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static populateCrossContractCalls(
    txidVersion: TXIDVersion,
    chain: Chain,
    unshieldTransactions: (TransactionStructV2 | TransactionStructV3)[],
    crossContractCalls: ContractTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
    random31Bytes: string,
    isGasEstimate: boolean,
    isBroadcasterTransaction: boolean,
    minGasLimit?: bigint,
  ): Promise<ContractTransaction> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.relayAdaptV2Contracts.getOrThrow(null, chain);
        return contractV2.populateCrossContractCalls(
          unshieldTransactions as TransactionStructV2[],
          crossContractCalls,
          relayShieldRequests,
          random31Bytes,
          isGasEstimate,
          isBroadcasterTransaction,
          minGasLimit,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3 = ContractStore.relayAdaptV3Contracts.getOrThrow(null, chain);
        return contractV3.populateCrossContractCalls(
          unshieldTransactions as TransactionStructV2[],
          crossContractCalls,
          relayShieldRequests,
          random31Bytes,
          isGasEstimate,
          isBroadcasterTransaction,
          minGasLimit,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getRelayAdaptParamsUnshieldBaseToken(
    txidVersion: TXIDVersion,
    chain: Chain,
    dummyUnshieldTransactions: (TransactionStructV2 | TransactionStructV3)[],
    unshieldAddress: string,
    random31Bytes: string,
    sendWithPublicWallet: boolean,
  ): Promise<string> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.relayAdaptV2Contracts.getOrThrow(null, chain);
        return contractV2.getRelayAdaptParamsUnshieldBaseToken(
          dummyUnshieldTransactions as TransactionStructV2[],
          unshieldAddress,
          random31Bytes,
          sendWithPublicWallet,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3 = ContractStore.relayAdaptV3Contracts.getOrThrow(null, chain);
        return contractV3.getRelayAdaptParamsUnshieldBaseToken(
          dummyUnshieldTransactions as TransactionStructV2[],
          unshieldAddress,
          random31Bytes,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getRelayAdaptParamsCrossContractCalls(
    txidVersion: TXIDVersion,
    chain: Chain,
    dummyUnshieldTransactions: (TransactionStructV2 | TransactionStructV3)[],
    crossContractCalls: ContractTransaction[],
    relayShieldRequests: ShieldRequestStruct[],
    random: string,
    isBroadcasterTransaction: boolean,
    minGasLimit?: bigint,
  ): Promise<string> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.relayAdaptV2Contracts.getOrThrow(null, chain);
        return contractV2.getRelayAdaptParamsCrossContractCalls(
          dummyUnshieldTransactions as TransactionStructV2[],
          crossContractCalls,
          relayShieldRequests,
          random,
          isBroadcasterTransaction,
          minGasLimit,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3 = ContractStore.relayAdaptV3Contracts.getOrThrow(null, chain);
        return contractV3.getRelayAdaptParamsCrossContractCalls(
          dummyUnshieldTransactions as TransactionStructV2[],
          crossContractCalls,
          relayShieldRequests,
          random,
          isBroadcasterTransaction,
          minGasLimit,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static estimateGasWithErrorHandler(
    txidVersion: TXIDVersion,
    provider: Provider,
    transaction: ContractTransaction | TransactionRequest,
  ) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return RelayAdaptV2Contract.estimateGasWithErrorHandler(provider, transaction);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return RelayAdaptV3Contract.estimateGasWithErrorHandler(provider, transaction);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getRelayAdaptCallError(txidVersion: TXIDVersion, receiptLogs: TransactionReceiptLog[]) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return RelayAdaptV2Contract.getRelayAdaptCallError(receiptLogs);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return RelayAdaptV3Contract.getRelayAdaptCallError(receiptLogs);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static parseRelayAdaptReturnValue(txidVersion: TXIDVersion, data: string) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return RelayAdaptV2Contract.parseRelayAdaptReturnValue(data);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return RelayAdaptV3Contract.parseRelayAdaptReturnValue(data);
      }
    }
    throw new Error('Unsupported txidVersion');
  }
}
