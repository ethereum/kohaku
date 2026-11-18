import { expect, it, vi } from 'vitest';

import type { ITornadoWithdrawRequest } from '../../src/relayer/interfaces/relayer-client.interface';
import { RelayerClient, RelayerError } from '../../src/relayer/relayer-client';

const body: ITornadoWithdrawRequest = { proof: '0x00', args: ['0x00', '0x00', '0x00', '0x00', '0x00', '0x00'], contract: '0x01' };

it('validates both relayer destinations before fetching and disables redirects', async () => {
  const fetch = vi.fn(async () => Response.json({}));
  const client = new RelayerClient({ network: { fetch } });

  for (const hostname of [
    'allowed.example@127.0.0.1:8443', '127.1', '[::1]', 'foo.localhost',
    'relayer.example:443', 'relayer.example/path', 'relayer.example?query', 'relayer.example\n',
  ]) {
    await expect(client.getStatus(hostname)).rejects.toBeInstanceOf(RelayerError);
    await expect(client.withdraw(`https://${hostname}/`, body)).rejects.toBeInstanceOf(RelayerError);
  }

  await expect(client.withdraw('http://relayer.example/', body)).rejects.toBeInstanceOf(RelayerError);
  expect(fetch).not.toHaveBeenCalled();

  for (const hostname of ['Relayer.Example.com', `${'a'.repeat(56)}.onion`]) {
    await client.getStatus(hostname);
    expect(fetch).toHaveBeenLastCalledWith(`https://${hostname.toLowerCase()}/status`, { redirect: 'error' });

    await client.withdraw(`https://${hostname}/`, body);
    expect(fetch).toHaveBeenLastCalledWith(`https://${hostname.toLowerCase()}/v1/tornadoWithdraw`, expect.objectContaining({
      method: 'POST', redirect: 'error',
    }));
  }
});
