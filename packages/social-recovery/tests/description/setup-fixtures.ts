import { getAddress } from 'viem';
import type {
  Address,
  ClientConfiguration,
  Credential,
  DeploymentDescriptor,
  Hex,
  MethodDescriptionReads,
  Parties,
  SetupDescriptionContext,
  SetupDraft,
} from '../../src/index';
import { readVector } from '../kat/read-vector';

export const ECDSA: Address = '0x3000000000000000000000000000000000000001';
export const PASSKEY: Address = '0x3000000000000000000000000000000000000002';
export const AADHAAR: Address = '0x3000000000000000000000000000000000000003';
export const ZKPASSPORT: Address = '0x3000000000000000000000000000000000000004';
export const THIRD_PARTY: Address = '0x3000000000000000000000000000000000000009';
export const ACTION: Address = '0x2000000000000000000000000000000000000001';
export const OTHER_ACTION: Address = '0x2000000000000000000000000000000000000002';
export const ADMIN: Address = '0x6000000000000000000000000000000000000001';
export const PENDING_ADMIN: Address = '0x6000000000000000000000000000000000000002';
export const PAUSE_HOLDER: Address = '0x6000000000000000000000000000000000000003';
export const PENDING_PAUSE_HOLDER: Address = '0x6000000000000000000000000000000000000004';
export const OTHER_PAUSE_HOLDER: Address = '0x6000000000000000000000000000000000000005';
export const AUDITED_ONLY_ACTION: Address = '0x2000000000000000000000000000000000000003';
export const CANDIDATE_A: Address = '0x7000000000000000000000000000000000000001';
export const CANDIDATE_B: Address = '0x7000000000000000000000000000000000000002';
export const SUPPLIED_SALT: Hex = '0x5a17ed5a17ed5a17ed5a17ed5a17ed5a17ed5a17ed5a17ed5a17ed5a17ed5a17';
export const TRUSTED_KEY: Hex = '0x7e57ed7e57ed7e57ed7e57ed7e57ed7e57ed7e57ed7e57ed7e57ed7e57ed7e57';

type VectorPair = { readonly encoded: Hex; readonly value: string };

const vectorEncoded = (file: string, field: string): VectorPair => {
  const row = readVector(file).vectors[0];
  const value = row?.input[field];
  const encoded = (row?.expected as { encoded?: Hex } | undefined)?.encoded;

  if (typeof value !== 'string' || encoded === undefined) throw new Error(`${file} lacks ${field}`);

  return { encoded, value };
};

/** The blessed wallet guardian: its config bytes and the signer address they encode. */
export const GUARDIAN = vectorEncoded('method-ecdsa-config.json', 'signer');

/** The blessed passkey config and the relying-party id hash it ends in. */
export const PASSKEY_CONFIG = vectorEncoded('method-passkey-config.json', 'rpIdHash');

/** A second guardian, its config the left-padded address. */
export const SECOND_GUARDIAN: Address = getAddress('0xabcdef0123456789abcdef0123456789abcdef01');
export const SECOND_GUARDIAN_CONFIG: Hex = `0x${'0'.repeat(24)}${SECOND_GUARDIAN.slice(2).toLowerCase()}`;

const word = (n: number): Hex => `0x${n.toString(16).padStart(64, '0')}`;

/** Two clauses over four methods: guardians and a passkey in the first, an identity proof and a third-party module in the second. */
export const CLAUSES: readonly { readonly threshold: number; readonly credentials: readonly Credential[] }[] = [
  {
    threshold: 2,
    credentials: [
      { method: ECDSA, config: GUARDIAN.encoded, label: 'Alice' },
      { method: PASSKEY, config: PASSKEY_CONFIG.encoded, salt: SUPPLIED_SALT },
      { method: ECDSA, config: SECOND_GUARDIAN_CONFIG },
    ],
  },
  {
    threshold: 1,
    credentials: [
      { method: ZKPASSPORT, config: word(4), label: 'Passport' },
      { method: THIRD_PARTY, config: word(9), salt: SUPPLIED_SALT },
    ],
  },
];

