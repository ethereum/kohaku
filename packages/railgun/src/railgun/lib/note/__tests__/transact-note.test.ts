// import chai from 'chai';
// import chaiAsPromised from 'chai-as-promised';
// import memdown from 'memdown';
// import { randomBytes } from 'ethers';
// import Sinon from 'sinon';
// import { ContractStore } from '../../contracts/contract-store';
// import { RailgunSmartWalletContract } from '../../contracts/railgun-smart-wallet/V2/railgun-smart-wallet';
// import { Database } from '../../database/database';
// import { ViewingKeyPair } from '../../key-derivation/wallet-node';
// import { Chain, ChainType } from '../../models/engine-types';
// import { Ciphertext, LegacyNoteSerialized, OutputType } from '../../models/formatted-types';
// import { config } from '../../test/config.test';
// import { TokenDataGetter } from '../../token/token-data-getter';
// import { ByteLength, ByteUtils } from '../../utils/bytes';
// import { getPublicViewingKey } from '../../utils/keys-utils';
// import { getTokenDataERC20 } from '../note-util';
// import { TransactNote } from '../transact-note';
// import { PollingJsonRpcProvider } from '../../provider/polling-json-rpc-provider';
// import { getTestTXIDVersion, isV2Test } from '../../test/helper.test';
// import { Memo } from '../memo';
// import { WalletInfo } from '../../wallet/wallet-info';
// import { TokenVaultContract } from '../../contracts/railgun-smart-wallet/V3/token-vault-contract';
// import { TXIDVersion } from '../../models/poi-types';

// chai.use(chaiAsPromised);
// const { expect } = chai;

// const BLOCK_NUMBER = 100;

// const txidVersion = getTestTXIDVersion();

