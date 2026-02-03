import { AbiCoder } from 'ethers';
import { ProofBundle, prove, SolidityProof } from './prover';
import {
  CommitmentCiphertext,
  CommitmentPreimage,
  ShieldCiphertext,
  Note,
  TokenData,
  UnshieldNote,
  SendNote,
} from './note';
import { hash, randomBytes } from '../global/crypto';
import { hexStringToArray, arrayToBigInt, bigIntToArray, arrayToHexString } from '../global/bytes';
import { SNARK_SCALAR_FIELD } from '../global/constants';
import { MerkleTree } from './merkletree';
import { getKeys } from './artifacts';
import {
  CommitmentCiphertextStructOutput,
  CommitmentPreimageStructOutput,
  ShieldCiphertextStructOutput,
  TokenDataStructOutput,
} from '../typechain-types/contracts/logic/RailgunLogic';
import { RGCircuitGetterFn } from '~/circuits';

export enum UnshieldType {
  NONE = 0,
  NORMAL = 1,
  REDIRECT = 2,
}

export interface InputOutputBundle {
  inputs: Note[];
  outputs: (Note | UnshieldNote)[];
}

export interface BoundParams {
  treeNumber: number;
  minGasPrice: bigint;
  unshield: UnshieldType;
  chainID: bigint;
  adaptContract: string;
  adaptParams: Uint8Array;
  commitmentCiphertext: CommitmentCiphertext[];
}

export interface PublicInputs {
  proof: SolidityProof;
  merkleRoot: Uint8Array;
  nullifiers: Uint8Array[];
  commitments: Uint8Array[];
  boundParams: BoundParams;
  unshieldPreimage: {
    npk: Uint8Array;
    token: TokenData;
    value: bigint;
  };
}

export interface CircuitInputs {
  // PUBLIC INPUTS
  merkleRoot: bigint;
  boundParamsHash: bigint;
  nullifiers: bigint[];
  commitmentsOut: bigint[];

  // PRIVATE INPUTS
  token: bigint;
  publicKey: [bigint, bigint];
  signature: [bigint, bigint, bigint];
  randomIn: bigint[];
  valueIn: bigint[];
  pathElements: bigint[][];
  leavesIndices: number[];
  nullifyingKey: bigint;
  npkOut: bigint[];
  valueOut: bigint[];
}

const dummyProof: ProofBundle = {
  javascript: {
    pi_a: [0n, 0n],
    pi_b: [
      [0n, 0n],
      [0n, 0n],
    ],
    pi_c: [0n, 0n],
    protocol: 'groth16',
  },
  solidity: {
    a: { x: 0n, y: 0n },
    b: { x: [0n, 0n], y: [0n, 0n] },
    c: { x: 0n, y: 0n },
  },
};

/**
 * Hash bound parameters struct
 *
 * @param boundParams - bound parameters struct
 * @returns hash
 */
function hashBoundParams(boundParams: BoundParams): Uint8Array {
  // Encode bytes
  const encodedBytes = hexStringToArray(
    AbiCoder.defaultAbiCoder().encode(
      [
        'tuple(uint16 treeNumber, uint48 minGasPrice, uint8 unshield, uint64 chainID, address adaptContract, bytes32 adaptParams, tuple(bytes32[4] ciphertext, bytes32 blindedSenderViewingKey, bytes32 blindedReceiverViewingKey, bytes annotationData, bytes memo)[] commitmentCiphertext) boundParams',
      ],
      [boundParams],
    ),
  );

  // Keccak hash
  const prehash = arrayToBigInt(hash.keccak256(encodedBytes));

  // Mod by SNARK_SCALAR_FIELD and return
  return bigIntToArray(BigInt(prehash) % SNARK_SCALAR_FIELD, 32);
}

/**
 * Creates a chai matcher for nullifiers
 *
 * @param nullifiers - nullifiers to match
 * @returns matcher
 */
