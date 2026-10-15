import { encodeAbiParameters, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  fileReply,
  GATHERING_REPLY_KIND,
  GATHERING_REPLY_VERSION,
  requests,
  walletMethod,
  type ApproverRequest,
  type Gathering,
  type Reply,
} from '../../src/index';
import { approvalGathering, cancellationGathering, placeEntry } from '../gathering/support';
import { addressWord, KEY_ONE, KEY_TWO, SIGNER_ONE, signDigest, ZERO_ADDRESS } from '../method-ecdsa/fixtures';
import { isArgumentError, LETTERED_METHOD, orchestratorOver, rejectionOf, thrownBy } from './doubles';
import { expectedDigest } from './expected';

const REPLY_MEMBERS = [
  'kind',
  'version',
  'chainId',
  'manager',
  'account',
  'action',
  'attemptId',
  'purpose',
  'place',
  'method',
  'config',
  'salt',
  'digest',
  'proof',
].sort();

/** A gathering whose places are wallet guardians under the lettered method address, spelled in lower case. */
function walletGathering(purpose: 'approval' | 'cancellation', holdsCode = false): Gathering {
  const places = [0, 1, 2].map((place) =>
    placeEntry(place, {
      method: LETTERED_METHOD.toLowerCase() as `0x${string}`,
      config: addressWord(SIGNER_ONE).toUpperCase().replace('0X', '0x') as `0x${string}`,
      credentialHoldsCode: holdsCode,
    }),
  );

  return purpose === 'approval' ? approvalGathering(places) : cancellationGathering(places);
}

const wallet = () => orchestratorOver([[LETTERED_METHOD, walletMethod()]], ['none']);

async function signedReply(request: ApproverRequest, key = KEY_ONE): Promise<Reply> {
  const orchestrator = wallet();
  const input = orchestrator.signingInput(request);
  const signature = await signDigest(expectedDigest(request), key);
  const reply = await orchestrator.replyFrom(request, input, { signature });

  if (reply.kind !== GATHERING_REPLY_KIND) throw new Error(`no reply: ${JSON.stringify(reply)}`);

  return reply;
}

describe('replyFrom with the wallet method builds the reply record from the request', () => {
  for (const purpose of ['approval', 'cancellation'] as const) {
    it(`${purpose}: names the request's own members, checksummed and lower-cased, and files into the gathering`, async () => {
      const gathering = walletGathering(purpose);

      for (const request of requests(gathering)) {
        const reply = await signedReply(request);

        expect(Object.keys(reply).sort()).toStrictEqual(REPLY_MEMBERS);
        expect(reply).toMatchObject({
          kind: GATHERING_REPLY_KIND,
          version: GATHERING_REPLY_VERSION,
          chainId: request.chainId,
          manager: getAddress(request.manager),
          account: getAddress(request.account),
          action: getAddress(request.action),
          attemptId: request.attemptId,
          purpose,
          place: request.place,
          method: LETTERED_METHOD,
          config: request.config.toLowerCase(),
          salt: request.salt.toLowerCase(),
          digest: expectedDigest(request),
        });
        expect(reply.proof).toMatch(/^0x[0-9a-f]{130}$/);

        const filed = fileReply(gathering, reply);

        expect(filed.outcome).toBe('filed');
      }
    });
  }

  it('the signingInput the wallet gets is the typed data of the digest', () => {
    const request = requests(walletGathering('approval'))[1]!;
    const input = wallet().signingInput(request);

    expect(input).toMatchObject({ primaryType: 'Approval', message: { place: 1 } });
  });

  it('a wallet that said nothing answers material-rejected, never a thrown error', async () => {
    const request = requests(walletGathering('approval'))[0]!;

    expect(await wallet().replyFrom(request, {}, undefined)).toStrictEqual({ kind: 'reply-failure', cause: 'material-rejected' });
    expect(await wallet().replyFrom(request, {}, { signature: '0x' })).toStrictEqual({ kind: 'reply-failure', cause: 'material-rejected' });
  });
});

