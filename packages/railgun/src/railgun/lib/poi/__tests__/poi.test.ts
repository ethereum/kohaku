import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { POI, POIListType } from "../poi";
import {
  MOCK_LIST,
  MOCK_LIST_KEY,
  TestPOINodeInterface,
} from "../../test/test-poi-node-interface.test";
import {
  Chain,
  CommitmentType,
  OutputType,
  POIsPerList,
  SentCommitment,
  TXO,
  TXOPOIListStatus,
  UnshieldStoredEvent,
  WalletBalanceBucket,
} from "../../models";
import { TransactNote } from "../../note/transact-note";

chai.use(chaiAsPromised);
const { expect } = chai;

const activeList1 = "activeList1";
const activeList2 = "activeList2";

const invalidPOIsForList1 = {
  poisPerList: {
    [activeList1]: TXOPOIListStatus.Missing,
    [activeList2]: TXOPOIListStatus.Valid,
  } as POIsPerList,
  commitmentType: CommitmentType.TransactCommitmentV2,
  note: { value: 1n },
};
const submittedPOIsForList1 = {
  poisPerList: {
    [activeList1]: TXOPOIListStatus.ProofSubmitted,
    [activeList2]: TXOPOIListStatus.Valid,
  } as POIsPerList,
  commitmentType: CommitmentType.TransactCommitmentV2,
  note: { value: 1n },
};
const validPOIsForList1 = {
  poisPerList: {
    [activeList1]: TXOPOIListStatus.Valid,
    [activeList2]: TXOPOIListStatus.Valid,
  } as POIsPerList,
  commitmentType: CommitmentType.TransactCommitmentV2,
  note: { value: 1n },
};
const shieldPendingPOIsForList1 = {
  poisPerList: {
    [activeList1]: TXOPOIListStatus.Missing,
    [activeList2]: TXOPOIListStatus.Valid,
  } as POIsPerList,
  commitmentType: CommitmentType.ShieldCommitment,
  note: { value: 1n },
};
const shieldBlockedPOIsForList1 = {
  poisPerList: {
    [activeList1]: TXOPOIListStatus.ShieldBlocked,
    [activeList2]: TXOPOIListStatus.Valid,
  } as POIsPerList,
  commitmentType: CommitmentType.ShieldCommitment,
  note: { value: 1n },
};

const chain: Chain = { type: 0, chainId: 1 };

