import type { ZkPassportClient, ZkPassportStack } from '../types';

/** The default stack: imports `@zkpassport/sdk` on first use and constructs an instance for the domain. */
export const installedStack: ZkPassportStack = async (domain: string): Promise<ZkPassportClient> => {
  const { ZKPassport } = await import('@zkpassport/sdk');
  const client: ZkPassportClient = new ZKPassport(domain);

  return client;
};
