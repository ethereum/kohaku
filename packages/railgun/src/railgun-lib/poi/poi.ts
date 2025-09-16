import { Proof } from '../models/prover-types';
import { Chain } from '../models/engine-types';
import {
  BlindedCommitmentData,
  LegacyTransactProofData,
  POIsPerList,
  TXIDVersion,
  TXOPOIListStatus,
} from '../models/poi-types';
import { SentCommitment, TXO, WalletBalanceBucket } from '../models/txo-types';
import { isDefined, removeUndefineds } from '../utils/is-defined';
import { POINodeInterface } from './poi-node-interface';
import { UnshieldStoredEvent } from '../models/event-types';
import { OutputType } from '../models';
import { isShieldCommitmentType, isTransactCommitmentType } from '../utils/commitment';
import { Registry } from '../utils/registry';

export type POIList = {
  key: string;
  type: POIListType;
  name: string;
  description: string;
};

export enum POIListType {
  Active = 'Active',
  Gather = 'Gather',
}

export class POI {
  private static lists: POIList[];

  private static nodeInterface: POINodeInterface;

  static launchBlocks: Registry<number> = new Registry();

  static init(lists: POIList[], nodeInterface: POINodeInterface) {
    this.lists = lists;
    this.nodeInterface = nodeInterface;
  }

  static getAllListKeys(): string[] {
    return this.lists.map((list) => list.key);
  }

  static getActiveListKeys(): string[] {
    return this.lists.filter((list) => list.type === POIListType.Active).map((list) => list.key);
  }

  static getBalanceBucket(txo: TXO): WalletBalanceBucket {
    if (txo.spendtxid !== false) {
      return WalletBalanceBucket.Spent;
    }

    const pois = txo.poisPerList;
    const isChange = txo.note.outputType === OutputType.Change;

    const activeListKeys = POI.getActiveListKeys();
    if (!pois || !this.hasAllKeys(pois, activeListKeys)) {
      if (isShieldCommitmentType(txo.commitmentType)) {
        return WalletBalanceBucket.ShieldPending;
      }
      return isChange
        ? WalletBalanceBucket.MissingInternalPOI
        : WalletBalanceBucket.MissingExternalPOI;
    }

    if (POI.hasValidPOIsActiveLists(pois)) {
      return WalletBalanceBucket.Spendable;
    }

    const anyPOIIsShieldBlocked = activeListKeys.some((listKey) => {
      return pois[listKey] === TXOPOIListStatus.ShieldBlocked;
    });
    if (anyPOIIsShieldBlocked) {
      return WalletBalanceBucket.ShieldBlocked;
    }

    if (isShieldCommitmentType(txo.commitmentType)) {
      return WalletBalanceBucket.ShieldPending;
    }

    const anyPOIIsProofSubmitted = activeListKeys.some((listKey) => {
      return pois[listKey] === TXOPOIListStatus.ProofSubmitted;
    });
    if (anyPOIIsProofSubmitted) {
      return WalletBalanceBucket.ProofSubmitted;
    }

    return isChange
      ? WalletBalanceBucket.MissingInternalPOI
      : WalletBalanceBucket.MissingExternalPOI;
  }

  private static validatePOIStatusForAllLists(
    pois: POIsPerList,
    listKeys: string[],
    statuses: TXOPOIListStatus[],
  ): boolean {
    if (!this.hasAllKeys(pois, listKeys)) {
      return false;
    }
    for (const listKey of listKeys) {
      if (!statuses.includes(pois[listKey])) {
        return false;
      }
    }
    return true;
  }

  private static hasValidPOIsAllLists(pois: POIsPerList): boolean {
    const listKeys = this.getAllListKeys();
    return this.validatePOIStatusForAllLists(pois, listKeys, [TXOPOIListStatus.Valid]);
  }

  static hasValidPOIsActiveLists(pois: Optional<POIsPerList>): boolean {
    if (!pois) {
      return false;
    }
    const listKeys = this.getActiveListKeys();
    return this.validatePOIStatusForAllLists(pois, listKeys, [TXOPOIListStatus.Valid]);
  }

  private static getAllListKeysWithValidInputPOIs(inputPOIsPerList: POIsPerList[]): string[] {
    const listKeys = this.getAllListKeys();
    const listKeysShouldGenerateSpentPOIs: string[] = [];
    for (const listKey of listKeys) {
      const everyInputPOIValid = inputPOIsPerList.every((poisPerList) => {
        return poisPerList[listKey] === TXOPOIListStatus.Valid;
      });
      if (everyInputPOIValid) {
        listKeysShouldGenerateSpentPOIs.push(listKey);
      }
    }
    return listKeysShouldGenerateSpentPOIs;
  }

