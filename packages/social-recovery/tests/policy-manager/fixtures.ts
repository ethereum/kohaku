import { encodeAbiParameters, type AbiParameter } from 'viem';
import {
  PolicyManager,
  type Address,
  type AttemptRequest,
  type BlockTags,
  type CancelRequest,
  type DeploymentDescriptor,
  type Hex,
  type IProvider,
  type ProofPlace,
} from '../../src/index';
import { selectorOf } from '../helpers/keccak';
import { readVector, type VectorRow } from '../kat/read-vector';

/** EIP-55 addresses from the standard's own examples, so their checksummed spelling is known without the code under test. */
export const MANAGER: Address = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
export const ACCOUNT: Address = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359';
export const ACTION: Address = '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB';
export const METHOD: Address = '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb';
export const OTHER: Address = '0x52908400098527886E0F7030069857D2E4169EE7';

/** The same addresses with one letter's case flipped, which breaks the checksum. */
export const ACTION_BAD_CHECKSUM = '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6Fb' as Address;
export const METHOD_BAD_CHECKSUM = '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9adb' as Address;

/** An address spelled all lower case and all upper case, both accepted without a checksum. */
export const lowerOf = (address: Address): Address => address.toLowerCase() as Address;
export const upperOf = (address: Address): Address => `0x${address.slice(2).toUpperCase()}`;

/** The read tag every test binds unless it names another. */
export const BLOCK_TAGS: BlockTags = { read: 'latest', watch: 'finalized' };

/** A deployment record whose manager is the tests' manager; the other members are placeholders the part never reads. */
export const descriptorFor = (manager: Address): DeploymentDescriptor => ({
  chainId: 1,
  manager,
  methodEcdsa: METHOD,
  methodPasskey: METHOD,
  methodAadhaar: METHOD,
  methodZkpassport: METHOD,
  action: ACTION,
  servedImplementation: OTHER,
  deployedAt: 1,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [METHOD],
  auditedActions: [ACTION],
});

/** The part bound to the tests' manager and the given pair. */
export const partFor = (provider: IProvider, account: Address = ACCOUNT, action: Address = ACTION, blockTags = BLOCK_TAGS): PolicyManager =>
  new PolicyManager(provider, descriptorFor(lowerOf(MANAGER)), account, action, blockTags);

/** Calldata for a hand-written signature: the independent hash's selector, then viem's encoding of the arguments. */
export const callData = (signature: string, params: readonly AbiParameter[], values: readonly unknown[]): Hex =>
  `${selectorOf(signature)}${encodeAbiParameters(params, values).slice(2)}` as Hex;

/** One 32-byte word holding a small integer. */
export const wordOf = (value: number | bigint): Hex => `0x${BigInt(value).toString(16).padStart(64, '0')}`;

/** The ABI encoding of `true`, the only return that reads as stopped. */
export const TRUE_WORD: Hex = wordOf(1);

/** The pinned interface id of `IPolicyMethod`, recomputed in the interface-id test. */
export const POLICY_METHOD_ID_LITERAL: Hex = '0xf057a368';

const PROOF_PLACE = '(uint256,address,bytes,bytes32,bytes)';

/** The manager's signatures, written by hand from its Solidity interface. */
export const SIGNATURES = {
  commitSetup: 'commitSetup(address,bytes32,uint64,bytes,bytes)',
  clearSetup: 'clearSetup(address,uint64)',
  cancelByOwner: 'cancelByOwner(address,uint64)',
  cancelByVeto: 'cancelByVeto(address,address,uint64,address)',
  startAttempt: `startAttempt((address,address,uint64,uint64,bytes,bytes,(address,uint256,address),uint48,${PROOF_PLACE}[]))`,
  cancelByProofs: `cancelByProofs((address,address,uint64,uint64,bytes,uint48,${PROOF_PLACE}[]))`,
  stateOf: 'stateOf(address,address)',
  hashApproval: `hashApproval((address,address,uint64,uint64,bytes,bytes,(address,uint256,address),uint48,${PROOF_PLACE}[]),uint256)`,
  hashCancel: `hashCancel((address,address,uint64,uint64,bytes,uint48,${PROOF_PLACE}[]),uint256)`,
  eip712Domain: 'eip712Domain()',
  name: 'name()',
  version: 'version()',
  supportsInterface: 'supportsInterface(bytes4)',
  paused: 'paused()',
  trustedParties: 'trustedParties()',
  verify: 'verify(bytes,bytes32,bytes)',
} as const;

/** The selector of a named signature, by the independent hash. */
export const sel = (name: keyof typeof SIGNATURES): string => selectorOf(SIGNATURES[name]);

const PROOF_PLACE_COMPONENTS = [
  { name: 'place', type: 'uint256' },
  { name: 'method', type: 'address' },
  { name: 'config', type: 'bytes' },
  { name: 'salt', type: 'bytes32' },
  { name: 'proof', type: 'bytes' },
] as const;

const ORDER_COMPONENTS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'payee', type: 'address' },
] as const;

