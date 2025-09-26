import { ContractTransaction } from 'ethers';
import { PoseidonMerkleVerifier } from '../../abi/typechain';
import {
  ShieldCiphertextStruct,
  ShieldRequestStruct,
  TokenDataStructOutput,
} from '../../abi/typechain/RailgunSmartWallet';
import {
  EventsCommitmentListener,
  EventsNullifierListener,
  EventsRailgunTransactionListenerV3,
  EventsUnshieldListener,
} from '../../models/event-types';
import { ZERO_32_BYTE_VALUE, ZERO_ADDRESS } from '../../utils/constants';
import { ContractStore } from '../contract-store';
import { Chain } from '../../models/engine-types';
import { TXIDVersion } from '../../models/poi-types';
import { TransactionStructV2, TransactionStructV3 } from '../../models/transaction-types';

export class RailgunVersionedSmartContracts {
  private static zeroUnshieldChangeCiphertext: ShieldCiphertextStruct = {
    encryptedBundle: [ZERO_32_BYTE_VALUE, ZERO_32_BYTE_VALUE, ZERO_32_BYTE_VALUE],
    shieldKey: ZERO_32_BYTE_VALUE,
  };

  static getAccumulator(txidVersion: TXIDVersion, chain: Chain) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return ContractStore.railgunSmartWalletContracts.getOrThrow(null, chain);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return ContractStore.poseidonMerkleAccumulatorV3Contracts.getOrThrow(null, chain);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getVerifier(txidVersion: TXIDVersion, chain: Chain) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.railgunSmartWalletContracts.getOrThrow(null, chain);
        return contractV2;
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return ContractStore.poseidonMerkleVerifierV3Contracts.getOrThrow(null, chain);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getShieldApprovalContract(txidVersion: TXIDVersion, chain: Chain) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        return ContractStore.railgunSmartWalletContracts.getOrThrow(null, chain);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        return ContractStore.tokenVaultV3Contracts.getOrThrow(null, chain);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

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