describe("poi", () => {
  before(() => {
    POI.init(
      [
        {
          key: MOCK_LIST_KEY,
          type: POIListType.Gather,
          name: "mock list",
          description: "mock",
        },
        {
          key: activeList1,
          type: POIListType.Active,
          name: "active list 1",
          description: "active-1",
        },
        {
          key: activeList2,
          type: POIListType.Active,
          name: "active list 2",
          description: "active-2",
        },
      ],
      new TestPOINodeInterface()
    );
    POI.launchBlocks.set(null, chain, 0);
  });

  after(() => {
    POI.init([MOCK_LIST], new TestPOINodeInterface());
  });

  it("Should get which list keys can generate spent POIs", async () => {
    const listKeysLegacy = POI.getListKeysCanGenerateSpentPOIs(
      [invalidPOIsForList1 as TXO],
      [submittedPOIsForList1 as SentCommitment],
      [invalidPOIsForList1 as unknown as UnshieldStoredEvent],
      true
    );

    expect(listKeysLegacy).to.deep.equal([MOCK_LIST_KEY, activeList1]);

    const listKeysLegacyValue0 = POI.getListKeysCanGenerateSpentPOIs(
      [invalidPOIsForList1 as TXO],
      [{ ...submittedPOIsForList1, note: { value: 0n } } as SentCommitment],
      [submittedPOIsForList1 as unknown as UnshieldStoredEvent],
      true
    );

    expect(listKeysLegacyValue0).to.deep.equal([MOCK_LIST_KEY]);

    const listKeysNoInputProofs = POI.getListKeysCanGenerateSpentPOIs(
      [invalidPOIsForList1 as TXO],
      [submittedPOIsForList1 as SentCommitment],
      [submittedPOIsForList1 as unknown as UnshieldStoredEvent],
      false
    );

    expect(listKeysNoInputProofs).to.deep.equal([]);

    const listKeysAllValidOutputProofs = POI.getListKeysCanGenerateSpentPOIs(
      [validPOIsForList1 as TXO],
      [submittedPOIsForList1 as SentCommitment],
      [validPOIsForList1 as unknown as UnshieldStoredEvent],
      false
    );

    expect(listKeysAllValidOutputProofs).to.deep.equal([]);

    const listKeysInvalidUnshieldProof = POI.getListKeysCanGenerateSpentPOIs(
      [validPOIsForList1 as TXO],
      [submittedPOIsForList1 as SentCommitment],
      [invalidPOIsForList1 as unknown as UnshieldStoredEvent],
      false
    );

    expect(listKeysInvalidUnshieldProof).to.deep.equal([activeList1]);
  });

  it("Should get listKeys to submit legacy transact events", async () => {
    const listKeys = POI.getListKeysCanSubmitLegacyTransactEvents([
      invalidPOIsForList1 as TXO,
      validPOIsForList1 as TXO,
    ]);

    expect(listKeys).to.deep.equal([MOCK_LIST_KEY, activeList1]);
  });

  it("Should get appropriate balance bucket for TXO", async () => {
    const changeNote = {
      outputType: OutputType.Change,
    } as TransactNote;

    const balanceBucketChange = POI.getBalanceBucket({
      note: changeNote,
      spendtxid: false,
    } as TXO);

    expect(balanceBucketChange).to.deep.equal(
      WalletBalanceBucket.MissingInternalPOI
    );

    const balanceBucketTransfer = POI.getBalanceBucket({
      note: { outputType: OutputType.Transfer } as TransactNote,
      spendtxid: false,
    } as TXO);

    expect(balanceBucketTransfer).to.deep.equal(
      WalletBalanceBucket.MissingExternalPOI
    );

    const balanceBucketInvalid = POI.getBalanceBucket({
      ...invalidPOIsForList1,
      note: changeNote,
      spendtxid: false,
    } as TXO);

    expect(balanceBucketInvalid).to.deep.equal(
      WalletBalanceBucket.MissingInternalPOI
    );

    const balanceBucketSubmitted = POI.getBalanceBucket({
      ...submittedPOIsForList1,
      note: changeNote,
      spendtxid: false,
    } as TXO);

    expect(balanceBucketSubmitted).to.deep.equal(
      WalletBalanceBucket.ProofSubmitted
    );

    const balanceBucketValid = POI.getBalanceBucket({
      ...validPOIsForList1,
      note: changeNote,
      spendtxid: false,
    } as TXO);

    expect(balanceBucketValid).to.deep.equal(WalletBalanceBucket.Spendable);

    const balanceBucketShieldPending = POI.getBalanceBucket({
      ...shieldPendingPOIsForList1,
      note: changeNote,
      spendtxid: false,
    } as TXO);

    expect(balanceBucketShieldPending).to.deep.equal(
      WalletBalanceBucket.ShieldPending
    );

    const balanceBucketShieldBlocked = POI.getBalanceBucket({
      ...shieldBlockedPOIsForList1,
      note: changeNote,
      spendtxid: false,
    } as TXO);

    expect(balanceBucketShieldBlocked).to.deep.equal(
      WalletBalanceBucket.ShieldBlocked
    );

    const balanceBucketSpent = POI.getBalanceBucket({
      ...shieldBlockedPOIsForList1,
      note: changeNote,
      spendtxid: "123",
    } as TXO);

    expect(balanceBucketSpent).to.deep.equal(WalletBalanceBucket.Spent);
  });
});
