import * as curve25519 from '@noble/ed25519';
import { randomBytes } from '@noble/hashes/utils';
import chai, { assert } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ByteUtils} from '../bytes';
import { encryptJSONDataWithSharedKey, tryDecryptJSONDataWithSharedKey } from '../ecies';
import { getSharedSymmetricKeyLegacy } from '../keys-utils-legacy';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('ecies', () => {
  it('Should encrypt and decrypt data using shared keys', async () => {
    const privateKey1 = randomBytes(32);
    const publicKey1 = await curve25519.getPublicKey(privateKey1);
    const privateKey2 = randomBytes(32);
    const publicKey2 = await curve25519.getPublicKey(privateKey2);

    const data: object = {
      text: '468abc',
      value: 2839094,
      hex: ByteUtils.hexlify(ByteUtils.randomHex(), true),
    };

    const sharedKey = await getSharedSymmetricKeyLegacy(privateKey2, publicKey1);

    assert(sharedKey != null);
    const encryptedData = encryptJSONDataWithSharedKey(data, sharedKey);

    const sharedKeyAlternate = await getSharedSymmetricKeyLegacy(privateKey1, publicKey2);

    expect(sharedKeyAlternate).to.deep.equal(sharedKey);
    assert(sharedKeyAlternate != null);

    const decrypted = tryDecryptJSONDataWithSharedKey(encryptedData, sharedKeyAlternate);

    expect(decrypted).to.deep.equal(data);
  });
});