/** `AttemptRequest` as the contract declares it. */
export const ATTEMPT_REQUEST_PARAM = {
  type: 'tuple',
  components: [
    { name: 'account', type: 'address' },
    { name: 'action', type: 'address' },
    { name: 'attemptId', type: 'uint64' },
    { name: 'setupNonce', type: 'uint64' },
    { name: 'setupBody', type: 'bytes' },
    { name: 'payload', type: 'bytes' },
    { name: 'order', type: 'tuple', components: ORDER_COMPONENTS },
    { name: 'validUntil', type: 'uint48' },
    { name: 'proofs', type: 'tuple[]', components: PROOF_PLACE_COMPONENTS },
  ],
} as const;

/** `CancelRequest` as the contract declares it. */
export const CANCEL_REQUEST_PARAM = {
  type: 'tuple',
  components: [
    { name: 'account', type: 'address' },
    { name: 'action', type: 'address' },
    { name: 'attemptId', type: 'uint64' },
    { name: 'setupNonce', type: 'uint64' },
    { name: 'setupBody', type: 'bytes' },
    { name: 'validUntil', type: 'uint48' },
    { name: 'proofs', type: 'tuple[]', components: PROOF_PLACE_COMPONENTS },
  ],
} as const;

/** `ActionState` in the order the pinned contract declares it, `ignoresPause` fifth inside `Attempt`. */
export const ACTION_STATE_PARAMS = [
  {
    type: 'tuple',
    components: [
      { name: 'setupCommitment', type: 'bytes32' },
      { name: 'setupNonce', type: 'uint64' },
      { name: 'nextAttemptId', type: 'uint64' },
      { name: 'setupCommittedAtBlock', type: 'uint48' },
      {
        name: 'attempt',
        type: 'tuple',
        components: [
          { name: 'attemptId', type: 'uint64' },
          { name: 'setupNonce', type: 'uint64' },
          { name: 'consumableAfter', type: 'uint48' },
          { name: 'state', type: 'uint8' },
          { name: 'ignoresPause', type: 'bool' },
          { name: 'payloadHash', type: 'bytes32' },
          { name: 'order', type: 'tuple', components: ORDER_COMPONENTS },
          { name: 'usedMethods', type: 'address[]' },
        ],
      },
    ],
  },
] as const;

/** `eip712Domain()`'s seven returns, per ERC-5267. */
export const DOMAIN_PARAMS = [
  { type: 'bytes1' },
  { type: 'string' },
  { type: 'string' },
  { type: 'uint256' },
  { type: 'address' },
  { type: 'bytes32' },
  { type: 'uint256[]' },
] as const;

/** `trustedParties()`'s five returns, in their declared order. */
export const PARTIES_PARAMS = [
  { type: 'address' },
  { type: 'address' },
  { type: 'bytes32[]' },
  { type: 'address' },
  { type: 'address' },
] as const;

/** A single `string` return. */
export const STRING_PARAMS = [{ type: 'string' }] as const;

/** A single `bool` return. */
export const BOOL_PARAMS = [{ type: 'bool' }] as const;

/** A single `bytes32` return. */
export const BYTES32_PARAMS = [{ type: 'bytes32' }] as const;

/** One blessed vector row by its key. */
export function vectorRow(file: string, key: string): VectorRow {
  const row = readVector(file).vectors.find((entry) => entry['id'] === key || entry.name === key);

  if (row === undefined) throw new Error(`${file} has no row ${key}`);

  return row;
}

type RawProof = { place: string; method: Address; config: Hex; salt: Hex; proof: Hex };

const proofOf = (raw: RawProof): ProofPlace => ({ ...raw, place: Number(raw.place) });

/** The blessed attempt request row as a request record. */
export function attemptRequestOf(row: VectorRow): AttemptRequest {
  const input = row.input as Record<string, unknown> & { order: { token: Address; amount: string; payee: Address }; proofs: RawProof[] };

  return {
    account: input['account'] as Address,
    action: input['action'] as Address,
    attemptId: BigInt(input['attemptId'] as string),
    setupNonce: BigInt(input['setupNonce'] as string),
    setupBody: input['setupBody'] as Hex,
    payload: input['payload'] as Hex,
    order: { token: input.order.token, amount: BigInt(input.order.amount), payee: input.order.payee },
    validUntil: Number(input['validUntil']),
    proofs: input.proofs.map(proofOf),
  };
}

/** The blessed cancel request row as a request record. */
export function cancelRequestOf(row: VectorRow): CancelRequest {
  const input = row.input as Record<string, unknown> & { proofs: RawProof[] };

  return {
    account: input['account'] as Address,
    action: input['action'] as Address,
    attemptId: BigInt(input['attemptId'] as string),
    setupNonce: BigInt(input['setupNonce'] as string),
    setupBody: input['setupBody'] as Hex,
    validUntil: Number(input['validUntil']),
    proofs: input.proofs.map(proofOf),
  };
}

/** The request as the encoder takes it, places as bigint. */
export const tupleOf = <Request extends { readonly proofs: readonly ProofPlace[] }>(request: Request) => ({
  ...request,
  proofs: request.proofs.map((proof) => ({ ...proof, place: BigInt(proof.place) })),
});