function nullifiersMatcher(nullifiers: Uint8Array[]) {
  return (contractNullifiers: string[]): boolean => {
    // If lengths don't match return false
    if (nullifiers.length !== contractNullifiers.length) return false;

    // Loop through each nullifier and check if they match
    const nullifiersMatched = contractNullifiers.map(
      (nullifier, nullifierIndex) =>
        arrayToHexString(nullifiers[nullifierIndex], true) === nullifier,
    );

    // Return false if any elements returned false
    return !nullifiersMatched.includes(false);
  };
}

/**
 * Creates a chai matcher for note hashes
 *
 * @param hashes - note hashes to match
 * @returns matcher
 */
function hashesMatcher(hashes: Uint8Array[]) {
  // Logic is same as nullifiers matcher
  return nullifiersMatcher(hashes);
}

/**
 * Creates a chai matcher for ciphertext
 *
 * @param ciphertextVector - ciphertext to match
 * @returns matcher
 */
function ciphertextMatcher(ciphertextVector: CommitmentCiphertext[]) {
  return (contractCipherText: CommitmentCiphertextStructOutput[]): boolean => {
    // If lengths don't match return false
    if (ciphertextVector.length !== contractCipherText.length) return false;

    const ciphertextMatched = contractCipherText.map((ciphertext, ciphertextIndex) => {
      // Check ciphertext words match
      const cipherMatched = ciphertext.ciphertext.map(
        (element, elementIndex) =>
          arrayToHexString(ciphertextVector[ciphertextIndex].ciphertext[elementIndex], true) ===
          element,
      );

      // Return false if any ciphertext words didn't match
      if (cipherMatched.includes(false)) return false;

      // Check blinded keys match
      if (
        arrayToHexString(ciphertextVector[ciphertextIndex].blindedReceiverViewingKey, true) !==
        ciphertext.blindedReceiverViewingKey
      )
        return false;

      if (
        arrayToHexString(ciphertextVector[ciphertextIndex].blindedSenderViewingKey, true) !==
        ciphertext.blindedSenderViewingKey
      )
        return false;

      // Check memo and annotated data match
      if (arrayToHexString(ciphertextVector[ciphertextIndex].memo, true) !== ciphertext.memo)
        return false;

      if (
        arrayToHexString(ciphertextVector[ciphertextIndex].annotationData, true) !==
        ciphertext.annotationData
      )
        return false;

      return true;
    });

    // Return false if any ciphertext returned false
    return !ciphertextMatched.includes(false);
  };
}

/**
 * Creates a chai matcher for shield ciphertext
 *
 * @param shieldCiphertext - shield ciphertext to match
 * @returns matcher
 */
function shieldCiphertextMatcher(shieldCiphertext: ShieldCiphertext[]) {
  // Return constructed matcher function
  return (contractShieldCiphertext: ShieldCiphertextStructOutput[]): boolean => {
    // If lengths don't match return false
    if (shieldCiphertext.length !== contractShieldCiphertext.length) return false;

    // Loop through each shield ciphertext and check if they match
    const shieldCiphertextMatched = contractShieldCiphertext.map(
      (ciphertext, shieldCiphertextIndex): boolean => {
        // Check ciphertext words match
        const encryptedBundleMatched = ciphertext.encryptedBundle.map(
          (element, elementIndex) =>
            arrayToHexString(
              shieldCiphertext[shieldCiphertextIndex].encryptedBundle[elementIndex],
              true,
            ) === element,
        );

        // Return false if any elements returned false
        if (encryptedBundleMatched.includes(false)) return false;

        // Return false if ephemeral key doesn't match
        return (
          ciphertext.shieldKey ===
          arrayToHexString(shieldCiphertext[shieldCiphertextIndex].shieldKey, true)
        );
      },
    );

    // Return false if any ciphertext returned false
    return !shieldCiphertextMatched.includes(false);
  };
}

/**
 * Creates a chai matcher for commitment preimages
 *
 * @param commitmentPreimages - commitment preimage to match
 * @returns matcher
 */