  private static findListsForNewPOIs(poisPerList: Optional<POIsPerList>): string[] {
    const listKeys = this.getAllListKeys();
    if (!isDefined(poisPerList)) {
      return listKeys;
    }
    const submittedStatuses = [TXOPOIListStatus.ProofSubmitted, TXOPOIListStatus.Valid];
    const needsSpendPOI: string[] = [];
    for (const listKey of listKeys) {
      const isUnsubmitted =
        !isDefined(poisPerList[listKey]) || !submittedStatuses.includes(poisPerList[listKey]);
      if (isUnsubmitted) {
        needsSpendPOI.push(listKey);
      }
    }
    return needsSpendPOI;
  }

  private static hasAllKeys(obj: object, keys: string[]) {
    return keys.every((key) => Object.prototype.hasOwnProperty.call(obj, key));
  }

  static getListKeysCanGenerateSpentPOIs(
    spentTXOs: TXO[],
    sentCommitments: SentCommitment[],
    unshieldEvents: UnshieldStoredEvent[],
    isLegacyPOIProof: boolean,
  ): string[] {
    if (!sentCommitments.length && !unshieldEvents.length) {
      return [];
    }

    const inputPOIsPerList = removeUndefineds(spentTXOs.map((txo) => txo.poisPerList));
    const listKeysWithValidInputPOIs = isLegacyPOIProof
      ? POI.getAllListKeys()
      : POI.getAllListKeysWithValidInputPOIs(inputPOIsPerList);

    const validStatuses = [TXOPOIListStatus.Valid, TXOPOIListStatus.ProofSubmitted];

    return listKeysWithValidInputPOIs.filter((listKey) => {
      // If all statuses are valid, then no need to generate new POIs.
      const allSentCommitmentZeroOrPOIsValid = sentCommitments.every((sentCommitment) => {
        if (sentCommitment.note.value === 0n) {
          // If sentCommitment value is 0, then no need to generate new POIs.
          return true;
        }
        const poiStatus = sentCommitment.poisPerList?.[listKey];
        return poiStatus && validStatuses.includes(poiStatus);
      });
      const allUnshieldPOIsValid = unshieldEvents.every((unshieldEvent) => {
        const poiStatus = unshieldEvent.poisPerList?.[listKey];
        return poiStatus && validStatuses.includes(poiStatus);
      });
      const allPOIsValid = allSentCommitmentZeroOrPOIsValid && allUnshieldPOIsValid;
      return !allPOIsValid;
    });
  }

  static getListKeysCanSubmitLegacyTransactEvents(TXOs: TXO[]): string[] {
    const listKeys = this.getAllListKeys();
    return listKeys.filter((listKey) => {
      return !TXOs.every((txo) => txo.poisPerList?.[listKey] === TXOPOIListStatus.Valid);
    });
  }

  static isLegacyTXO(chain: Chain, txo: TXO) {
    const launchBlock = this.launchBlocks.get(null, chain);
    if (!isDefined(launchBlock) || txo.blockNumber < launchBlock) {
      return true;
    }
    return false;
  }

  static shouldSubmitLegacyTransactEventsTXOs(chain: Chain, txo: TXO) {
    if (!isDefined(txo.transactCreationRailgunTxid)) {
      return false;
    }
    if (!isDefined(txo.blindedCommitment)) {
      return false;
    }
    if (!this.isLegacyTXO(chain, txo)) {
      return false;
    }
    if (!isDefined(txo.poisPerList)) {
      return false;
    }
    if (!isTransactCommitmentType(txo.commitmentType)) {
      return false;
    }
    return !POI.hasValidPOIsAllLists(txo.poisPerList);
  }

  static shouldRetrieveTXOPOIs(txo: TXO) {
    if (!isDefined(txo.blindedCommitment)) {
      return false;
    }
    if (!isDefined(txo.poisPerList)) {
      return true;
    }
    return !POI.hasValidPOIsAllLists(txo.poisPerList);
  }

  static shouldRetrieveSentCommitmentPOIs(sentCommitment: SentCommitment) {
    if (!isDefined(sentCommitment.blindedCommitment)) {
      return false;
    }
    if (sentCommitment.note.value === 0n) {
      return false;
    }
    if (!isDefined(sentCommitment.poisPerList)) {
      return true;
    }
    return !POI.hasValidPOIsAllLists(sentCommitment.poisPerList);
  }