  static getHistoricalEvents(
    txidVersion: TXIDVersion,
    chain: Chain,
    initialStartBlock: number,
    latestBlock: number,
    getNextStartBlockFromValidMerkletree: () => Promise<number>,
    eventsCommitmentListener: EventsCommitmentListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    eventsRailgunTransactionsV3Listener: EventsRailgunTransactionListenerV3,
    setLastSyncedBlock: (lastSyncedBlock: number) => Promise<void>,
  ) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.railgunSmartWalletContracts.getOrThrow(null, chain);
        return contractV2.getHistoricalEvents(
          initialStartBlock,
          latestBlock,
          getNextStartBlockFromValidMerkletree,
          eventsCommitmentListener,
          eventsNullifierListener,
          eventsUnshieldListener,
          setLastSyncedBlock,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3 = ContractStore.poseidonMerkleAccumulatorV3Contracts.getOrThrow(
          null,
          chain,
        );
        return contractV3.getHistoricalEvents(
          initialStartBlock,
          latestBlock,
          getNextStartBlockFromValidMerkletree,
          eventsCommitmentListener,
          eventsNullifierListener,
          eventsUnshieldListener,
          eventsRailgunTransactionsV3Listener,
          setLastSyncedBlock,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static setTreeUpdateListeners(
    txidVersion: TXIDVersion,
    chain: Chain,
    eventsCommitmentListener: EventsCommitmentListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    eventsRailgunTransactionsV3Listener: EventsRailgunTransactionListenerV3,
    triggerWalletBalanceDecryptions: (txidVersion: TXIDVersion) => Promise<void>,
  ) {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.railgunSmartWalletContracts.getOrThrow(null, chain);
        return contractV2.setTreeUpdateListeners(
          eventsCommitmentListener,
          eventsNullifierListener,
          eventsUnshieldListener,
        );
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3 = ContractStore.poseidonMerkleAccumulatorV3Contracts.getOrThrow(
          null,
          chain,
        );
        return contractV3.setTreeUpdateListeners(
          eventsCommitmentListener,
          eventsNullifierListener,
          eventsUnshieldListener,
          eventsRailgunTransactionsV3Listener,
          triggerWalletBalanceDecryptions,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static fees(
    txidVersion: TXIDVersion,
    chain: Chain,
  ): Promise<{ shield: bigint; unshield: bigint }> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.railgunSmartWalletContracts.getOrThrow(null, chain);
        return contractV2.fees();
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractTokenVaultV3 = ContractStore.tokenVaultV3Contracts.getOrThrow(null, chain);
        return contractTokenVaultV3.fees();
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static getNFTTokenData(
    txidVersion: TXIDVersion,
    chain: Chain,
    tokenHash: string,
  ): Promise<TokenDataStructOutput> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.railgunSmartWalletContracts.getOrThrow(null, chain);
        return contractV2.getNFTTokenData(tokenHash);
      }
      case TXIDVersion.V3_PoseidonMerkle: {
        const contractTokenVaultV3 = ContractStore.tokenVaultV3Contracts.getOrThrow(null, chain);
        return contractTokenVaultV3.getNFTTokenData(tokenHash);
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static generateShield(
    txidVersion: TXIDVersion,
    chain: Chain,
    shieldRequests: ShieldRequestStruct[],
  ): Promise<ContractTransaction> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.railgunSmartWalletContracts.getOrThrow(null, chain);
        return contractV2.generateShield(shieldRequests);
      }

      case TXIDVersion.V3_PoseidonMerkle: {
        const contractV3PoseidonMerkleVerifier =
          ContractStore.poseidonMerkleVerifierV3Contracts.getOrThrow(null, chain);
        const emptyGlobalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct = {
          minGasPrice: 0n,
          chainID: chain.chainId,
          senderCiphertext: '0x',
          to: ZERO_ADDRESS,
          data: '0x',
        };
        return contractV3PoseidonMerkleVerifier.generateExecute(
          [],
          shieldRequests,
          emptyGlobalBoundParams,
          this.zeroUnshieldChangeCiphertext,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  static generateTransact(
    txidVersion: TXIDVersion,
    chain: Chain,
    transactions: (TransactionStructV2 | TransactionStructV3)[],
  ): Promise<ContractTransaction> {
    switch (txidVersion) {
      case TXIDVersion.V2_PoseidonMerkle: {
        const contractV2 = ContractStore.railgunSmartWalletContracts.getOrThrow(null, chain);
        return contractV2.generateTransact(transactions as TransactionStructV2[]);
      }

      case TXIDVersion.V3_PoseidonMerkle: {
        const transactionsV3: PoseidonMerkleVerifier.TransactionStruct[] =
          RailgunVersionedSmartContracts.convertToV3TransactStructs(
            transactions as TransactionStructV3[],
          );
        if (!transactions.length) {
          throw new Error('No transactions to transact');
        }
        const globalBoundParams = (transactions[0] as TransactionStructV3).boundParams.global;
        const contractV3PoseidonMerkleVerifier =
          ContractStore.poseidonMerkleVerifierV3Contracts.getOrThrow(null, chain);
        return contractV3PoseidonMerkleVerifier.generateExecute(
          transactionsV3,
          [],
          globalBoundParams,
          this.zeroUnshieldChangeCiphertext,
        );
      }
    }
    throw new Error('Unsupported txidVersion');
  }

  private static convertToV3TransactStructs(
    transactions: TransactionStructV3[],
  ): PoseidonMerkleVerifier.TransactionStruct[] {
    return transactions.map((transaction) => ({
      proof: transaction.proof,
      merkleRoot: transaction.merkleRoot,
      nullifiers: transaction.nullifiers,
      commitments: transaction.commitments,
      unshieldPreimage: transaction.unshieldPreimage,
      boundParams: {
        treeNumber: transaction.boundParams.local.treeNumber,
        commitmentCiphertext: transaction.boundParams.local.commitmentCiphertext,
      },
    }));
  }
}