function commitmentPreimageMatcher(commitmentPreimages: CommitmentPreimage[]) {
  return (contractPreimages: CommitmentPreimageStructOutput[]): boolean => {
    // Loop through each preimage and check if they match
    const preimagesMatched = contractPreimages.map((preimage, index): boolean => {
      if (preimage.npk !== arrayToHexString(commitmentPreimages[index].npk, true)) return false;

      if (preimage.token.tokenType.toString() !== commitmentPreimages[index].token.tokenType.toString()) return false;

      if (preimage.token.tokenAddress !== commitmentPreimages[index].token.tokenAddress)
        return false;

      if (BigInt(preimage.token.tokenSubID) !== commitmentPreimages[index].token.tokenSubID)
        return false;

      if (BigInt(preimage.value) !== commitmentPreimages[index].value) return false;

      return true;
    });

    // Return false if any preimage matches returned false
    return !preimagesMatched.includes(false);
  };
}

/**
 * Creates a chai matcher for token data
 *
 * @param tokenData - token data to match
 * @returns matcher
 */
function tokenDataMatcher(tokenData: TokenData) {
  return (contractTokenData: TokenDataStructOutput): boolean => {
    if (contractTokenData.tokenAddress !== tokenData.tokenAddress) return false;

    if (contractTokenData.tokenType.toString() !== tokenData.tokenType.toString()) return false;

    if (BigInt(contractTokenData.tokenSubID) !== tokenData.tokenSubID) return false;

    return true;
  };
}

/**
 * Pads inputs and outputs with dummy notes
 *
 * @param originalBundle - original bundle
 * @param outputsLength - number of outputs to pad to
 * @returns inputs and outputs to use for test
 */
function padWithDummyNotes(originalBundle: InputOutputBundle, outputsLength: number) {
  const dummyNote = new Note(
    new Uint8Array(32),
    new Uint8Array(32),
    0n,
    randomBytes(16),
    originalBundle.inputs[0].tokenData,
    '',
  );

  const outputPadding = new Array(outputsLength - originalBundle.outputs.length)
    .fill(0)
    .map(() => dummyNote);

  return {
    inputs: originalBundle.inputs,
    outputs: [...outputPadding, ...originalBundle.outputs],
  };
}

/**
 * Formats inputs for submitting to chain
 *
 * @param proof - snark proof
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param minGasPrice - minimum gas price
 * @param unshield - unshield field
 * (0 for no unshield, 1 for unshield, 2 for unshield with override allowed)
 * @param chainID - chain ID to lock proof to
 * @param adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @param notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @param commitmentCiphertext - commitment ciphertext
 * @returns inputs
 */
async function formatPublicInputs(
  proof: ProofBundle,
  merkletree: MerkleTree,
  minGasPrice: bigint,
  unshield: UnshieldType,
  chainID: bigint,
  adaptContract: string,
  adaptParams: Uint8Array,
  notesIn: Note[],
  notesOut: (Note | UnshieldNote | SendNote)[],
  commitmentCiphertext: CommitmentCiphertext[],
): Promise<PublicInputs> {
  // Get Merkle Root
  const merkleRoot = merkletree.root;

  // Get tree number
  const treeNumber = merkletree.treeNumber;

  // Loop through each note in and get nullifier
  const nullifiers = await Promise.all(
    notesIn.map(async (note) => {
      // Get merkle proof
      const merkleProof = merkletree.generateProof(await note.getHash());

      // Generate nullifier from merkle proof indices
      return note.getNullifier(merkleProof.indices);
    }),
  );

  // Loop through notes out and calculate hash
  const commitments = await Promise.all(notesOut.map((note) => note.getHash()));

  return {
    proof: proof.solidity,
    merkleRoot,
    nullifiers,
    commitments,
    boundParams: {
      treeNumber,
      minGasPrice,
      unshield,
      chainID,
      adaptContract,
      adaptParams,
      commitmentCiphertext,
    },
    unshieldPreimage: {
      npk: await notesOut[notesOut.length - 1].getNotePublicKey(),
      token: notesOut[notesOut.length - 1].tokenData,
      value: notesOut[notesOut.length - 1].value,
    },
  };
}

