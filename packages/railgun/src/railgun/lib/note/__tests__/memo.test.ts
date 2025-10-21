/// !EDIT: alter imports
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
// import memdown from 'memdown';
import { NoteAnnotationData, OutputType } from '../../models/formatted-types';
import { Memo } from '../memo';
// import { WalletInfo } from '../../wallet/wallet-info';
import { config } from '../../test/config.test';
// import { Database } from '../../database/database';
// import { RailgunWallet } from '../../wallet/railgun-wallet';
// import { Prover } from '../../prover/prover';
// import { testArtifactsGetter } from '../../test/helper.test';
import { deriveNodes } from '../../key-derivation/wallet-node';

chai.use(chaiAsPromised);
const { expect } = chai;

const testMnemonic = config.mnemonic;
// const testEncryptionKey = config.encryptionKey;

// let db: Database;
// let wallet: RailgunWallet;

describe('memo', function run() {
  this.beforeAll(async () => {
    /// !EDIT: unnecessary, commented out.
    // db = new Database(memdown());
    // wallet = await RailgunWallet.fromMnemonic(
    //   db,
    //   testEncryptionKey,
    //   testMnemonic,
    //   0,
    //   undefined, // creationBlockNumbers
    //   new Prover(testArtifactsGetter),
    // );
    // WalletInfo.setWalletSource('Memo Wallet');
  });

  it('Should encrypt and decrypt note extra data', async () => {
    /// !EDIT: get a keypair a different way
    // const sender = wallet.getViewingKeyPair();
    const sender = await deriveNodes(testMnemonic, 0).viewing.getViewingKeyPair();

    const noteAnnotationData: NoteAnnotationData = {
      outputType: OutputType.BroadcasterFee,
      senderRandom: '1234567890abcde1234567890abcde', // 15 bytes
      walletSource: 'memo wallet',
    };
    const encryptedNoteAnnotationData = Memo.createEncryptedNoteAnnotationDataV2(
      noteAnnotationData.outputType,
      noteAnnotationData.senderRandom,
      'memo wallet',
      sender.privateKey,
    );

    expect(
      Memo.decryptNoteAnnotationData(encryptedNoteAnnotationData, sender.privateKey),
    ).to.deep.equal(noteAnnotationData);
  });

  it('Should encode and decode empty memo text', async () => {
    expect(Memo.encodeMemoText(undefined)).to.equal('');
    expect(Memo.decodeMemoText('')).to.equal(undefined);
  });

  it('Should encode and decode long memo text', async () => {
    const memoText =
      'A really long memo with emojis 😐👩🏾‍🔧😎 and other text !@#$%^&*() Private memo field 🤡🙀🥰👩🏿‍🚒🧞 🤡 🙀 🥰 👩🏿‍🚒 🧞, in order to test a major memo for a real live production use case.';

    const encoded = Memo.encodeMemoText(memoText);

    expect(encoded).to.deep.equal(
      '41207265616c6c79206c6f6e67206d656d6f207769746820656d6f6a697320f09f9890f09f91a9f09f8fbee2808df09f94a7f09f988e20616e64206f7468657220746578742021402324255e262a28292050726976617465206d656d6f206669656c6420f09fa4a1f09f9980f09fa5b0f09f91a9f09f8fbfe2808df09f9a92f09fa79e20f09fa4a120f09f998020f09fa5b020f09f91a9f09f8fbfe2808df09f9a9220f09fa79e2c20696e206f7264657220746f20746573742061206d616a6f72206d656d6f20666f722061207265616c206c6976652070726f64756374696f6e2075736520636173652e',
    );

    const decoded = Memo.decodeMemoText(encoded);

    expect(decoded).to.equal(memoText);
  });

  it('Should encode and decode memo text - new line over an emoji', async () => {
    const memoText = 'Private memo field 🤡🙀🥰👩🏿‍🚒🧞 🤡 🙀 🥰 👩🏿‍🚒 🧞,';

    const encoded = Memo.encodeMemoText(memoText);

    expect(encoded).to.deep.equal(
      '50726976617465206d656d6f206669656c6420f09fa4a1f09f9980f09fa5b0f09f91a9f09f8fbfe2808df09f9a92f09fa79e20f09fa4a120f09f998020f09fa5b020f09f91a9f09f8fbfe2808df09f9a9220f09fa79e2c',
    );

    const decoded = Memo.decodeMemoText(encoded);

    expect(decoded).to.equal(memoText);
  });

  it('Should encode and decode memo text without emojis', async () => {
    const memoText =
      'A really long memo in order to test a major memo for a real live production use case.';

    const encoded = Memo.encodeMemoText(memoText);
    const decoded = Memo.decodeMemoText(encoded);

    expect(decoded).to.equal(memoText);
  });
});
