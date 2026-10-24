import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import vectors from '../fixtures/reference-vectors.json';
import { decodeAddress, keysFromIdentity } from '../../src/crypto/address';
import { bech32mDecode, bech32mEncode } from '../../src/crypto/bech32m';
import { hex, unhex } from '../../src/crypto/bytes';
import { BASE8, inSubgroup, mulB8, mulPoint, packPoint, unpackPoint } from '../../src/crypto/field';
import { leafOf, nullifierOf, ownedKeys, sign } from '../../src/crypto/keys';
import { encodeTransact, TRANSACT_TOPIC } from '../../src/pool/abi';
import { openNote, sealNote } from '../../src/pool/memo';
import { incTree } from '../../src/pool/tree';
import { buildWitness, extDataHash, poolAsset } from '../../src/pool/witness';
import { keccak_256 } from '@noble/hashes/sha3.js';

// The fixture was produced by the reference implementation (see `source` in the file). Matching it byte for byte is
// what lets this wallet and the other Tacit apps read each other's notes.

const v = vectors;
const asset = BigInt(v.asset);
const keys1 = keysFromIdentity(unhex(v.identity1.key));
const keys2 = keysFromIdentity(unhex(v.identity2.key));
const big = (x: string) => BigInt(x);

// The stream of filler randomness the fixture was generated with.
function stream() {
  let counter = 0;

  return (size: number): Uint8Array => {
    const out = new Uint8Array(size);

    for (let i = 0; i < size; i += 32) {
      const block = createHash('sha256').update(`xcheck-${counter++}`).digest();

      out.set(block.subarray(0, Math.min(32, size - i)), i);
    }

    return out;
  };
}

