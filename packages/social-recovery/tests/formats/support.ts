import { encodeAbiParameters, keccak256 as viemKeccak } from 'viem';
import { keccak256 as localKeccak } from '../helpers/keccak';

export type Hex = `0x${string}`;

/** Keccak-256 by the package's own test implementation, independent of viem. */
export const keccakLocal = (hex: string): Hex => localKeccak(Buffer.from(hex.slice(2), 'hex')) as Hex;

export const keccakText = (text: string): Hex => localKeccak(new TextEncoder().encode(text)) as Hex;

/** One 32-byte word, left-padded, from a bigint. */
export const word = (value: bigint | number): string => BigInt(value).toString(16).padStart(64, '0');

/** One 32-byte word holding an address, left-padded. */
export const addressWord = (address: string): string => address.slice(2).toLowerCase().padStart(64, '0');

/** Raw bytes as a length word followed by the bytes right-padded to whole words. */
export const bytesTail = (hex: string): string => {
  const raw = hex.slice(2);
  const words = Math.ceil(raw.length / 64);

  return word(raw.length / 2) + raw.padEnd(words * 64, '0');
};

export const join = (...parts: string[]): Hex => `0x${parts.join('')}`;

export const repeat = (byte: string, count: number): Hex => `0x${byte.repeat(count)}`;

export const A_METHOD = '0x3333333333333333333333333333333333333333';
export const A_ACCOUNT = '0x1111111111111111111111111111111111111111';
export const AN_ACTION = '0x2222222222222222222222222222222222222222';
export const A_TOKEN = '0x4444444444444444444444444444444444444444';
export const A_PAYEE = '0x5555555555555555555555555555555555555555';
export const A_MANAGER = '0x6666666666666666666666666666666666666666';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const UINT48_MAX = 2 ** 48 - 1;
export const UINT64_MAX = (1n << 64n) - 1n;
export const UINT256_MAX = (1n << 256n) - 1n;

export type OracleClause = { threshold: number; credentials: readonly Hex[] };
export type OracleBody = { wait: number; ignoresPause: boolean; clauses: readonly OracleClause[] };

const CLAUSES_PARAMETER = {
  type: 'tuple[]',
  components: [
    { name: 'threshold', type: 'uint8' },
    { name: 'credentials', type: 'bytes32[]' },
  ],
} as const;

/** The reference setup body encoding, by viem's ABI encoder. */
export const oracleBody = (body: OracleBody): Hex =>
  encodeAbiParameters(
    [{ type: 'uint48' }, { type: 'bool' }, CLAUSES_PARAMETER],
    [body.wait, body.ignoresPause, body.clauses.map((clause) => ({ ...clause, credentials: [...clause.credentials] }))],
  );

export const oracleCredential = (method: Hex, config: Hex, salt: Hex): Hex =>
  viemKeccak(encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }, { type: 'bytes32' }], [method, config, salt]));

export const oracleCommitment = (account: Hex, action: Hex, nonce: bigint, body: Hex): Hex =>
  viemKeccak(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint64' }, { type: 'bytes' }],
      [account, action, nonce, body],
    ),
  );

export const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
export const PAYMENT_ORDER_TYPE = 'PaymentOrder(address token,uint256 amount,address payee)';
export const APPROVAL_TYPE =
  'Approval(address account,address action,uint64 attemptId,uint64 setupNonce,bytes32 setupBodyHash,bytes payload,PaymentOrder order,uint48 validUntil,uint256 place)' +
  PAYMENT_ORDER_TYPE;
export const CANCELLATION_TYPE =
  'Cancellation(address account,address action,uint64 attemptId,uint64 setupNonce,bytes32 setupBodyHash,uint48 validUntil,uint256 place)';

export type Members = {
  chainId: number;
  manager: Hex;
  account: Hex;
  action: Hex;
  attemptId: bigint;
  setupNonce: bigint;
  setupBodyHash: Hex;
  validUntil: number;
  payload: Hex;
  order: { token: Hex; amount: bigint; payee: Hex };
};

type Hasher = (hex: string) => Hex;

export const domainSeparator = (chainId: number, manager: string, version: string, hash: Hasher = keccakLocal): Hex =>
  hash(
    join(
      hash(join(Buffer.from(DOMAIN_TYPE).toString('hex'))).slice(2),
      hash(join(Buffer.from('PolicyManager').toString('hex'))).slice(2),
      hash(join(Buffer.from(version).toString('hex'))).slice(2),
      word(chainId),
      addressWord(manager),
    ),
  );

const typeHash = (text: string, hash: Hasher): string => hash(join(Buffer.from(text).toString('hex'))).slice(2);

/** The approval digest, assembled by hand from the EIP-712 type strings. */
export const oracleApproval = (m: Members, place: bigint | number, version = '1', hash: Hasher = keccakLocal): Hex => {
  const order = hash(
    join(typeHash(PAYMENT_ORDER_TYPE, hash), addressWord(m.order.token), word(m.order.amount), addressWord(m.order.payee)),
  );
  const struct = hash(
    join(
      typeHash(APPROVAL_TYPE, hash),
      addressWord(m.account),
      addressWord(m.action),
      word(m.attemptId),
      word(m.setupNonce),
      m.setupBodyHash.slice(2).toLowerCase(),
      hash(m.payload).slice(2),
      order.slice(2),
      word(m.validUntil),
      word(place),
    ),
  );

  return hash(join('1901', domainSeparator(m.chainId, m.manager, version, hash).slice(2), struct.slice(2)));
};

/** The cancellation digest, assembled by hand from the EIP-712 type strings. */
export const oracleCancellation = (m: Members, place: bigint | number, version = '1', hash: Hasher = keccakLocal): Hex => {
  const struct = hash(
    join(
      typeHash(CANCELLATION_TYPE, hash),
      addressWord(m.account),
      addressWord(m.action),
      word(m.attemptId),
      word(m.setupNonce),
      m.setupBodyHash.slice(2).toLowerCase(),
      word(m.validUntil),
      word(place),
    ),
  );

  return hash(join('1901', domainSeparator(m.chainId, m.manager, version, hash).slice(2), struct.slice(2)));
};

export const fastKeccak: Hasher = (hex) => viemKeccak(hex as Hex);

/** The blessed approval row's members (approval-digest.json, row `normal`). */
export const baseMembers = (): Members => ({
  chainId: 1,
  manager: A_MANAGER,
  account: A_ACCOUNT,
  action: AN_ACTION,
  attemptId: 9n,
  setupNonce: 7n,
  setupBodyHash: '0x6b359609fb43fd6343d702b855975035a90d454cb081cb662938e219a51a1160',
  validUntil: 1_800_000_000,
  payload: '0xabcdef',
  order: { token: A_TOKEN, amount: 1_234_567_890_123_456_789n, payee: A_PAYEE },
});
