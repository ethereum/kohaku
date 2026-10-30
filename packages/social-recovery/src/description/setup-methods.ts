import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { DESCRIPTION_PASSKEY_CONFIG_ABI } from '../constants';
import type { Address, DescribedParties, Hex, MethodStanding, SetupDescription } from '../interfaces';
import { decodeSigner, isGuardianAddress } from '../method-ecdsa/codec';
import type { MethodDescriptionReads } from '../types/description';
import type { PlacedCredential } from '../types/validation';

/** Each method the credentials name, once, in the order of its first place. */
export const distinctMethods = (credentials: readonly PlacedCredential[]): Address[] => [
  ...new Set(credentials.map(({ method }) => method)),
];

/** The name a credential's config carries in a refusal, by its clause and its position there. */
function configName(credentials: readonly PlacedCredential[], { clause, place }: PlacedCredential): string {
  const position = credentials.filter((credential) => credential.clause === clause && credential.place < place).length;

  return `draft.clauses[${clause}].credentials[${position}].config`;
}

/** The guardian a wallet config holds; throws a TypeError unless it is one address word naming a nonzero address. */
function guardianOf(credentials: readonly PlacedCredential[], credential: PlacedCredential): Address {
  let guardian: Address | undefined;

  try {
    guardian = decodeSigner(credential.config);
  } catch {
    guardian = undefined;
  }

  if (guardian === undefined || !isGuardianAddress(guardian)) {
    throw new TypeError(`${configName(credentials, credential)} must hold one nonzero guardian address`);
  }

  return guardian;
}

/** The relying-party id hash a passkey config holds; throws a TypeError unless the config is exactly that layout. */
function relyingPartyIdHashOf(credentials: readonly PlacedCredential[], credential: PlacedCredential): Hex {
  try {
    const fields = decodeAbiParameters(DESCRIPTION_PASSKEY_CONFIG_ABI, credential.config);

    if (encodeAbiParameters(DESCRIPTION_PASSKEY_CONFIG_ABI, fields) === credential.config) return fields[2].toLowerCase() as Hex;
  } catch {
    // Refused below with the credential's name.
  }

  throw new TypeError(`${configName(credentials, credential)} must be the passkey layout of x, y and the relying-party id hash`);
}

/** Per method its declared parties, per wallet guardian the address its config holds. */
export function describedParties(
  credentials: readonly PlacedCredential[],
  table: ReadonlyMap<Address, MethodDescriptionReads>,
  walletMethod: Address,
): DescribedParties {
  const walletGuardians = credentials
    .filter(({ method }) => method === walletMethod)
    .map((credential) => ({ place: credential.place, address: guardianOf(credentials, credential) }));

  return {
    methods: distinctMethods(credentials).map((method) => ({
      method,
      parties: (table.get(method) as MethodDescriptionReads).trustedParties,
    })),
    walletGuardians,
  };
}

/** Per method whether it is shipped, declares parties, passes the probe, its tier and its stop. */
export function methodStanding(
  credentials: readonly PlacedCredential[],
  table: ReadonlyMap<Address, MethodDescriptionReads>,
  shippedMethods: readonly Address[],
): MethodStanding[] {
  return distinctMethods(credentials).map((method) => {
    const reads = table.get(method) as MethodDescriptionReads;
    const { moduleInfo } = reads;

    return {
      method,
      shipped: shippedMethods.includes(method),
      declaresParties: reads.trustedParties.answered,
      probePassed: moduleInfo.answered ? { answered: true, value: moduleInfo.value.supportsInterface } : { answered: false },
      ...(reads.tier === undefined ? {} : { tier: reads.tier }),
      paused: reads.paused,
    };
  });
}

/** Per passkey credential the relying-party id hash its config holds. */
export function passkeyDomains(credentials: readonly PlacedCredential[], passkeyMethod: Address): SetupDescription['passkeyDomains'] {
  return credentials
    .filter(({ method }) => method === passkeyMethod)
    .map((credential) => ({ place: credential.place, relyingPartyIdHash: relyingPartyIdHashOf(credentials, credential) }));
}

/** Per method its stop and the pause holder its declared parties name, beside this setup's own choice. */
export function pauseOf(
  credentials: readonly PlacedCredential[],
  table: ReadonlyMap<Address, MethodDescriptionReads>,
  ignoresPause: boolean,
): SetupDescription['pause'] {
  return {
    ignoresPause,
    methods: distinctMethods(credentials).map((method) => {
      const { paused, trustedParties } = table.get(method) as MethodDescriptionReads;
      const pauseHolder = trustedParties.answered ? { answered: true, value: trustedParties.value.pauseHolder } as const : { answered: false } as const;

      return { method, paused, pauseHolder };
    }),
  };
}