describe('keys and addresses', () => {
  it('derives the reference wallet from an identity key', () => {
    expect(keys1.address).toBe(v.identity1.address);
    expect(keys1.zk.a).toBe(big(v.identity1.a));
    expect(keys1.zk.n).toBe(big(v.identity1.n));
    expect(keys2.address).toBe(v.identity2.address);
  });

  it('round-trips an address and rejects malformed ones', () => {
    const decoded = decodeAddress(keys1.address);

    expect(decoded.A).toEqual(keys1.A);
    expect(decoded.N).toEqual(keys1.N);
    expect(decoded.V.equals(keys1.V)).toBe(true);
    expect(decodeAddress(keys1.address.toUpperCase()).A).toEqual(keys1.A);
    expect(() => decodeAddress(keys1.address.slice(0, -1) + (keys1.address.endsWith('q') ? 'p' : 'q'))).toThrow(/checksum/);
    expect(() => decodeAddress('tbp' + keys1.address.slice(2))).toThrow();
    expect(() => decodeAddress(keys1.address.slice(0, 20) + keys1.address.slice(20).toUpperCase())).toThrow(/mixed-case/);
    expect(() => decodeAddress(bech32mEncode('bp', new Uint8Array(96)))).toThrow(/97 bytes/);
    expect(() => decodeAddress(bech32mEncode('xx', new Uint8Array(97)))).toThrow(/prefix/);
  });

  it('refuses a BabyJubJub key outside the subgroup or at the identity', () => {
    const bytes = bech32mDecode(keys1.address).bytes.slice();

    bytes.set(packPoint([0n, 1n]), 33);
    expect(() => decodeAddress(bech32mEncode('bp', bytes))).toThrow(/subgroup/);
    expect(() => keysFromIdentity(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe('BabyJubJub', () => {
  it('multiplies Base8 consistently and packs points losslessly', () => {
    expect(mulB8(1n)).toEqual([...BASE8]);
    expect(mulB8(12345n)).toEqual(mulPoint(BASE8, 12345n));

    for (const k of [1n, 2n, 987654321n, (1n << 200n) + 12345n]) {
      const point = mulB8(k);

      expect(unpackPoint(packPoint(point))).toEqual(point);
      expect(inSubgroup(point)).toBe(true);
    }
  });

  it('rejects bytes that are not a subgroup point', () => {
    expect(unpackPoint(new Uint8Array(31))).toBeNull();
    expect(unpackPoint(Uint8Array.from({ length: 32 }, () => 0xff))).toBeNull();
  });
});

describe('notes', () => {
  const secret = unhex(v.secret);
  const owned = ownedKeys(keys1.zk, secret);

  it('derives note keys, leaves and nullifiers as the reference does', () => {
    expect(owned.sk).toBe(big(v.owned.sk));
    expect(owned.nk).toBe(big(v.owned.nk));
    expect(owned.npk).toBe(big(v.owned.npk));
    expect(owned.rho).toBe(big(v.owned.rho));
    expect(poolAsset({ chainId: v.chainId, pool: v.pool })).toBe(asset);
    expect(leafOf(asset, 12345n, owned.npk, owned.rho)).toBe(big(v.leaf));
    expect(nullifierOf(owned.nk, 99n, 7)).toBe(big(v.nullifier));
  });

  it('signs as the reference does', () => {
    const sig = sign(owned.sk, 5555n);

    expect([...sig.R8].map(String)).toEqual(v.signature.R8);
    expect(sig.S).toBe(big(v.signature.S));
  });

  it('seals a note whose memo only its recipient can open', () => {
    const sealed = sealNote(decodeAddress(keys2.address), 777n, asset, big(v.sealed.ephemeral));

    expect(sealed.leaf).toBe(big(v.sealed.leaf));
    expect(hex(sealed.memo)).toBe(v.sealed.memo);

    const item = { memo: sealed.memo, leaf: sealed.leaf, asset };
    const opened = openNote(keys2, item);

    expect(opened?.value).toBe(777n);
    expect(opened?.rho).toBe(sealed.rho);
    expect(openNote(keys1, item)).toBeNull();
    expect(openNote(keys2, { ...item, leaf: sealed.leaf + 1n })).toBeNull();
    expect(openNote(keys2, { ...item, memo: sealed.memo.slice(0, 64) })).toBeNull();

    const tampered = sealed.memo.slice();

    tampered[40] = tampered[40]! ^ 1;
    expect(openNote(keys2, { ...item, memo: tampered })).toBeNull();
  });

  it('refuses values the circuit cannot hold', () => {
    expect(() => sealNote(decodeAddress(keys2.address), 1n << 120n, asset)).toThrow(/2\^120/);
    expect(() => leafOf(asset, -1n, 1n, 1n)).toThrow(/2\^120/);
  });
});

describe('incremental tree', () => {
  const leaves = v.tree.leaves.map(big);
  const build = () => {
    const tree = incTree();

    for (const [from, to, track] of v.tree.batches as Array<[number, number, number[]]>) tree.append(leaves.slice(from, to), track);

    return tree;
  };

  it('matches the reference root, edge, paths and insertion path', () => {
    const tree = build();

    expect(tree.root).toBe(big(v.tree.root));
    expect(tree.size).toBe(v.tree.size);
    expect(tree.toJSON()).toEqual(v.tree.json);
    expect(tree.path(17).map(String)).toEqual(v.tree.path17);
    expect(tree.insertionPath().map(String)).toEqual(v.tree.insertionPath);
  });

  it('survives serialization and cloning, and keeps tracked paths current', () => {
    const tree = build();
    const restored = incTree(JSON.parse(JSON.stringify(tree.toJSON())));

    expect(restored.root).toBe(tree.root);
    expect(restored.clone().toJSON()).toEqual(tree.toJSON());

    tree.append([1n, 2n]);
    restored.append([1n, 2n]);
    expect(restored.root).toBe(tree.root);
    expect(restored.path(40)).toEqual(tree.path(40));
  });

  it('refuses a path for a leaf it was not told to track, and tracking outside the batch', () => {
    const tree = build();

    expect(() => tree.path(5)).toThrow(/not tracked/);
    expect(() => tree.append([1n, 2n], [999])).toThrow(/outside the batch/);

    tree.untrack(17);
    expect(tree.has(17)).toBe(false);
  });
});

describe('witness', () => {
  const ext = v.extData;
  const asHex = (s: string) => unhex(s);
  const dataOf = (e: typeof ext.withdrawal) => ({
    chainId: big(e.chainId), pool: e.pool, recipient: e.recipient, extAmount: big(e.extAmount), relayer: e.relayer, fee: big(e.fee), memo0: asHex(e.memo0), memo1: asHex(e.memo1),
  });

  it('hashes the external data as the pool does', () => {
    expect(extDataHash(dataOf(ext.withdrawal))).toBe(big(ext.withdrawal.hash));
    expect(extDataHash(dataOf(ext.deposit))).toBe(big(ext.deposit.hash));
    expect(() => extDataHash({ ...dataOf(ext.deposit), extAmount: 1n << 120n })).toThrow(/out of range/);
    expect(() => extDataHash({ ...dataOf(ext.deposit), recipient: '0x1234' })).toThrow(/20 bytes/);
  });

  const leaves = v.tree.leaves.map(big);
  const out = { v: 1000n, npk: big(v.sealed.npk), rho: big(v.sealed.rho) };

  it('builds the reference deposit witness', () => {
    const tree = incTree();

    tree.append(leaves.slice(0, 52), [6]);

    const w = buildWitness({
      asset, tree, inputs: [{ dummy: true }, { dummy: true }], outputs: [out, null], extAmount: 1000n, fee: 0n,
      extDataHash: big(ext.deposit.hash), random: stream(),
    });

    expect(w.publicSignals).toEqual(v.witnessDeposit.publicSignals);
    expect(w.input).toEqual(v.witnessDeposit.input);
  });

  it('builds the reference spend witness', () => {
    const owned = ownedKeys(keys1.zk, unhex(v.secret));
    const tree = incTree();

    tree.append(leaves.slice(0, 52).map((l, i) => (i === 6 ? leafOf(asset, 900n, owned.npk, owned.rho) : l)), [6]);

    const w = buildWitness({
      asset, tree, inputs: [{ v: 900n, rho: owned.rho, nk: owned.nk, sk: owned.sk, index: 6 }, { dummy: true }],
      outputs: [{ v: 450n, npk: out.npk, rho: out.rho }, null], extAmount: -400n, fee: 50n,
      extDataHash: extDataHash({ ...dataOf(ext.withdrawal), extAmount: -400n, fee: 50n }), random: stream(),
    });

    expect(w.publicSignals).toEqual(v.witnessSpend.publicSignals);
    expect(w.input).toEqual(v.witnessSpend.input);
  });

  it('refuses a witness that does not balance, or an input that is not in the tree', () => {
    const owned = ownedKeys(keys1.zk, unhex(v.secret));
    const tree = incTree();

    tree.append(leaves.slice(0, 52), [6]);

    const base = { asset, tree, fee: 0n, extDataHash: 1n, random: stream() };

    expect(() => buildWitness({ ...base, inputs: [{ dummy: true }, { dummy: true }], outputs: [out, null], extAmount: 999n })).toThrow(/not conserved/);
    expect(() =>
      buildWitness({ ...base, inputs: [{ v: 900n, rho: owned.rho, nk: owned.nk, sk: owned.sk, index: 6 }, { dummy: true }], outputs: [null, null], extAmount: -900n }),
    ).toThrow(/not the leaf/);
  });
});

describe('transaction encoding', () => {
  it('uses the live event topic and the pool selector', () => {
    expect(TRANSACT_TOPIC).toBe(hex(keccak_256(new TextEncoder().encode('Transact(bytes32,bytes32,bytes32,bytes32,uint256,bytes32,address,int256,address,uint256,bytes,bytes)'))));

    const data = encodeTransact({
      pA: ['1', '2'], pB: [['3', '4'], ['5', '6']], pC: ['7', '8'], publicInputs: v.witnessDeposit.publicSignals,
      recipient: '0x0000000000000000000000000000000000000000', extAmount: '1000', relayer: '0x0000000000000000000000000000000000000000', fee: '0', memo0: '0x', memo1: '0x',
    });

    expect(data.slice(0, 10)).toBe(hex(keccak_256(new TextEncoder().encode('transact(uint256[2],uint256[2][2],uint256[2],uint256[11],address,int256,address,uint256,bytes,bytes)'))).slice(0, 10));
  });
});