export const DRAFT: SetupDraft = {
  wait: 259_200,
  clauses: CLAUSES,
  ignoresPause: false,
  privacy: { publicMetadata: '0x1234', backup: 'encrypted' },
};

export const PARTIES: Parties = {
  admin: ADMIN,
  pendingAdmin: PENDING_ADMIN,
  trustedKeys: [TRUSTED_KEY],
  pauseHolder: PAUSE_HOLDER,
  pendingPauseHolder: PENDING_PAUSE_HOLDER,
};

/** The identity method's own declaration, its stop held by another address. */
export const ZKPASSPORT_PARTIES: Parties = { ...PARTIES, pauseHolder: OTHER_PAUSE_HOLDER };

/** One method's reads, every one answered unless overridden. */
export const reads = (module: Address, name: string, extra: Partial<MethodDescriptionReads> = {}): MethodDescriptionReads => ({
  module,
  moduleInfo: { answered: true, value: { name, version: '1.0.0', supportsInterface: true } },
  trustedParties: { answered: true, value: PARTIES },
  paused: { answered: true, value: false },
  implemented: true,
  tier: 'primary',
  ...extra,
});

export const DESCRIPTOR: DeploymentDescriptor = {
  chainId: 11_155_111,
  manager: '0x8000000000000000000000000000000000000001',
  methodEcdsa: ECDSA,
  methodPasskey: PASSKEY,
  methodAadhaar: AADHAAR,
  methodZkpassport: ZKPASSPORT,
  action: ACTION,
  servedImplementation: '0x4000000000000000000000000000000000000001',
  deployedAt: 1,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [ECDSA, PASSKEY, AADHAAR, ZKPASSPORT],
  auditedActions: [ACTION, AUDITED_ONLY_ACTION],
};

export const CONFIGURATION: ClientConfiguration = {
  defaultWait: 172_800,
  shortWait: 172_800,
  maxWait: 2_592_000,
  requestWindow: { default: 86_400, floor: 3_600 },
  cancelWindow: 43_200,
  ruleCostBound: 10_000_000,
  candidateKeys: [CANDIDATE_A, CANDIDATE_B],
  blockTags: { read: 'latest', watch: 'finalized' },
  logChunkSize: 10_000,
  tokens: [],
  simulate: true,
};

export const METHOD_READS: readonly MethodDescriptionReads[] = [
  reads(ECDSA, 'method-ecdsa'),
  reads(PASSKEY, 'method-passkey', { trustedParties: { answered: true, value: { ...PARTIES, trustedKeys: [] } } }),
  reads(ZKPASSPORT, 'method-zkpassport', {
    tier: 'secondary',
    paused: { answered: true, value: true },
    trustedParties: { answered: true, value: ZKPASSPORT_PARTIES },
  }),
  reads(THIRD_PARTY, 'their-method', { implemented: false, tier: undefined }),
];

/** Every read answered, the shipped action bound, two candidate keys of which one is an authority. */
export const CONTEXT: SetupDescriptionContext = {
  descriptor: DESCRIPTOR,
  configuration: CONFIGURATION,
  methods: METHOD_READS,
  action: { address: ACTION, actionInfo: { answered: true, value: { name: 'ambire', version: '1', supportsInterface: true } }, supportsAccount: true },
  candidateKeys: [
    { key: CANDIDATE_A, isAuthority: true },
    { key: CANDIDATE_B, isAuthority: false },
  ],
  removedKey: CANDIDATE_A,
};

/** The context with one method's reads replaced. */
export const withMethod = (module: Address, change: Partial<MethodDescriptionReads>): SetupDescriptionContext => ({
  ...CONTEXT,
  methods: CONTEXT.methods.map((entry) => (entry.module === module ? { ...entry, ...change } : entry)),
});

/** Sorts entries carrying a `method` address, so per-method lists compare as sets. */
export const byMethod = <Entry extends { readonly method: Address }>(entries: readonly Entry[]): Entry[] =>
  [...entries].sort((a, b) => a.method.localeCompare(b.method));

/** JSON with bigints as decimal strings, for searching a whole description. */
export const serialize = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) => (typeof inner === 'bigint' ? inner.toString() : inner));
