import {
  METHOD_ZKPASSPORT_CUSTOM_DATA_KEY,
  METHOD_ZKPASSPORT_DEV_MODE,
  METHOD_ZKPASSPORT_DISPLAY_MESSAGE,
  METHOD_ZKPASSPORT_DISPLAY_FIELDS,
  METHOD_ZKPASSPORT_REQUEST_MODE,
  METHOD_ZKPASSPORT_SESSION_MESSAGE,
} from '../constants';
import type { Input, Params } from '../interfaces';
import type { ZkPassportRequest, ZkPassportRequestArgs, ZkPassportSession, ZkPassportStack } from '../types';

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const optionalText = (value: unknown): value is string | undefined =>
  value === undefined || typeof value === 'string';

const display = (source: { readonly [name: string]: unknown }): Pick<ZkPassportSession, 'name' | 'logo' | 'purpose'> => {
  const shown: { name?: string; logo?: string; purpose?: string } = {};

  for (const key of METHOD_ZKPASSPORT_DISPLAY_FIELDS) {
    const value = source[key];

    if (typeof value === 'string') shown[key] = value;
  }

  return shown;
};

/** The session the parameters name; `TypeError` on a missing domain or scope or a shown text that is not a string. */
export const sessionFromParams = (params: Params | undefined): ZkPassportSession => {
  const p = params ?? {};

  if (!nonEmpty(p['domain']) || !nonEmpty(p['scope'])) {
    throw new TypeError(METHOD_ZKPASSPORT_SESSION_MESSAGE);
  }

  if (!optionalText(p['name']) || !optionalText(p['logo']) || !optionalText(p['purpose'])) {
    throw new TypeError(METHOD_ZKPASSPORT_DISPLAY_MESSAGE);
  }

  return { domain: p['domain'], scope: p['scope'], ...display(p) };
};

/** The session an input record carries, or undefined where it carries none. */
export const sessionFromInput = (input: Input): ZkPassportSession | undefined => {
  const domain = input['domain'];
  const scope = input['scope'];

  if (!nonEmpty(domain) || !nonEmpty(scope)) return undefined;

  return { domain, scope, ...display(input) };
};

/** The session's request arguments, in `compressed-evm` mode with dev mode off. */
export const requestArgs = (session: ZkPassportSession): ZkPassportRequestArgs => ({
  ...display(session),
  scope: session.scope,
  mode: METHOD_ZKPASSPORT_REQUEST_MODE,
  devMode: METHOD_ZKPASSPORT_DEV_MODE,
});

/** A thunk that opens the session's request on the stack, binding the custom field where a text is given. */
export const opener =
  (stack: ZkPassportStack, session: ZkPassportSession, customData: string | undefined): (() => Promise<ZkPassportRequest>) =>
  async () => {
    const client = await stack(session.domain);
    const builder = await client.request(requestArgs(session));

    return (customData === undefined ? builder : builder.bind(METHOD_ZKPASSPORT_CUSTOM_DATA_KEY, customData)).done();
  };
