import { bytesToHex } from '@noble/hashes/utils';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { getSharedSymmetricKeyLegacy } from '../keys-utils-legacy';
import { ByteUtils } from '../bytes';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('keys-utils-legacy', () => {
  it('getSharedSymmetricKeyLegacy stability', async () => {
    const privateKeyPairA = ByteUtils.hexStringToBytes(
      '0123456789012345678901234567890123456789012345678901234567891234',
    );
    const blindedPublicKeyPairB = ByteUtils.hexStringToBytes(
      '0987654321098765432109876543210987654321098765432109876543210987',
    );
    const symmetricKey = await getSharedSymmetricKeyLegacy(privateKeyPairA, blindedPublicKeyPairB);
    expect(bytesToHex(symmetricKey as Uint8Array)).to.equal(
      '64df806eadf85aba48fe2a7b4ecc783affcbeb7f63e9c9f6b8eb9422e2322874',
    );
  });
});
