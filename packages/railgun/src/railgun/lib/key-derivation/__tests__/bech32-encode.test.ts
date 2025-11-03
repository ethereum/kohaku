import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { ChainType } from '../../models/engine-types';
import { ByteLength, ByteUtils } from '../../utils/bytes';
import { AddressData, ADDRESS_LENGTH_LIMIT, decodeAddress, encodeAddress } from '../bech32';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('bech32-encode', () => {
  it('Should encode and decode addresses', () => {
    const vectors = [
      {
        pubkey: '00000000',
        chain: { type: ChainType.EVM, chainId: 1 },
        address:
          '0zk1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqunpd9kxwatwqyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqhshkca',
        version: 1,
      },
      {
        pubkey: '01bfd5681c0479be9a8ef8dd8baadd97115899a9af30b3d2455843afb41b',
        chain: { type: ChainType.EVM, chainId: 56 },
        address:
          '0zk1qyqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkunpd9kxwatw8qqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkcsu8tp',
        version: 1,
      },
      {
        pubkey: '01bfd5681c0479be9a8ef8dd8baadd97115899a9af30b3d2455843afb41b',
        chain: { type: 1, chainId: 56 },
        address:
          '0zk1qyqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkumpd9kxwatw8qqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkwrfm4m',
        version: 1,
      },
      {
        pubkey: 'ee6b4c702f8070c8ddea1cbb8b0f6a4a518b77fa8d3f9b68617b664550e75f64',
        chain: undefined,
        address:
          '0zk1q8hxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kfrv7j6fe3z53llhxknrs97q8pjxaagwthzc0df99rzmhl2xnlxmgv9akv32sua0kg0zpzts',
        version: 1,
      },
    ];

    for (const [index, vector] of vectors.entries()) {
      const addressData: AddressData = {
        masterPublicKey: ByteUtils.hexToBigInt(vector.pubkey),
        viewingPublicKey: ByteUtils.hexStringToBytes(
          ByteUtils.formatToByteLength(vector.pubkey, ByteLength.UINT_256, false),
        ),
        chain: vector.chain,
        version: vector.version,
      };
      const encoded = encodeAddress(addressData);

      expect(encoded).to.equal(vector.address);
      expect(encoded.length).to.equal(ADDRESS_LENGTH_LIMIT);
      expect(decodeAddress(encoded)).to.deep.equal(
        addressData,
        `Incorrect values for vector index ${index}`,
      );
    }
  });

  it('Should throw error on invalid address checksum', () => {
    expect(() => {
      decodeAddress('rgany1pnj7u66vwqhcquxgmh4pewutpa4y55vtwlag60umdpshkej92rn47ey76ges3t3enn');
    }).to.throw('Invalid checksum');
  });

  it('Should throw error on invalid address prefix', () => {
    expect(() => {
      decodeAddress(
        'rg1qyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqunpd9kxwatwqyqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsfhuuw',
      );
    }).to.throw('Failed to decode bech32 address');
  });
});
