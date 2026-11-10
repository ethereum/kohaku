import { METHOD_ZKPASSPORT_CONFIG_FIELDS, METHOD_ZKPASSPORT_MAX_VALIDITY, METHOD_ZKPASSPORT_MIN_VALIDITY } from '../constants';
import type { ZkPassportConfig } from '../types';

const [IDENTIFIER_FIELD, , , VALIDITY_FIELD] = METHOD_ZKPASSPORT_CONFIG_FIELDS;

/**
 * The config fields, in layout order, the SDK refuses: a zero identifier and a validity period under `METHOD_ZKPASSPORT_MIN_VALIDITY`,
 * which never verify, and a period over `METHOD_ZKPASSPORT_MAX_VALIDITY`, which the SDK does not support though the chain may still verify it.
 * The domain and scope are not judged.
 */
export function zkPassportConfigOutOfBounds(config: ZkPassportConfig): string[] {
  const period = config.validityPeriodInSeconds;
  const refused: readonly (readonly [string, boolean])[] = [
    [IDENTIFIER_FIELD, BigInt(config.uniqueIdentifier) === 0n],
    [VALIDITY_FIELD, period < METHOD_ZKPASSPORT_MIN_VALIDITY || period > METHOD_ZKPASSPORT_MAX_VALIDITY],
  ];

  return refused.filter(([, out]) => out).map(([field]) => field);
}
