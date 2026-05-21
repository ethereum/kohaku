import * as fs from "fs";

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { generateMerkleProof } from "../src/utils/proof.util";
import { getChainConfigSetup } from "./constants";
import { AnvilPool, defineAnvil, type AnvilInstance } from './utils/anvil';
import { loadInitialState } from './utils/common';
import { createMockHost } from './utils/mock-host';
import { createMockRelayerClient } from './utils/mock-relayer';
import { getPoolStateRoot } from './utils/test-helpers';
import { TornadoCashProtocol } from "@kohaku-eth/tornado-cash";

const mockParams = () => {
  return {
    params: {
      relayerClientFactory: createMockRelayerClient,
    }
  };
};

describe("Creates the dump state payload", () => {
  let anvil: AnvilInstance;

  const chainId = inject('chainId');
  const {
    rpcUrl,
    forkBlockNumber,
    protocolConfig
  } = getChainConfigSetup(chainId);

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

  }, 300000);

  afterAll(async () => {
    await anvil.stop();
  });

  it.skip("syncs [from 0]", { timeout: 0 }, async () => {
    const pool = pools[10];

    const { params } = mockParams();
    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    const protocol = new TornadoCashProtocol(host, {
      protocolConfig,
      ...params,
    });

    await protocol.sync();

    const state = await protocol.dumpState();

    fs.writeFileSync(`./state.${chainId}.new.json`, JSON.stringify(state));

  });

  it("syncs [progressively]", { timeout: 0 }, async () => {
    const pool = pools[11];

    const { params } = mockParams();
    const host = createMockHost({ rpcUrl: pool.rpcUrl });

    const protocol = new TornadoCashProtocol(host, {
      protocolConfig,
      initialState: () => loadInitialState(chainId),
      ...params,
    });

    await protocol.sync();

    const state = await protocol.dumpState();

    fs.writeFileSync(`./state.${chainId}.updated.json`, JSON.stringify(state));

  });

  it("no missing state leaves", { timeout: 0 }, async () => {
    const pool = pools[12];
    const initialState = await loadInitialState(chainId);

    for (const protocol in initialState) {
      console.log(protocol);
      const state = initialState[protocol];

      for (const [address, deposits] of state.deposits.depositsTuples) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const sortedLeaves = [...deposits].map(([address, leaf]) => leaf).sort((a, b) => a.leafIndex - b.leafIndex);
        const indexes = sortedLeaves.map(leaf => leaf.leafIndex);
        const commitments = sortedLeaves.map(leaf => BigInt(leaf.commitment));
        const root = await getPoolStateRoot(pool, BigInt(address));
        const { root: computedRoot } = await generateMerkleProof(commitments, commitments[0]);

        expect(root).toBe(computedRoot);
        expect(indexes.length).toBe(indexes[indexes.length - 1] + 1);
        console.log(address, `[chain] 0x${root.toString(16)}`, `[comp] 0x${computedRoot.toString(16)}`, indexes.length, indexes[indexes.length - 1]);
      }
    }

  });

});