/**
 * Formats inputs for prover
 *
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param minGasPrice - minimum gas price
 * @param unshield - unshield field
 * @param chainID - chain ID to lock proof to
 * @param adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @param notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @param commitmentCiphertext - commitment ciphertext
 * @returns inputs
 */
async function formatCircuitInputs(
  merkletree: MerkleTree,
  minGasPrice: bigint,
  unshield: UnshieldType,
  chainID: bigint,
  adaptContract: string,
  adaptParams: Uint8Array,
  notesIn: Note[],
  notesOut: (Note | UnshieldNote | SendNote)[],
  commitmentCiphertext: CommitmentCiphertext[],
): Promise<CircuitInputs> {
  // PUBLIC INPUTS
  // Get Merkle Root
  const merkleRoot = merkletree.root;

  // Get tree number
  const treeNumber = merkletree.treeNumber;

  // Get bound parameters hash
  const boundParamsHash = hashBoundParams({
    treeNumber,
    minGasPrice,
    unshield,
    chainID,
    adaptContract,
    adaptParams,
    commitmentCiphertext,
  });

  // Loop through each note in and get nullifier
  const nullifiers = await Promise.all(
    notesIn.map(async (note) => {
      // Get merkle proof
      const merkleProof = merkletree.generateProof(await note.getHash());

      // Generate nullifier from merkle proof indices
      return note.getNullifier(merkleProof.indices);
    }),
  );

  // Loop through notes out and calculate hash
  const commitmentsOut = await Promise.all(notesOut.map((note) => note.getHash()));

  // PRIVATE INPUTS
  const token = notesIn[0].getTokenID();
  const publicKey = await notesIn[0].getSpendingPublicKey();
  const signature = await notesIn[0].sign(merkleRoot, boundParamsHash, nullifiers, commitmentsOut);
  const randomIn = notesIn.map((note) => note.random);
  const valueIn = notesIn.map((note) => note.value);
  const pathElements = await Promise.all(
    notesIn.map(async (note) => {
      const merkleProof = merkletree.generateProof(await note.getHash());

      return merkleProof.elements;
    }),
  );
  const leavesIndices = await Promise.all(
    notesIn.map(async (note) => {
      const merkleProof = merkletree.generateProof(await note.getHash());

      return merkleProof.indices;
    }),
  );
  const nullifyingKey = await notesIn[0].getNullifyingKey();
  const npkOut = await Promise.all(notesOut.map((note) => note.getNotePublicKey()));
  const valueOut = notesOut.map((note) => note.value);

  return {
    // PUBLIC INPUTS
    merkleRoot: arrayToBigInt(merkleRoot),
    boundParamsHash: arrayToBigInt(boundParamsHash),
    nullifiers: nullifiers.map(arrayToBigInt),
    commitmentsOut: commitmentsOut.map(arrayToBigInt),

    // PRIVATE INPUTS
    token: arrayToBigInt(token),
    publicKey: publicKey.map(arrayToBigInt) as [bigint, bigint],
    signature: signature.map(arrayToBigInt) as [bigint, bigint, bigint],
    randomIn: randomIn.map(arrayToBigInt),
    valueIn,
    pathElements: pathElements.map((el) => el.map(arrayToBigInt)),
    leavesIndices,
    nullifyingKey: arrayToBigInt(nullifyingKey),
    npkOut: npkOut.map(arrayToBigInt),
    valueOut,
  };
}

/**
 * Generates transaction with dummy proof
 *
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param minGasPrice - minimum gas price
 * @param unshield - unshield field
 * (0 for no unshield, 1 for unshield, 2 for unshield with override allowed)
 * @param chainID - chain ID to lock proof to
 * @param adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @param notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @returns transaction
 */
