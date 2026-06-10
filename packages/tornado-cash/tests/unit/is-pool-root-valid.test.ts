import { describe, expect, it, vi } from 'vitest';
import { decodeFunctionData } from 'viem';
import { DataService } from '../../src/data/data.service';
import { poolAbi } from '../../src/data/abis/pool.abi';
import type { Address } from '../../src/interfaces/types.interface';

// Regression test for the bytes32 root encoding in DataService.isPoolRootValid.
// isKnownRoot takes a `bytes32 _root`. Encoding the root with a minimal-width
// hex (toHex(root)) makes viem's ABI encoder throw AbiEncodingBytesSizeMismatchError
// (e.g. bytes1 vs bytes32) for any root narrower than 32 bytes, so the call throws
// instead of returning a result. The root must be encoded with a fixed 32-byte width.
describe('DataService.isPoolRootValid bytes32 encoding', () => {
  it('encodes the pool root as a full 32-byte word (round-trips through ABI)', async () => {
    let capturedData: `0x${string}` | undefined;

    const provider = {
      request: vi.fn(async (args: { method: string; params: [{ data: `0x${string}` }, string] }) => {
        capturedData = args.params[0].data;
        // abi-encoded `true`
        return '0x0000000000000000000000000000000000000000000000000000000000000001';
      }),
    } as unknown as ConstructorParameters<typeof DataService>[0]['provider'];

    const dataService = new DataService({ provider });

    // A small root exposes the bug: its minimal-width hex is narrower than 32 bytes.
    const root = 0xffn;
    await dataService.isPoolRootValid(1000n as Address, root);

    expect(capturedData).toBeDefined();
    const decoded = decodeFunctionData({ abi: poolAbi, data: capturedData! });
    expect(decoded.functionName).toBe('isKnownRoot');
    // The on-chain call must carry the exact root, ABI-encoded as a full bytes32.
    expect(BigInt(decoded.args![0] as `0x${string}`)).toBe(root);
  });
});