// const vectors: {
//   note: LegacyNoteSerialized;
//   pubkey: string;
//   random: string;
//   vpk: string;
//   hash: string;
// }[] = [
//   {
//     note: {
//       npk: '23da85e72baa8d77f476a893de0964ce1ec2957d056b591a19d05bb4b9a549ed',
//       tokenHash: '0000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192',
//       value: '0000000000000000086aa1ade61ccb53',
//       encryptedRandom: [
//         '0x5c4a783fd15546fbad149c673b7139790a9cf62ec849a5a8e6a167815ee2d08d',
//         '0x260693ec8dd38f5be7758b6786bc579e',
//       ] as [string, string],
//       memoField: ['01'],
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//       memoText: undefined,
//       blockNumber: BLOCK_NUMBER,
//     },
//     pubkey: '9902564685f24f396263c64f582aa9a87499704509c60862930b1f9f7d258e8e',
//     random: '85b08a7cd73ee433072f1d410aeb4801',
//     vpk: '0b252eea1d78ff7b2ad19ea161dfe380686a099f9713719d2eff85196a607685',
//     hash: '29decce78b2f43c718ebb7c6825617ea6881836d88d9551dd2530c44f0d790c5',
//   },
//   {
//     note: {
//       npk: '21eacdfdbe32555ed1c08c4872e73da1e59cb47f7f9d886f702b0e0e6399474c',
//       tokenHash: '000000000000000000000000df0fa4124c8a5feec8efcb0e0142d3e04a9e0fbf',
//       value: '000000000000000007cf6b5ae17ae75a',
//       encryptedRandom: [
//         '0xf401e001c520b9f40d37736c0ef2309fa9b2dc97bf1634ac1443fc2fe5359f69',
//         '0x093481f1f6ab744d9f937e6ec796e300',
//       ] as [string, string],
//       memoField: ['01'],
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//       memoText: undefined,
//       blockNumber: BLOCK_NUMBER,
//     },
//     pubkey: 'ab017ebda8fae25c92ecfc38f219c0ed1f73538bc9dc8e5db8ae46f3b00d5a2f',
//     random: 'f7c477afb5a3eb31dbb96295cdbcf165',
//     vpk: '0a13664024e298e53bf01342e2111ae314f9595b12107e85cf0066e4b04cb3a3',
//     hash: '2d78128d8bd632fa45e76906b6d58bbb7b581d28a040565b688adb498b8e37db',
//   },
//   {
//     note: {
//       npk: '24203d63bb50c2cfc256c405b81147058ded5ab422c97489dddef7a2486217d7',
//       tokenHash: '00000000000000000000000034e34b5d8e848f9d20d9bd8e1e48e24c3b87c396',
//       value: '00000000000000000b9df0087cbbd709',
//       encryptedRandom: [
//         '0x4b0b63e8f573bf29cabc8e840c5db89892c0acc3f30bbdf6ad9d39ac9485fa49',
//         '0xcbfb4c84c0669aaf184a621c9d21e9ae',
//       ] as [string, string],
//       memoField: ['01'],
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//       memoText: undefined,
//       blockNumber: BLOCK_NUMBER,
//     },
//     pubkey: '4704ae101848ca47a6734d0e9210a5ecc204b97541fa1b808e5551319b49ec24',
//     random: '6d8a7e26de6b0638cd092c2a2b524705',
//     vpk: '099ba7ffc589df18402385d7c0d4771555dffd2a6514fc136c565ea1ee3bb520',
//     hash: '0d046f7423d5e69726cf2d98d2c5c3fe089f3151f9ac968e2314696efa833f62',
//   },
//   {
//     note: {
//       npk: '099729608f0c9671590c98730a40b7da122808b9691582a423526ec45f8b1b04',
//       tokenHash: '0000000000000000000000009b71cad96341485290d3f1376fb9e969a632694d',
//       value: '00000000000000000ac76747c40dda3a',
//       encryptedRandom: [
//         '0xe9abf13a310d1910d3010a1cf8b5c03a50c228f1fe81de21734479398973ec77',
//         '0x00b0994bd02746fc55c1ff8c75aeb285',
//       ] as [string, string],
//       memoField: ['01'],
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//       memoText: undefined,
//       blockNumber: BLOCK_NUMBER,
//     },
//     pubkey: 'bd0f57ea13604d47c9080859ee96d010496cccbfed2ca2062ee3e2d0fcd24e9e',
//     random: 'f13666966cffa395e3d412ea4e20480f',
//     vpk: '0c78af78aea7d17b6d9d57fedede59f83c782b562542f9f4ed0900f18d034103',
//     hash: '0884efbb8db3db4eca63150fb2f51882ffffdaa9b70b57a3f2e1dd672d028991',
//   },
//   {
//     note: {
//       npk: '239ca439444c50907c4259e200b4314d19fed2ab7bcc2b236e60f90d5962ca8e',
//       tokenHash: '00000000000000000000000089d21609e4ea344c576d1692ceca0f0e0bf4b771',
//       value: '00000000000000000475d82f700206b8',
//       encryptedRandom: [
//         '0x7462849ef8b7bdbb9deeae7983f84334d934d129bd7a7e926bd87b6cf0053e0d',
//         '0xda7cd10423b3d1e48bb7dd47062ac632',
//       ] as [string, string],
//       memoField: ['01'],
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//       memoText: undefined,
//       blockNumber: BLOCK_NUMBER,
//     },
//     pubkey: 'd7091b2e84b3fcbe1a688b9e08bf45850a1e8ff0f7e2de19971a6d871ae8a186',
//     random: '0bf6750e00739619a1a00f9b8f1bc2be',
//     vpk: '0fc2d4688b94afa262226b601dd3f9fe955a2bd7310ac01f02e8d1a62e35c0a1',
//     hash: '03d83b5835628196b3ccf557e0ae2b0e933b95fedcc48b7ae36bbb85f9a0b385',
//   },
//   {
//     note: {
//       npk: '058075b59e688d3e879a72e97e3a68de05cc4d7f76bb8e4246ac4a9a9700698b',
//       tokenHash: '0000000000000000000000006f2870a30f4ff19f073fe894d6fe881f0c04657f',
//       value: '000000000000000003426801bd08640b',
//       encryptedRandom: [
//         '0xe501c3195c8a4cc2134ed19d69ba1208a4c7f4ef6f33c2c5e51655f919d4855e',
//         '0xe533c677c5fa66c511a70125edfcd2ac',
//       ] as [string, string],
//       memoField: ['01'],
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//       memoText: undefined,
//       blockNumber: BLOCK_NUMBER,
//     },
//     pubkey: 'fd13f6d7000238c3de83582583f3654a1f14de55143191b89415e35ae2abdf90',
//     random: 'd8c0caf1b041611d408b5f01e7eae957',
//     vpk: '0b49b73e4c7c184aff7c99af820be7f8a32a602724f58abbfef38494931e5405',
//     hash: '2dad5a92aa41aa8166507524eae1fda360f69daff11c0058a312c8c2cd431fe9',
//   },
//   {
//     note: {
//       npk: '2856460b27f8896e81009b2a0d0760bc03c07cd854570018cd0b53061f697acf',
//       tokenHash: '0000000000000000000000004224904029a556a7cd0bc78d81b165c391fffb45',
//       value: '000000000000000003449e13312815a6',
//       encryptedRandom: [
//         '0x1bef951429c37eaa69190cb635591d122ffe959d690366876e9f1704aa37bb18',
//         '0x8ae56f06a6fe0c39b47f8b28c178f3e0',
//       ] as [string, string],
//       memoField: ['01'],
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//       memoText: undefined,
//       blockNumber: BLOCK_NUMBER,
//     },
//     pubkey: '13e865e8f6160ce58efaf5b2f53facb4b5f16249b0411951e8f7e12a3d95d694',
//     random: '44a514b4db4659e8520d570f3252c0cf',
//     vpk: '0f6344893b62deb6c83178aa6883192941eae50eb8eec2854ad0c942b4a2a241',
//     hash: '2ee5f10f4db3ab2beab040e49cef37bc3f87852bacb6c66b6176a1ded3e33a2a',
//   },
//   {
//     note: {
//       npk: '03c8d39bf8186f0d478a853b7102c0bec63e1fbb4ce2d6e8d289cc698e116fc0',
//       tokenHash: '000000000000000000000000480bdc4d52df318db7b458b171540a936dc39a07',
//       value: '000000000000000008d210fd771f72ab',
//       encryptedRandom: [
//         '0x789ee74fc10fd3b8daac3846b307d7d20db76ca9d5b6894c78f58b2ebc0303e4',
//         '0x35a7d7e3b7c178dbf3ff6c985bceeee6',
//       ] as [string, string],
//       memoField: ['01'],
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//       memoText: undefined,
//       blockNumber: BLOCK_NUMBER,
//     },
//     pubkey: 'bda28a024a0b77ba51e89b17e7b8d221b2e7c1a818c8e53c78cdc3a8479807a4',
//     random: '77c31ed0577a986750c8dce8804af5b9',
//     vpk: '08baacccf37c1de3edc6e0a0270d8f999b9d7ed5ea7dbae68015b0dade2d5d65',
//     hash: '00eb817d3790cdb84dc2f4c8cc4f1ee9f4c6b737f6d036e4516037d059100472',
//   },
//   {
//     note: {
//       npk: '2edc5f1181d22381b83db79e558bbe6e7739da59dc71d31dff3074d4bec38f3b',
//       tokenHash: '0000000000000000000000008afe4263f81c6d01cb6ea2548132a82d4c5b16e8',
//       value: '0000000000000000060c736c94f022c6',
//       encryptedRandom: [
//         '0x82df79ed67267bd528f0302a95129bbb56d04fab22f95af35b03d2c07ac75737',
//         '0x273588a6fab60d09b7f4155e2bf4aded',
//       ] as [string, string],
//       memoField: ['01'],
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//       memoText: undefined,
//       blockNumber: BLOCK_NUMBER,
//     },
//     pubkey: '6a26fe361ff14ef4c931c82acc8c772d5a349a4d1af75bff27dde944ec713b27',
//     random: '6478eea9c496942f0f25967c11fc4bbd',
//     vpk: '08abd3c723fd7fc91b183a32a48205acd6cecb452d36d23a9273fc46f22abe60',
//     hash: '162cd1401ab95aed7ed1b60ec661331d6fb9f632431bef43fcd5e14f7f876b4b',
//   },
//   {
//     note: {
//       npk: '10cd7f88b213cb9efcd58f7a45eed24e39513b640e913aa48de129d2685199b1',
//       tokenHash: '0000000000000000000000004f53cbc84f501847cf42bd9fb14d63be21dcffc8',
//       value: '0000000000000000005589f7d39c59bf',
//       encryptedRandom: [
//         '0x4732f678e893c09c6393be8f8fcc5eee1d9a1078a16151dcae2d65f2d78edc4b',
//         '0xc675ab6de72d03033cf0bafaa0391b2e',
//       ] as [string, string],
//       memoField: ['01'],
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//       memoText: undefined,
//       blockNumber: BLOCK_NUMBER,
//     },
//     pubkey: 'c103873aa9d88c4c4cbc4cac97f7b57d01ab3587500c1d1c90fe3991b1dab882',
//     random: '2e16e1cdda5f94ddb9981d3811924b05',
//     vpk: '092547b5af1fa658e03433596910f8ea42419998b61f09f55b3cd1c85a7da620',
//     hash: '29a0dfbe68f52c2ddc7a772785a4751adb6e846dc6b1fcf79872aae0c5700f53',
//   },
// ];