async function dummyTransact(
  merkletree: MerkleTree,
  minGasPrice: bigint,
  unshield: UnshieldType,
  chainID: bigint,
  adaptContract: string,
  adaptParams: Uint8Array,
  notesIn: Note[],
  notesOut: (Note | UnshieldNote)[],
): Promise<PublicInputs> {
  // Get required ciphertext length
  const ciphertextLength = unshield === 0 ? notesOut.length : notesOut.length - 1;

  // Get sender viewing private key
  const senderViewingPrivateKey = notesIn[0].viewingKey;

  // Create ciphertext
  const commitmentCiphertext = await Promise.all(
    notesOut.slice(0, ciphertextLength).map((note) => note.encrypt(senderViewingPrivateKey, false)),
  );

  // Return formatted public inputs
  return formatPublicInputs(
    dummyProof,
    merkletree,
    minGasPrice,
    unshield,
    chainID,
    adaptContract,
    adaptParams,
    notesIn,
    notesOut,
    commitmentCiphertext,
  );
}

/**
 * Generates and proves transaction
 *
 * @param merkletree - merkle tree to get inclusion proofs from
 * @param minGasPrice - minimum gas price
 * @param unshield - unshield field
 * (0 for no unshield, 1 for unshield, 2 for unshield with override allowed)
 * @param chainID - chain ID to lock proof to
 * @param  adaptContract - adapt contract to lock transaction to (0 if no lock)
 * @param adaptParams - parameter field for use by adapt module
 * @param  notesIn - transaction inputs
 * @param notesOut - transaction outputs
 * @returns transaction
 */
async function transact(
  merkletree: MerkleTree,
  minGasPrice: bigint,
  unshield: UnshieldType,
  chainID: bigint,
  adaptContract: string,
  adaptParams: Uint8Array,
  notesIn: Note[],
  notesOut: (Note | UnshieldNote | SendNote)[],
  get: RGCircuitGetterFn,
): Promise<PublicInputs> {
  // Get artifact
  const artifact = await getKeys(notesIn.length, notesOut.length, get);

  // Get required ciphertext length
  const ciphertextLength = unshield === 0 ? notesOut.length : notesOut.length - 1;

  // Get sender viewing private key
  const senderViewingPrivateKey = notesIn[0].viewingKey;

  // Create ciphertext
  const commitmentCiphertext = await Promise.all(
    notesOut.slice(0, ciphertextLength).map((note) => note.encrypt(senderViewingPrivateKey, false)),
  );

  // Get circuit inputs
  const inputs = await formatCircuitInputs(
    merkletree,
    minGasPrice,
    unshield,
    chainID,
    adaptContract,
    adaptParams,
    notesIn,
    notesOut,
    commitmentCiphertext,
  );

  console.log("circuit inputs", inputs);

  console.log("attempting proof");

  // Generate proof
  const proof = await prove(artifact, inputs);

  console.log("proof completed");


  // Return public inputs
  return formatPublicInputs(
    proof,
    merkletree,
    minGasPrice,
    unshield,
    chainID,
    adaptContract,
    adaptParams,
    notesIn,
    notesOut,
    commitmentCiphertext,
  );
}

/**
 * Get base and fee amount
 *
 * @param amount - Amount to calculate for
 * @param isInclusive - Whether the amount passed in is inclusive of the fee
 * @param feeBP - Fee basis points
 * @returns base, fee
 */
function getFee(
  amount: bigint,
  isInclusive: boolean,
  feeBP: bigint,
): { base: bigint; fee: bigint } {
  // Define number of basis points in 100%
  const BASIS_POINTS = 10000n;
  let base;
  let fee;

  if (isInclusive) {
    // Amount is base + fee, calculate base and fee
    base = amount - (amount * feeBP) / BASIS_POINTS;
    fee = amount - base;
  } else {
    // Amount is base, calculate fee
    base = amount;
    fee = (BASIS_POINTS * base) / (BASIS_POINTS - feeBP) - base;
  }

  return { base, fee };
}

export {
  hashBoundParams,
  nullifiersMatcher,
  hashesMatcher,
  ciphertextMatcher,
  shieldCiphertextMatcher,
  commitmentPreimageMatcher,
  tokenDataMatcher,
  padWithDummyNotes,
  formatPublicInputs,
  formatCircuitInputs,
  dummyTransact,
  transact,
  getFee,
};