  static shouldRetrieveUnshieldEventPOIs(unshieldEvent: UnshieldStoredEvent) {
    if (!isDefined(unshieldEvent.railgunTxid)) {
      return false;
    }
    if (!isDefined(unshieldEvent.poisPerList)) {
      return true;
    }
    return !POI.hasValidPOIsAllLists(unshieldEvent.poisPerList);
  }

  static shouldGenerateSpentPOIsSentCommitment(sentCommitment: SentCommitment) {
    if (!isDefined(sentCommitment.blindedCommitment)) {
      return false;
    }
    if (sentCommitment.note.value === 0n) {
      return false;
    }
    if (!isDefined(sentCommitment.poisPerList)) {
      return true;
    }
    const listKeys = POI.findListsForNewPOIs(sentCommitment.poisPerList);
    return listKeys.length > 0;
  }

  static shouldGenerateSpentPOIsUnshieldEvent(unshieldEvent: UnshieldStoredEvent) {
    if (!isDefined(unshieldEvent.railgunTxid)) {
      return false;
    }
    if (!isDefined(unshieldEvent.poisPerList)) {
      return true;
    }
    const listKeys = POI.findListsForNewPOIs(unshieldEvent.poisPerList);
    return listKeys.length > 0;
  }

  static isActiveForChain(chain: Chain): boolean {
    try {
      return this.nodeInterface.isActive(chain);
    } catch (err) {
      return false;
    }
  }

  static isRequiredForChain(chain: Chain): Promise<boolean> {
    return this.nodeInterface.isRequired(chain);
  }

  static async getSpendableBalanceBuckets(chain: Chain): Promise<WalletBalanceBucket[]> {
    const poiRequired = await this.isRequiredForChain(chain);
    return poiRequired
      ? [WalletBalanceBucket.Spendable]
      : // Until POI is active, all balance buckets are spendable.
        Object.values(WalletBalanceBucket);
  }

  static retrievePOIsForBlindedCommitments(
    txidVersion: TXIDVersion,
    chain: Chain,
    blindedCommitmentDatas: BlindedCommitmentData[],
  ): Promise<{ [blindedCommitment: string]: POIsPerList }> {
    if (!isDefined(this.nodeInterface)) {
      throw new Error('POI node interface not initialized');
    }
    if (blindedCommitmentDatas.length > 1000) {
      throw new Error('Cannot retrieve POIs for more than 1000 blinded commitments at a time');
    }
    const listKeys = this.getAllListKeys();
    return this.nodeInterface.getPOIsPerList(txidVersion, chain, listKeys, blindedCommitmentDatas);
  }

  static getPOIMerkleProofs(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    blindedCommitmentsIn: string[],
  ) {
    if (!isDefined(this.nodeInterface)) {
      throw new Error('POI node interface not initialized');
    }

    return this.nodeInterface.getPOIMerkleProofs(txidVersion, chain, listKey, blindedCommitmentsIn);
  }

  static validatePOIMerkleroots(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    poiMerkleroots: string[],
  ): Promise<boolean> {
    if (!isDefined(this.nodeInterface)) {
      throw new Error('POI node interface not initialized');
    }

    return this.nodeInterface.validatePOIMerkleroots(txidVersion, chain, listKey, poiMerkleroots);
  }

  static async submitPOI(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKey: string,
    snarkProof: Proof,
    poiMerkleroots: string[],
    txidMerkleroot: string,
    txidMerklerootIndex: number,
    blindedCommitmentsOut: string[],
    railgunTxidIfHasUnshield: string,
  ): Promise<void> {
    if (!isDefined(this.nodeInterface)) {
      throw new Error('POI node interface not initialized');
    }

    await this.nodeInterface.submitPOI(
      txidVersion,
      chain,
      listKey,
      snarkProof,
      poiMerkleroots,
      txidMerkleroot,
      txidMerklerootIndex,
      blindedCommitmentsOut,
      railgunTxidIfHasUnshield,
    );
  }

  static async submitLegacyTransactProofs(
    txidVersion: TXIDVersion,
    chain: Chain,
    listKeys: string[],
    legacyTransactProofDatas: LegacyTransactProofData[],
  ) {
    if (!isDefined(this.nodeInterface)) {
      throw new Error('POI node interface not initialized');
    }

    await this.nodeInterface.submitLegacyTransactProofs(
      txidVersion,
      chain,
      listKeys,
      legacyTransactProofDatas,
    );
  }
}
