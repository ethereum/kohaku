import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { WalletNode } from '../wallet-node';

chai.use(chaiAsPromised);
const { expect } = chai;

const VECTORS = [
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    path: "m/0'",
    spendingKeyPair: {
      privateKey: new Uint8Array([
        103, 215, 209, 157, 0, 230, 227, 179, 81, 127, 230, 138, 196, 101, 5, 221, 32, 125, 246,
        232, 254, 58, 160, 107, 163, 250, 206, 53, 46, 117, 153, 239,
      ]),
      pubkey: [
        1700559105542139805112168139351320601853033442476682590258553412078471731431n,
        20772987336827599306927277921643441679141423747083423413320022373456048866305n,
      ],
    },
    viewingKeyPair: {
      privateKey: new Uint8Array([
        103, 215, 209, 157, 0, 230, 227, 179, 81, 127, 230, 138, 196, 101, 5, 221, 32, 125, 246,
        232, 254, 58, 160, 107, 163, 250, 206, 53, 46, 117, 153, 239,
      ]),
      pubkey: new Uint8Array([
        13, 235, 247, 125, 142, 148, 54, 252, 7, 160, 220, 63, 232, 189, 144, 194, 245, 146, 160,
        140, 171, 141, 190, 95, 151, 42, 71, 131, 70, 92, 214, 212,
      ]),
    },
    nullifyingKey: 12835268173099116305231859677177501123414588269721547120001227054861606950622n,
  },
  {
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    path: "m/0'/1'",
    spendingKeyPair: {
      privateKey: new Uint8Array([
        52, 40, 207, 201, 57, 50, 3, 40, 80, 17, 116, 164, 231, 110, 134, 145, 151, 255, 200, 148,
        181, 141, 191, 77, 14, 149, 60, 72, 77, 102, 203, 94,
      ]),
      pubkey: [
        16684668252477829187059584092631702151145377657154285130424212860540363370357n,
        12981690610069374219327647242965768905998412239681315744257339323456415609107n,
      ],
    },
    viewingKeyPair: {
      privateKey: new Uint8Array([
        52, 40, 207, 201, 57, 50, 3, 40, 80, 17, 116, 164, 231, 110, 134, 145, 151, 255, 200, 148,
        181, 141, 191, 77, 14, 149, 60, 72, 77, 102, 203, 94,
      ]),
      pubkey: new Uint8Array([
        188, 10, 133, 20, 54, 28, 82, 39, 129, 118, 54, 192, 105, 143, 30, 183, 217, 77, 82, 240,
        122, 203, 88, 224, 107, 241, 219, 145, 159, 230, 69, 20,
      ]),
    },
    nullifyingKey: 12433581129726328896745774227574786958991377531034322249715552469191536529193n,
  },
  {
    mnemonic:
      'culture flower sunny seat maximum begin design magnet side permit coin dial alter insect whisper series desk power cream afford regular strike poem ostrich',
    path: "m/1984'/0'/1'/1'",
    spendingKeyPair: {
      privateKey: new Uint8Array([
        174, 161, 99, 229, 87, 84, 149, 94, 180, 249, 130, 131, 138, 60, 244, 236, 172, 83, 232, 9,
        167, 168, 25, 67, 167, 236, 115, 134, 66, 111, 157, 93,
      ]),
      pubkey: [
        14701770942636881946891894801429513727414463095087240498212571459549371788442n,
        6562351643365832094839703629534233618348049923815027910705830997906348902485n,
      ],
    },
    viewingKeyPair: {
      privateKey: new Uint8Array([
        174, 161, 99, 229, 87, 84, 149, 94, 180, 249, 130, 131, 138, 60, 244, 236, 172, 83, 232, 9,
        167, 168, 25, 67, 167, 236, 115, 134, 66, 111, 157, 93,
      ]),
      pubkey: new Uint8Array([
        28, 112, 24, 121, 34, 161, 22, 10, 20, 98, 221, 72, 216, 131, 91, 146, 55, 237, 168, 255,
        121, 6, 217, 124, 152, 150, 232, 196, 138, 161, 179, 243,
      ]),
    },
    nullifyingKey: 16602386444438786679333393766394518037774007889700655746209679443354561523707n,
  },
];

describe('key-derivation', () => {
  it('Should derive spending keys', async () => {
    // TODO-VECTORS: Vectors need confirming.

    await Promise.all(
      VECTORS.map(async (vector) => {
        const node = WalletNode.fromMnemonic(vector.mnemonic);
        expect(node.derive(vector.path).getSpendingKeyPair()).to.deep.equal(vector.spendingKeyPair);
      }),
    );
  });

  it('Should derive viewing keys', async () => {
    // TODO-VECTORS: Vectors need confirming.

    await Promise.all(
      VECTORS.map(async (vector) => {
        const node = WalletNode.fromMnemonic(vector.mnemonic);
        expect(await node.derive(vector.path).getViewingKeyPair()).to.deep.equal(
          vector.viewingKeyPair,
        );
      }),
    );
  });

  it('Should derive nullifying keys', async () => {
    // TODO-VECTORS: Vectors need confirming.

    await Promise.all(
      VECTORS.map(async (vector) => {
        const node = WalletNode.fromMnemonic(vector.mnemonic);
        const nullifyingKey = await node.derive(vector.path).getNullifyingKey();
        expect(nullifyingKey).to.equal(vector.nullifyingKey);
      }),
    );
  });
});
