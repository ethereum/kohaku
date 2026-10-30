import { concat, encodeAbiParameters, getAddress, getContractAddress, keccak256 as viemKeccak, toFunctionSelector } from 'viem';
import type { Address, AttemptRequest, CancelRequest, Hex, PaymentOrder, ProofPlace } from '../../src/index';
import { addressWord, join, keccakLocal, word } from './support';

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

const ATTEMPT_TUPLE = {
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

const CANCEL_TUPLE = {
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

const PROOF_PLACE_SIGNATURE = '(uint256,address,bytes,bytes32,bytes)[]';

/** The startAttempt selector, recomputed from the struct's canonical signature. */
export const START_ATTEMPT_SELECTOR = toFunctionSelector(
  `startAttempt((address,address,uint64,uint64,bytes,bytes,(address,uint256,address),uint48,${PROOF_PLACE_SIGNATURE}))`,
);

/** The cancelByProofs selector, recomputed from the struct's canonical signature. */
export const CANCEL_BY_PROOFS_SELECTOR = toFunctionSelector(
  `cancelByProofs((address,address,uint64,uint64,bytes,uint48,${PROOF_PLACE_SIGNATURE}))`,
);

const sortedProofs = (proofs: readonly ProofPlace[]): ProofPlace[] => [...proofs].sort((a, b) => a.place - b.place);

const proofTuple = (p: ProofPlace) => ({ ...p, place: BigInt(p.place) });

/** Attempt calldata by viem's encoder with the proofs in the order given, sorted or not. */
export const rawAttempt = (r: AttemptRequest): Hex =>
  concat([START_ATTEMPT_SELECTOR, encodeAbiParameters([ATTEMPT_TUPLE], [{ ...r, proofs: r.proofs.map(proofTuple) }])]);

/** Cancel calldata by viem's encoder with the proofs in the order given, sorted or not. */
export const rawCancel = (r: CancelRequest): Hex =>
  concat([CANCEL_BY_PROOFS_SELECTOR, encodeAbiParameters([CANCEL_TUPLE], [{ ...r, proofs: r.proofs.map(proofTuple) }])]);

/** The reference attempt calldata, proofs sorted by place. */
export const oracleAttempt = (r: AttemptRequest): Hex => rawAttempt({ ...r, proofs: sortedProofs(r.proofs) });

/** The reference cancel calldata, proofs sorted by place. */
export const oracleCancel = (r: CancelRequest): Hex => rawCancel({ ...r, proofs: sortedProofs(r.proofs) });

/** The reference proof place encoding, one tuple with its leading offset word. */
export const oracleProofPlace = (p: ProofPlace): Hex =>
  encodeAbiParameters([{ type: 'tuple', components: PROOF_PLACE_COMPONENTS }], [proofTuple(p)]);

/** The reference payment order encoding, three static words. */
export const oracleOrder = (o: PaymentOrder): Hex =>
  join(addressWord(o.token), word(o.amount), addressWord(o.payee));

/** The default salt by viem's encoder. */
export const oracleSaltViem = (account: Address, place: number | bigint): Hex =>
  viemKeccak(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [account, BigInt(place)]));

/** The default salt from the two hand-built words and the package's test keccak. */
export const oracleSaltHand = (account: Address, place: number | bigint): Hex =>
  keccakLocal(join(addressWord(account), word(place)));

const KIT_WORD = `${Buffer.from('kit').toString('hex')}`.padEnd(64, '0');

/** The kit slot preimage, abi.encode of the string "kit" and the action, built word by word. */
export const kitSlotPreimage = (action: Address): Hex => join(word(0x40), addressWord(action), word(3), KIT_WORD);

/** The kit binding preimage, abi.encode of the action and empty bytes, built word by word. */
export const kitBindingPreimage = (action: Address): Hex => join(addressWord(action), word(0x40), word(0));

/** The kit slot: the low twenty bytes of the preimage hash, checksummed. */
export const oracleKitSlot = (action: Address): Address => getAddress(`0x${keccakLocal(kitSlotPreimage(action)).slice(-40)}`);

/** One privilege the hand-built creation code writes, with the raw push bytes of its value. */
export type HandEntry = { readonly addr: Address; readonly valueBytes: string };

/** The privilege mapping's storage slot for an address. */
export const privilegeSlot = (addr: Address): Hex => keccakLocal(join(addressWord(addr), word(0)));

const push = (bytesHex: string): string => (0x5f + bytesHex.length / 2).toString(16) + bytesHex;

/** The implementation address with its leading zero bytes dropped, as the pinned proxy builder pushes it. */
export const trimmedImpl = (impl: Address): string => impl.slice(2).toLowerCase().replace(/^(00)+/, '');

const assemble = (implHex: string, entries: readonly HandEntry[]): Hex => {
  const stores = entries.map((e) => `${push(e.valueBytes)}7f${privilegeSlot(e.addr).slice(2)}55`).join('');
  const offset = (stores.length / 2 + 10).toString(16).padStart(2, '0');

  return `0x${stores}3d602d8060${offset}3d3981f3363d3d373d3d3d363d${push(implHex)}5af43d82803e903d91602b57fd5bf3`;
};

/** Creation code assembled by hand from the proxy layout, the implementation pushed as a full PUSH20. */
export const buildCreationCode = (impl: Address, entries: readonly HandEntry[]): Hex => assemble(impl.slice(2).toLowerCase(), entries);

/** A port of the pinned proxy builder, which drops the implementation's leading zero bytes and so pushes it short. */
export const builderCreationCode = (impl: Address, entries: readonly HandEntry[]): Hex => assemble(trimmedImpl(impl), entries);

/** The CREATE2 address by hand: the low twenty bytes of keccak256(0xff ++ factory ++ salt ++ keccak256(code)). */
export const create2ByHand = (factory: Address, salt: Hex, code: Hex): Address =>
  getAddress(`0x${keccakLocal(join('ff', factory.slice(2), salt.slice(2), keccakLocal(code).slice(2))).slice(-40)}`);

/** The CREATE2 address by viem. */
export const create2Viem = (factory: Address, salt: Hex, code: Hex): Address =>
  getContractAddress({ opcode: 'CREATE2', from: factory, salt, bytecode: code });

/**
 * The expected creation privileges record; its shape is provisional, so a shape change is an edit here only.
 */
export const expectedPrivileges = (account: Address, entries: readonly HandEntry[]) => ({
  account: getAddress(account),
  entries: entries.map((e) => ({ slot: privilegeSlot(e.addr), value: `0x${e.valueBytes.padStart(64, '0')}` })),
});

/** The provisional record's shape as parsed from a fixture row's expected member. */
export const fixturePrivileges = (expected: Record<string, unknown>) => ({
  account: expected['account'] as Address,
  entries: expected['entries'] as readonly { slot: Hex; value: Hex }[],
});

/** The Ambire factory the reference revision deploys through. */
export const AMBIRE_FACTORY: Address = '0x26cE6745A633030A6faC5e64e41D21fb6246dc2d';

/** The ERC-4337 AmbireAccount implementation of the reference revision. */
export const AMBIRE_IMPL: Address = '0x0F2AA7bcda3d9D210dF69a394b6965CB2566c828';

/** An implementation address with four leading zero bytes, so the proxy pushes sixteen. */
export const LEADING_ZERO_IMPL: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

/** The signer key value a fresh account's single privilege carries, as the full word the builder pushes. */
export const SIGNER_VALUE_WORD = word(2);