// const ciphertextVectors: {
//   note: {
//     pubkey: string;
//     random: string;
//     amount: string;
//     token: string;
//     recipientAddress?: string;
//   };
//   sharedKey: string;
//   ciphertext: Ciphertext;
// }[] = [
//   {
//     note: {
//       pubkey: '6595f9a971c7471695948a445aedcbb9d624a325dbe68c228dea25eccf61919d',
//       random: '85b08a7cd73ee433072f1d410aeb4801',
//       amount: '000000000000000000000000000000000000000000000000086aa1ade61ccb53',
//       token:
//         '0000000000000000000000000000000000000000000000007f4925cdf66ddf5b88016df1fe915e68eff8f192',
//       recipientAddress:
//         '0zk1qxvsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8garv7j6fe3z53l7vsy4jxshey7wtzv0ry7kp24x58fxtsg5yuvzrzjv93l8mayk8guau6ef8',
//     },
//     sharedKey: 'b8b0ee90e05cec44880f1af4d20506265f44684eb3b6a4327bcf811244dc0a7f',
//     ciphertext: {
//       iv: '0x5f8c104eec6e72996078ca3149a153c0',
//       tag: '0xb1959596279a0c3bd9ec7e16f2fad8c6',
//       data: [
//         'ed60c5dc0304f63e6e201e2311467bd112b90224dfd523eeaafd2e59b66198c0',
//         '3f67deea78b30df94e415d01296aee9e84f30a13',
//         '09c6e5e8efc57491911d2d5b36acb6d585b1d784185a5ac0b0bba1ece3a68c36',
//       ],
//     },
//   },
//   {
//     note: {
//       pubkey: 'ab017ebda8fae25c92ecfc38f219c0ed1f73538bc9dc8e5db8ae46f3b00d5a2f',
//       random: 'f7c477afb5a3eb31dbb96295cdbcf165',
//       amount: '00000000000000000000000000000000000000000000000007cf6b5ae17ae75a',
//       token:
//         '000000000000000000000000000000000000000000000000df0fa4124c8a5feec8efcb0e0142d3e04a9e0fbf',
//     },
//     sharedKey: 'c8c2a74bacf6ce3158069f81202d8c2d81fd25d226d7536f26442888c014a755',
//     ciphertext: {
//       iv: '0xf5bab8e512e9f729f65f21369a86db56',
//       tag: '0xa800eff5cfbe3b6bb0523057957e105b',
//       data: [
//         '3410be7a6027e32e6ff52e46cbef9b22492329a8e9cd3a9c4e39e421280c1c62',
//         'e49b63bc7de8973064b43cd556d3c9d975eafa35',
//         'bc8ab045ae8452b79881b1bc201ef85bc6a24ddd6b646710e27e663a751335bd',
//       ],
//     },
//   },
//   {
//     note: {
//       pubkey: '4704ae101848ca47a6734d0e9210a5ecc204b97541fa1b808e5551319b49ec24',
//       random: '6d8a7e26de6b0638cd092c2a2b524705',
//       amount: '0000000000000000000000000000000000000000000000000b9df0087cbbd709',
//       token:
//         '00000000000000000000000000000000000000000000000034e34b5d8e848f9d20d9bd8e1e48e24c3b87c396',
//     },
//     sharedKey: '4676adb24e597086894880767f274818f711233eda9d617b348bb1cf92dd35e5',
//     ciphertext: {
//       iv: '0xb9a10ed717b6102d8943bdf0190947f4',
//       tag: '0x20f0fa2bb52614c833076b6dd2dbe40f',
//       data: [
//         'd0e4bd3f27ac20e748cd799125bff35c3e6e7222c838931f2d7fe7093d387fb2',
//         '56b67175b0f447c630c2603db983612eb21dcd9b',
//         'd73a3634b0b1bdcefdbdb870b7b05bb6dda74f207bd90932655434c2a9dbf677',
//       ],
//     },
//   },
// ];

