import { poseidon } from '@railgun-community/circomlibjs';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { keccak256, sha256, sha512HMAC } from '../hash';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('hash', () => {
  it('Should perform sha256 hashes', () => {
    const vectors = [
      {
        preImage: '',
        array: new Uint8Array([]),
        result: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      {
        preImage: '5241494c47554e',
        array: new Uint8Array([82, 65, 73, 76, 71, 85, 78]),
        result: 'b25e4f3027088a658fa918eb93fd905969be8f455adb942987aa866013c9f836',
      },
      {
        preImage: '50524956414359202620414e4f4e594d495459',
        array: new Uint8Array([
          80, 82, 73, 86, 65, 67, 89, 32, 38, 32, 65, 78, 79, 78, 89, 77, 73, 84, 89,
        ]),
        result: '947fa99dc47b17d91b3aceec798dcee836744c68423e9b41b9d1b7ffba8fdc8c',
      },
    ];

    for (const vector of vectors) {
      // Test hex string hash
      expect(sha256(vector.preImage)).to.equal(vector.result);

      // Test bytes array hash
      expect(sha256(vector.array)).to.equal(vector.result);
    }
  });

  it('Should perform keccak256 hashes', () => {
    const vectors = [
      {
        preImage: '',
        array: new Uint8Array([]),
        result: 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
      },
      {
        preImage: '5241494c47554e',
        array: new Uint8Array([82, 65, 73, 76, 71, 85, 78]),
        result: 'ef0394c8ea7550db58adcb1b8ffb98f76fca939554a4084889b6bffa01aac296',
      },
      {
        preImage: '50524956414359202620414e4f4e594d495459',
        array: new Uint8Array([
          80, 82, 73, 86, 65, 67, 89, 32, 38, 32, 65, 78, 79, 78, 89, 77, 73, 84, 89,
        ]),
        result: '5c7d261b35e3b58c6ca6663e44b736a7fbbc0e2265cd050959f4976f8667d306',
      },
    ];

    for (const vector of vectors) {
      // Test hex string hash
      expect(keccak256(vector.preImage)).to.equal(vector.result);

      // Test bytes array hash
      expect(keccak256(vector.array)).to.equal(vector.result);
    }
  });

  it('Should perform sha512 HMAC hashes', () => {
    const vectors = [
      {
        preImage: '',
        array: new Uint8Array([]),
        key: 'aa',
        keyArray: new Uint8Array([170]),
        result:
          '4e9f386d58475d4e030c55c47f54ab3e2e5790d2aaaedc2f4465b5665a5307da3416778a481a09a2f18e1db63c26d741aa0a82af5a38a893bf9793fb7dea031e',
      },
      {
        preImage: '5241494c47554e',
        array: new Uint8Array([82, 65, 73, 76, 71, 85, 78]),
        key: 'bb',
        keyArray: new Uint8Array([187]),
        result:
          '206aca0dd9a7d87873692ff48a91f0c495ab896c488c4af5e7062774e8841298ddc9eee9699a6930b545aebf6dd3504bcef331231368318da26bb3783fdcc086',
      },
      {
        preImage: '50524956414359202620414e4f4e594d495459',
        array: new Uint8Array([
          80, 82, 73, 86, 65, 67, 89, 32, 38, 32, 65, 78, 79, 78, 89, 77, 73, 84, 89,
        ]),
        key: 'cc',
        keyArray: new Uint8Array([204]),
        result:
          'b3513bb5230d933d8dc2cf28eddfa566bb76f49aa9bdf6f2475df0405feaaab4782d9d7a177ee9e32aa1e0af0ca0bb93a3c0312aa18788c7944a24f761bdcc1a',
      },
    ];

    for (const vector of vectors) {
      // Test hex string hash
      expect(sha512HMAC(vector.key, vector.preImage)).to.equal(vector.result);

      // Test bytes array hash
      expect(sha512HMAC(vector.keyArray, vector.array)).to.equal(vector.result);
    }
  });

  it('Should perform poseidon hashes', () => {
    const vectors = [
      {
        preImage: [1n, 2n],
        result: BigInt('0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a'),
      },
      {
        preImage: [1n, 2n, 3n, 4n],
        result: BigInt('0x299c867db6c1fdd79dcefa40e4510b9837e60ebb1ce0663dbaa525df65250465'),
      },
      {
        preImage: [BigInt('0x6b021e0d06d0b2d161cf0ea494e3fc1cbff12cc1b29281f7412170351b708fad')],
        result: BigInt('0x0b77a7c8dcbf2c84e75b6ff1dd558365532956cb7c1f328a67220a3a47a3ab43'),
      },
    ];

    for (const vector of vectors) {
      expect(poseidon(vector.preImage)).to.equal(vector.result);
    }
  });
});
