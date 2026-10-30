import {
  AmbireActionCodec,
  AmbireRecoveryAction,
  type Address,
  type BlockTags,
  type DeploymentDescriptor,
  type Hex,
  type IProvider,
} from '../../src/index';
import { getAddress } from 'viem';
import { keccak256 } from '../helpers/keccak';

/** The 4-byte selector of a hand-written function signature, from the test's own keccak. */
export const selectorOf = (signature: string): Hex => keccak256(new TextEncoder().encode(signature)).slice(0, 10) as Hex;

/** The action contract's and the account's functions, written out by hand from the Solidity interfaces. */
export const SIGNATURES = {
  supportsAccount: 'supportsAccount(address)',
  isAuthority: 'isAuthority(address,address)',
  isAuthorized: 'isAuthorized(address)',
  supportsInterface: 'supportsInterface(bytes4)',
  name: 'name()',
  version: 'version()',
  holdsAnyPrivilege: 'holdsAnyPrivilege(address,address)',
  setAddrPrivilege: 'setAddrPrivilege(address,bytes32)',
  executeHandover: 'executeHandover(address,bytes)',
  privileges: 'privileges(address)',
} as const;

export const SELECTORS = Object.fromEntries(
  Object.entries(SIGNATURES).map(([key, signature]) => [key, selectorOf(signature)]),
) as Record<keyof typeof SIGNATURES, Hex>;

/** The six functions the policy-action interface declares, whose selectors XOR to its ERC-165 id. */
export const POLICY_ACTION_SIGNATURES = [
  SIGNATURES.supportsAccount,
  SIGNATURES.isAuthority,
  SIGNATURES.isAuthorized,
  SIGNATURES.supportsInterface,
  SIGNATURES.name,
  SIGNATURES.version,
] as const;

/** The XOR of the given selectors, as 0x-prefixed 4-byte hex. */
export const xorSelectors = (signatures: readonly string[]): Hex => {
  const folded = signatures.reduce((acc, signature) => (acc ^ parseInt(selectorOf(signature).slice(2), 16)) >>> 0, 0);

  return `0x${folded.toString(16).padStart(8, '0')}`;
};

/** A bound account spelled in lower case, so a checksummed target is visible. */
export const ACCOUNT: Address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
export const ACCOUNT_CHECKSUMMED: Address = getAddress(ACCOUNT);

/** The action of the blessed kit-slot row. */
export const ACTION: Address = '0x2222222222222222222222222222222222222222';
export const OTHER_ACTION: Address = '0x3333333333333333333333333333333333333333';
export const KEY: Address = '0x7777777777777777777777777777777777777777';
export const CANDIDATE: Address = '0x8888888888888888888888888888888888888888';
export const ZERO: Address = '0x0000000000000000000000000000000000000000';
export const ZERO_WORD: Hex = `0x${'0'.repeat(64)}`;

export const BLOCK_TAGS: BlockTags = { read: 'finalized', watch: 'latest' };

export const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 11_155_111,
  manager: '0x8000000000000000000000000000000000000001',
  methodEcdsa: '0x8000000000000000000000000000000000000002',
  methodPasskey: '0x8000000000000000000000000000000000000003',
  methodAadhaar: '0x8000000000000000000000000000000000000004',
  methodZkpassport: '0x8000000000000000000000000000000000000005',
  action: OTHER_ACTION,
  servedImplementation: '0x4000000000000000000000000000000000000001',
  deployedAt: 1,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [],
  auditedActions: [ACTION, OTHER_ACTION],
};

/** A left-padded 32-byte word of hex digits, without the prefix. */
export const word = (hex: string): string => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');

/** An ABI bool return word. */
export const boolWord = (value: boolean): Hex => `0x${word(value ? '1' : '0')}`;

/** An ABI `string` return: offset, length, padded bytes. */
export const stringReturn = (text: string): Hex => {
  const bytes = Buffer.from(text, 'utf8').toString('hex');
  const padded = bytes.padEnd(Math.ceil(bytes.length / 64) * 64, '0');

  return `0x${word('20')}${word((bytes.length / 2).toString(16))}${padded}`;
};

/** The part bound to the fixture account and the blessed action, over a codec serving both fixture actions. */
export const partOver = (provider: IProvider, account: Address = ACCOUNT, action: Address = ACTION): AmbireRecoveryAction =>
  new AmbireRecoveryAction(provider, DESCRIPTOR, account, action, new AmbireActionCodec([ACTION, OTHER_ACTION]), BLOCK_TAGS);