// let db: Database;
// let tokenDataGetter: TokenDataGetter;
// let chain: Chain;

// describe('transact-note', () => {
//   beforeEach(() => {
//     db = new Database(memdown());
//     chain = {
//       type: ChainType.EVM,
//       id: 1,
//     };

//     WalletInfo.setWalletSource('tester');

//     // Load fake contracts
//     ContractStore.railgunSmartWalletContracts.set(
//       null,
//       chain,
//       new RailgunSmartWalletContract(
//         config.contracts.proxy,
//         new PollingJsonRpcProvider(config.rpc, 1, 500, 1),
//         new PollingJsonRpcProvider(config.rpc, 1, 500, 1),
//         chain,
//       ),
//     );
//     ContractStore.tokenVaultV3Contracts.set(
//       null,
//       chain,
//       new TokenVaultContract(
//         config.contracts.poseidonMerkleVerifierV3,
//         new PollingJsonRpcProvider(config.rpc, 1, 500, 1),
//       ),
//     );

//     tokenDataGetter = new TokenDataGetter(db);
//   });

//   it('Should encrypt and decrypt notes', async () => {
//     await Promise.all(
//       ciphertextVectors.map(async (vector) => {
//         const viewingPublicKey = ByteUtils.hexStringToBytes(vector.note.pubkey);

