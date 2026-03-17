import * as fs from "fs";

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrivacyPoolsV1Protocol } from '../src/index';
import { addressToHex } from "../src/utils";
import { generateMerkleProof } from "../src/utils/proof.util";
import { chainConfigSetup } from "./constants";
import { AnvilPool, defineAnvil, type AnvilInstance } from './utils/anvil';
import { loadInitialState } from './utils/common';
import { createMockAspService } from './utils/mock-asp-service';
import { createMockHost } from './utils/mock-host';
import { mockProverFactory } from './utils/mock-prover';
import { createMockRelayerClient } from './utils/mock-relayer';
import { getPoolStateRoot, pushNewAspRoot } from './utils/test-helpers';

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

  const mockAspService = createMockAspService();

  mockAspService.addLabels([0n, 1n, 2n]);

  const chainId = 11155111;
  const {
    entrypoint,
    rpcUrl,
    forkBlockNumber,
    postman
  } = chainConfigSetup[chainId];

  let pools: Record<string, AnvilPool>;

  beforeAll(async () => {
    anvil = await defineAnvil({
      forkUrl: rpcUrl,
      forkBlockNumber,
      chainId,
    });

    await anvil.start();

    pools = {
      10: anvil.pool(10),
      11: anvil.pool(11),
      12: anvil.pool(12),
    };

    await Promise.all(Object.values(pools).map((p) => {
      // Create mock asp
      return pushNewAspRoot(
        p.rpcUrl,
        addressToHex(entrypoint.address),
        postman,
        {
          _root: mockAspService.getRoot(),
          _ipfsCID: "iiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii"
        }
      );
    }));

  }, 300000);

  afterAll(async () => {
    await anvil.stop();
  });

  it.skip("syncs [from 0]", { timeout: 0 }, async () => {
    const pool = pools[10];

    const { params } = mockParams();
    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      ...params,
      aspServiceFactory: () => mockAspService,
    });

    await protocol.sync();

    const state = protocol.dumpState();

    fs.writeFileSync(`./state.${chainId}.new.json`, JSON.stringify(state));

  });

  it.skip("syncs [progressively]", { timeout: 0 }, async () => {
    const pool = pools[11];

    const { params } = mockParams();
    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    const protocol = new PrivacyPoolsV1Protocol(host, {
      entrypoint,
      initialState: await loadInitialState(),
      ...params
    });

    await protocol.sync();

    const state = protocol.dumpState();

    fs.writeFileSync(`./state.${chainId}.updated.json`, JSON.stringify(state));

  });

  it("no missing state leaves", { timeout: 0 }, async () => {
    const pool = pools[12];
    const initialState = await loadInitialState();

    for (const protocol in initialState) {
      console.log(protocol);
      const state = initialState[protocol];

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
    }

  });

});
