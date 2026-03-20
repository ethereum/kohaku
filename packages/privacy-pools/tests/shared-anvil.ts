/* eslint-disable @typescript-eslint/no-explicit-any */
import { chainConfigSetup } from "./constants";
import { AnvilInstance, defineAnvil } from "./utils/anvil";
import type { TestProject } from "vitest/node";

const chainId = 11155111;
const {
    rpcUrl,
    forkBlockNumber,
} = chainConfigSetup[chainId];

export async function setup(project: TestProject) {
    if (!(globalThis as any).anvilInstance) {
        const anvilInstance = await defineAnvil({forkUrl: rpcUrl, chainId, forkBlockNumber});

        (globalThis as any).anvilInstance = anvilInstance;
        await anvilInstance.start();
        // Force pool 1 to fully initialize (fork from Sepolia) before any test
        // worker starts. Without this, concurrent workers all hit the lazy pool
        // during their own beforeAll, racing against each other on CI.
        await anvilInstance.pool(1).getBlockNumber();
        project.provide('rpcUrl', `http://127.0.0.1:${anvilInstance.port}/1`);
    }
}

export async function teardown() {
    const anvilInstance: AnvilInstance | undefined = (globalThis as any).anvilInstance;

  if (anvilInstance) {
    (globalThis as any).anvilInstance.stop();
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    rpcUrl: string;
  }
}