//         // Create Note object
//         const address = {
//           masterPublicKey: ByteUtils.hexToBigInt(vector.note.pubkey),
//           viewingPublicKey,
//         };
//         const privateViewingKey = randomBytes(32);
//         const publicViewingKey = await getPublicViewingKey(privateViewingKey);
//         const viewingKeyPair: ViewingKeyPair = {
//           privateKey: privateViewingKey,
//           pubkey: publicViewingKey,
//         };

//         const tokenData = getTokenDataERC20(vector.note.token);

//         const stubRandom = Sinon.stub(TransactNote, 'getNoteRandom').returns(vector.note.random);

//         const note = TransactNote.createTransfer(
//           address,
//           address,
//           ByteUtils.hexToBigInt(vector.note.amount),
//           tokenData,
//           false, // showSenderAddressToRecipient
//           OutputType.BroadcasterFee,
//           'something', // memoText
//         );

//         stubRandom.restore();

//         const sharedKeyBytes = ByteUtils.hexStringToBytes(vector.sharedKey);

//         let noteCiphertext;
//         let noteMemo;
//         let annotationData;

//         switch (txidVersion) {
//           case TXIDVersion.V2_PoseidonMerkle: {
//             const encryptedValues = note.encryptV2(
//               txidVersion,
//               sharedKeyBytes,
//               address.masterPublicKey,
//               note.senderRandom,
//               viewingKeyPair.privateKey,
//             );
//             noteCiphertext = encryptedValues.noteCiphertext;
//             noteMemo = encryptedValues.noteMemo;
//             annotationData = encryptedValues.annotationData;
//             break;
//           }
//           case TXIDVersion.V3_PoseidonMerkle: {
//             noteCiphertext = note.encryptV3(txidVersion, sharedKeyBytes, address.masterPublicKey);
//             noteMemo = '';
//             annotationData = Memo.createSenderAnnotationEncryptedV3(
//               WalletInfo.walletSource,
//               [note.outputType as OutputType],
//               viewingKeyPair.privateKey,
//             );
//             break;
//           }
//         }

