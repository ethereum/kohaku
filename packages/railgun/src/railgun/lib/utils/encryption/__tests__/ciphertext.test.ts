import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ByteUtils } from '../../bytes';
import {
  ciphertextToEncryptedJSONData,
  ciphertextToEncryptedRandomData,
  encryptedDataToCiphertext,
} from '../ciphertext';
import { AES } from '../aes';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('ciphertext', () => {
  it('Should translate ciphertext to encrypted random and back', () => {
    const plaintext: string[] = [ByteUtils.randomHex(16)];
    const key = ByteUtils.randomHex(32);
    const ciphertext = AES.encryptGCM(plaintext, key);

    const encryptedData = ciphertextToEncryptedRandomData(ciphertext);
    const newCiphertext = encryptedDataToCiphertext(encryptedData);

    expect(newCiphertext).to.deep.equal(ciphertext);
  });

  it('Should translate ciphertext to encrypted data and back', () => {
    const plaintext: string[] = [];

    for (let i = 0; i < 40; i += 1) plaintext.push(ByteUtils.randomHex(32));
    const key = ByteUtils.randomHex(32);
    const ciphertext = AES.encryptGCM(plaintext, key);

    const encryptedData = ciphertextToEncryptedJSONData(ciphertext);
    const newCiphertext = encryptedDataToCiphertext(encryptedData);

    expect(newCiphertext).to.deep.equal(ciphertext);
  });
});
