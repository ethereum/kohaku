import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { convertTransactionStructToCommitmentSummary } from '../commitment';
import { TXIDVersion, TransactionStructV2 } from '../../models';
import { BoundParamsStruct } from '../../abi/typechain/RailgunSmartWallet';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('commitment', () => {
  it('Should convert transaction struct into commitment summary', () => {
    const transactionStruct: TransactionStructV2 = {
      txidVersion: TXIDVersion.V2_PoseidonMerkle,
      commitments: ['0x10f1c4ac23f7d0b0e0a6ba3fa23efaf736a44d3e92f6dd37b5d2044cb5c081dd'],
      boundParams: {
        commitmentCiphertext: [
          {
            ciphertext: [
              '0xba002e1e01f1d63d7fa06c83880b2bef23063903d3f4a2b8f7eb800f6c45491c',
              '0x8687c2941bddfc807aa3512ebef36e889a82f3885383877e55b7f86e488b6360',
              '0x40521d04c766273db030a1ee070706493383f26b8fd677cb51acf0fd30682a37',
              '0x6588e860594d6709193c391b4e79de12cecdaed31eef71a2894af5729c0209f7',
            ],
            blindedSenderViewingKey:
              '0x2b0f49a1c0fb28ed4cc26fe0531848a25422e5ebdf5bf3df34f67d36d8a484fc',
            blindedReceiverViewingKey:
              '0x2b0f49a1c0fb28ed4cc26fe0531848a25422e5ebdf5bf3df34f67d36d8a484fc',
            memo: '0x',
            annotationData:
              '0x3f5ff6e7bab3653afd46501dac3d55bd72b33355e41bfc02fcd63a78fe9d5da550957fabde36c9ded90126755f80a3fa3cdd0d84be4686c4192e920d85dd',
          },
        ],
      } as BoundParamsStruct,
    } as TransactionStructV2;

    const firstCommitmentIndex = 0;
    const firstCommitmentSummary = convertTransactionStructToCommitmentSummary(
      transactionStruct,
      firstCommitmentIndex,
    );

    expect(firstCommitmentSummary.commitmentCiphertext).to.deep.equal({
      annotationData:
        '0x3f5ff6e7bab3653afd46501dac3d55bd72b33355e41bfc02fcd63a78fe9d5da550957fabde36c9ded90126755f80a3fa3cdd0d84be4686c4192e920d85dd',
      blindedReceiverViewingKey: '2b0f49a1c0fb28ed4cc26fe0531848a25422e5ebdf5bf3df34f67d36d8a484fc',
      blindedSenderViewingKey: '2b0f49a1c0fb28ed4cc26fe0531848a25422e5ebdf5bf3df34f67d36d8a484fc',
      ciphertext: {
        data: [
          '8687c2941bddfc807aa3512ebef36e889a82f3885383877e55b7f86e488b6360',
          '40521d04c766273db030a1ee070706493383f26b8fd677cb51acf0fd30682a37',
          '6588e860594d6709193c391b4e79de12cecdaed31eef71a2894af5729c0209f7',
        ],
        iv: 'ba002e1e01f1d63d7fa06c83880b2bef',
        tag: '23063903d3f4a2b8f7eb800f6c45491c',
      },
      memo: '0x',
    });
    expect(firstCommitmentSummary.commitmentHash).equal(
      '0x10f1c4ac23f7d0b0e0a6ba3fa23efaf736a44d3e92f6dd37b5d2044cb5c081dd',
    );
  });
});