//         // Check if encrypted values are successfully decrypted
//         const decrypted = await TransactNote.decrypt(
//           txidVersion,
//           chain,
//           address,
//           noteCiphertext,
//           sharedKeyBytes,
//           noteMemo,
//           annotationData,
//           viewingKeyPair.privateKey,
//           undefined, // blindedReceiverViewingKey
//           undefined, // blindedSenderViewingKey
//           true, // isSentNote
//           true, // isLegacyDecryption
//           tokenDataGetter,
//           BLOCK_NUMBER,
//           isV2Test() ? undefined : 0, // transactCommitmentBatchIndex
//         );
//         expect(decrypted.tokenHash).to.equal(note.tokenHash);
//         expect(decrypted.value).to.equal(note.value);
//         expect(decrypted.random).to.equal(note.random);
//         // expect(decrypted.hash).to.equal(note.hash);
//         expect(decrypted.memoText).to.equal(note.memoText);

//         // Check if vector encrypted values are successfully decrypted
//         const decryptedFromCiphertext = await TransactNote.decrypt(
//           txidVersion,
//           chain,
//           address,
//           noteCiphertext,
//           sharedKeyBytes,
//           noteMemo,
//           annotationData,
//           viewingKeyPair.privateKey,
//           undefined, // blindedReceiverViewingKey
//           undefined, // blindedSenderViewingKey
//           true, // isSentNote
//           true, // isLegacyDecryption
//           tokenDataGetter,
//           BLOCK_NUMBER,
//           isV2Test() ? undefined : 0, // transactCommitmentBatchIndex
//         );
//         expect(decryptedFromCiphertext.tokenHash).to.equal(note.tokenHash);
//         expect(decryptedFromCiphertext.value).to.equal(note.value);
//         expect(decryptedFromCiphertext.random).to.equal(note.random);
//         // TODO: Update vectors for note hashes
//         // expect(decryptedFromCiphertext.hash).to.equal(note.hash);
//         expect(decryptedFromCiphertext.memoText).to.equal(note.memoText);
//         expect(decryptedFromCiphertext.receiverAddressData.masterPublicKey).to.equal(
//           address.masterPublicKey,
//         );
//         expect(decryptedFromCiphertext.receiverAddressData.viewingPublicKey).to.deep.equal(
//           new Uint8Array(),
//         );
//       }),
//     );
//   });

//   it('Should serialize and deserialize notes', async () => {
//     await Promise.all(
//       vectors.map(async (vector) => {
//         const vectorBytes = ByteUtils.hexStringToBytes(vector.vpk);

//         const note = await TransactNote.deserialize(
//           txidVersion,
//           chain,
//           vector.note,
//           vectorBytes,
//           tokenDataGetter,
//         );
//         expect(ByteUtils.hexlify(note.random)).to.equal(vector.random);

//         const hexHash = ByteUtils.nToHex(note.hash, ByteLength.UINT_256);
//         expect(hexHash).to.equal(vector.hash);