describe('verify with the wallet method', () => {
  it('satisfied for the signer, rejected for another key', async () => {
    const request = requests(walletGathering('approval'))[2]!;
    const good = await signDigest(expectedDigest(request), KEY_ONE);
    const bad = await signDigest(expectedDigest(request), KEY_TWO);

    expect(await wallet().verify(request, request.place, good)).toBe('satisfied');
    expect(await wallet().verify(request, request.place, bad)).toBe('rejected');
  });

  it('not-judged where the credential holds code', async () => {
    const request = requests(walletGathering('cancellation', true))[0]!;
    const good = await signDigest(expectedDigest(request), KEY_ONE);

    expect(await wallet().verify(request, request.place, good)).toBe('not-judged');
  });

  it('a proof that is not hex of whole bytes, or no proof, is a TypeError naming the proof', async () => {
    const request = requests(walletGathering('approval'))[0]!;

    for (const proof of ['signature', '0xabc', '0xZZ', '', 'c0ffee', undefined, null, 5]) {
      const error = await rejectionOf(() => wallet().verify(request, request.place, proof as `0x${string}`));

      expect(error, String(proof)).toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain('proof');
    }
  });

  it('a proof of no bytes is hex and gets the method\'s verdict', async () => {
    const request = requests(walletGathering('approval'))[0]!;

    expect(await wallet().verify(request, request.place, '0x')).toBe('rejected');
  });

  it('a signature over another place is rejected for this one', async () => {
    const [first, second] = requests(walletGathering('approval'));
    const signature = await signDigest(expectedDigest(first!), KEY_ONE);

    expect(await wallet().verify(second!, second!.place, signature)).toBe('rejected');
  });

  it('a place other than the request\'s own throws RangeError before the method is asked', async () => {
    const request = requests(walletGathering('approval'))[0]!;
    const signature = await signDigest(expectedDigest(request), KEY_ONE);

    for (const place of [1, 2, request.place + 2 ** 31]) {
      expect(await rejectionOf(() => wallet().verify(request, place, signature))).toBeInstanceOf(RangeError);
    }
  });

  it('a place that is not a place at all is a malformed argument', async () => {
    const request = requests(walletGathering('approval'))[0]!;

    for (const place of [-1, 0.5, '0', Number.NaN, undefined]) {
      expect(isArgumentError(await rejectionOf(() => wallet().verify(request, place as number, '0x01')))).toBe(true);
    }
  });
});

describe('the enrolling pair with the wallet method', () => {
  it('enrollInput carries the address with nothing to perform; configFrom gives abi.encode(address)', async () => {
    const orchestrator = wallet();
    const input = orchestrator.enrollInput(LETTERED_METHOD, { address: SIGNER_ONE });

    expect(input).toMatchObject({ kind: 'nothing-to-perform' });
    expect(await orchestrator.configFrom(LETTERED_METHOD, input, undefined)).toBe(encodeAbiParameters([{ type: 'address' }], [SIGNER_ONE]));
  });

  it('the zero address answers material-rejected', async () => {
    const orchestrator = wallet();
    const input = orchestrator.enrollInput(LETTERED_METHOD, { address: ZERO_ADDRESS });

    expect(await orchestrator.configFrom(LETTERED_METHOD, input, undefined)).toStrictEqual({ kind: 'reply-failure', cause: 'material-rejected' });
  });

  it('the enrolling pair accepts the method address in lower case', async () => {
    const orchestrator = wallet();
    const lower = LETTERED_METHOD.toLowerCase() as `0x${string}`;
    const input = orchestrator.enrollInput(lower, { address: SIGNER_ONE });

    expect(await orchestrator.configFrom(lower, input, undefined)).toBe(addressWord(SIGNER_ONE));
  });

  it('a malformed method address throws TypeError', () => {
    expect(thrownBy(() => wallet().enrollInput('0xnope' as `0x${string}`, { address: SIGNER_ONE }))).toBeInstanceOf(TypeError);
  });
});
