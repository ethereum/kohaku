import * as fs from "fs";

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrivacyPoolsV1Protocol } from '../src/index';
import { generateMerkleProof } from "../src/utils/proof.util";
import { defineAnvil, type AnvilInstance } from './utils/anvil';
import { getEnv, loadInitialState, MAINNET_ENTRYPOINT } from './utils/common';
import { createMockAspService } from './utils/mock-asp-service';
import { createMockHost } from './utils/mock-host';
import { mockProverFactory } from './utils/mock-prover';
import { createMockRelayerClient } from './utils/mock-relayer';
import { getPoolStateRoot } from './utils/test-helpers';

const mockParams = () => {
  // Create mock asp
  const mockAspService = createMockAspService();

  mockAspService.addLabels([0n, 1n, 2n]);
  // Create mock relayer
  const mockRelayerClient = createMockRelayerClient({ feeBPS: '100' });

  return {
    mockAspService,
    mockRelayerClient,
    params: {
      proverFactory: mockProverFactory,
      relayersList: { 'mock-relayer': 'http://mock.relayer' },
      relayerClientFactory: () => mockRelayerClient,
      aspServiceFactory: () => mockAspService,
    }
  };
};

describe("Creates the dump state payload", () => {
  let anvil: AnvilInstance;

  const MAINNET_FORK_URL = getEnv('MAINNET_RPC_URL', 'https://no-fallback');

  beforeAll(async () => {
    anvil = defineAnvil({
      forkUrl: MAINNET_FORK_URL,
      port: 8546,
      chainId: 1,
    });

    await anvil.start();
  }, 300000);

  afterAll(async () => {
    await anvil.stop();
  });

  it.skip("syncs [from 0]", { timeout: 0 }, async () => {
    const pool = anvil.pool(10);

    const { params } = mockParams();
    const host = createMockHost(undefined, pool.rpcUrl);

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint: MAINNET_ENTRYPOINT,
      ...params
    });

    await protocol.sync();

    const state = protocol.dumpState();

    fs.writeFileSync("./state.new.json", JSON.stringify(state));

  });

  it.skip("syncs [progressively]", { timeout: 0 }, async () => {
    const pool = anvil.pool(10);

    const { params } = mockParams();
    const host = createMockHost(undefined, pool.rpcUrl);

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint: MAINNET_ENTRYPOINT,
      initialState: loadInitialState(),
      ...params
    });

    await protocol.sync();

    const state = protocol.dumpState();

    fs.writeFileSync("./state.updated.json", JSON.stringify(state));

  });

  it("no missing state leaves", { timeout: 0 }, async () => {
    const pool = anvil.pool(1);
    const initialState = loadInitialState();
    const oxbow = "1-594281462506414692893575336808578746593838263110";
    const state = initialState[oxbow];

    for (const [address, leaves] of state.poolsLeaves.poolLeavesTuples) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const sortedLeaves = leaves.map(([index, leaf]) => leaf).sort((a, b) => Number(a.index) - Number(b.index));
      const indexes = sortedLeaves.map(leaf => Number(leaf.index));
      const commitments = sortedLeaves.map(leaf => BigInt(leaf.commitment));
      const root = (await getPoolStateRoot(pool, BigInt(address))).toString(16);
      const { root: computedRoot } = generateMerkleProof(commitments, commitments[0]);

      expect(`0x${root}`).toEqual(`0x${computedRoot.toString(16)}`);
      expect(indexes.length).toEqual(indexes[indexes.length - 1]);
      console.log(address, `[chain] 0x${root}`, `[comp] 0x${computedRoot.toString(16)}`, indexes.length, indexes[indexes.length - 1]);
    }
  });

});