//         const reserialized = note.serialize();
//         expect(reserialized.npk).to.equal(vector.note.npk);
//         expect(reserialized.value).to.equal(vector.note.value);
//         expect(reserialized.tokenHash).to.equal(vector.note.tokenHash);
//         expect(reserialized.recipientAddress).to.equal(vector.note.recipientAddress);

//         const reserializedContract = note.serialize(true);
//         expect(reserializedContract.value).to.equal(`0x${vector.note.value}`);
//         expect(reserializedContract.tokenHash).to.equal(`0x${vector.note.tokenHash}`);
//         expect(reserializedContract.recipientAddress).to.equal(vector.note.recipientAddress);
//       }),
//     );
//   });

//   it('Should serialize and deserialize notes (legacy V1-V2)', async () => {
//     await Promise.all(
//       vectors.map(async (vector) => {
//         const vectorBytes = ByteUtils.hexStringToBytes(vector.vpk);

//         const note = await TransactNote.deserialize(
//           txidVersion,
//           chain,
//           vector.note,
//           vectorBytes,
//           tokenDataGetter,
//         );
//         expect(ByteUtils.hexlify(note.random)).to.equal(vector.random);

//         const hexHash = ByteUtils.nToHex(note.hash, ByteLength.UINT_256);
//         expect(hexHash).to.equal(vector.hash);

//         const reserialized = note.serializeLegacy(vectorBytes);
//         expect(reserialized.npk).to.equal(vector.note.npk);
//         expect(reserialized.value).to.equal(vector.note.value);
//         expect(reserialized.tokenHash).to.equal(vector.note.tokenHash);
//         expect(reserialized.memoField).to.deep.equal([]);
//         expect(reserialized.recipientAddress).to.equal(vector.note.recipientAddress);

//         const reserializedContract = note.serializeLegacy(vectorBytes, true);
//         expect(reserializedContract.value).to.equal(`0x${vector.note.value}`);
//         expect(reserializedContract.tokenHash).to.equal(`0x${vector.note.tokenHash}`);
//         expect(reserializedContract.memoField).to.deep.equal([]);
//         expect(reserializedContract.recipientAddress).to.equal(vector.note.recipientAddress);
//       }),
//     );
//   });

//   it('Should calculate nullifiers', () => {
//     const nullifierVectors = [
//       {
//         privateKey: '08ad9143ae793cdfe94b77e4e52bc4e9f13666966cffa395e3d412ea4e20480f',
//         tree: 0,
//         position: 0,
//         nullifier: '03f68801f3ee2ed10178c162b4f7f1bd466bc9718f4f98175fc04934c5caba6e',
//       },
//       {
//         privateKey: '11299eb10424d82de500a440a2874d12f7c477afb5a3eb31dbb96295cdbcf165',
//         tree: 1,
//         position: 12,
//         nullifier: '1aeadb64bf8faff93dfe26bcf0b2e2d0e9724293cc7a455f028b6accabee13b8',
//       },
//       {
//         privateKey: '09b57736523cda7412ddfed0d2f1f4a86d8a7e26de6b0638cd092c2a2b524705',
//         tree: 14,
//         position: 6500,
//         nullifier: '091961ce11c244db49a25668e57dfa2b5ffb1fe63055dd64a14af6f2be58b0e7',
//       },
//     ];

//     const v = nullifierVectors[0];
//     expect(TransactNote.getNullifier(ByteUtils.hexToBigInt(v.privateKey), v.position)).to.be.a(
//       'bigint',
//     );
//     for (const vector of nullifierVectors) {
//       const nullifier = TransactNote.getNullifier(
//         ByteUtils.hexToBigInt(vector.privateKey),
//         vector.position,
//       );
//       const hexNullifier = ByteUtils.nToHex(nullifier, ByteLength.UINT_256);
//       expect(hexNullifier).to.equal(vector.nullifier);
//     }
//   });
// });
