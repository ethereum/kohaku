import {
  METHOD_ZKPASSPORT_STACK_DIRECTORY_IMPORT,
  METHOD_ZKPASSPORT_STACK_NODE_MODULE,
  METHOD_ZKPASSPORT_STACK_STANDING,
} from '../constants/method-zkpassport-stack';
import type { ZkPassportClient, ZkPassportStack } from '../types';

const isDirectoryImport = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { readonly code?: unknown }).code === METHOD_ZKPASSPORT_STACK_DIRECTORY_IMPORT;

/** The stack's CommonJS build where `process.getBuiltinModule` is a function, or undefined where it is not or that build does not load. */
const requiredPeer = (): typeof import('@zkpassport/sdk') | undefined => {
  const node = globalThis.process;

  if (typeof node?.getBuiltinModule !== 'function') return undefined;

  try {
    const { createRequire } = node.getBuiltinModule(METHOD_ZKPASSPORT_STACK_NODE_MODULE);

    return createRequire(import.meta.url)(METHOD_ZKPASSPORT_STACK_STANDING.package);
  } catch {
    return undefined;
  }
};

/**
 * The stack's ESM build, or its CommonJS build where Node refuses the ESM build's directory import of `buffer/`; any other failure is
 * rethrown unchanged. The CommonJS build is loaded first, since after that refusal Node no longer requires the modules the import left half loaded.
 */
const installedPeer = async (): Promise<typeof import('@zkpassport/sdk')> => {
  const required = requiredPeer();

  try {
    return await import('@zkpassport/sdk');
  } catch (error) {
    if (required === undefined || !isDirectoryImport(error)) throw error;

    return required;
  }
};

/**
 * The default stack: loads `@zkpassport/sdk` on first use and constructs an instance for the domain.
 * In Node it is the package's CommonJS build, which needs Node 22.12 or later.
 */
export const installedStack: ZkPassportStack = async (domain: string): Promise<ZkPassportClient> => {
  const { ZKPassport } = await installedPeer();
  const client: ZkPassportClient = new ZKPassport(domain);

  return client;
};
