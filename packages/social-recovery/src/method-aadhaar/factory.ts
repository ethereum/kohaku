import { METHOD_AADHAAR_DEFAULT_TEST_MODE, METHOD_AADHAAR_STACK_AND_ARTIFACTS_MESSAGE } from '../constants/method-aadhaar';
import { METHOD_AADHAAR_DEFAULT_ARTIFACTS } from '../constants/method-aadhaar-bucket';
import type { IRecoveryMethod } from '../interfaces';
import type { AnonAadhaarMethodOptions } from '../types/method-aadhaar';
import { readArtifacts } from './inputs';
import { AnonAadhaarMethod } from './method';
import { coreStack } from './stack';

/**
 * The Aadhaar method, over an injected stack or the installed `@anon-aadhaar/core` with the given artifacts or
 * `METHOD_AADHAAR_DEFAULT_ARTIFACTS`, either in test mode; passing a stack and artifacts throws a `TypeError`.
 * The SDK starts no worker: an abort settles the call `device-refused` at once, no progress is forwarded after the signal
 * aborts or the call settles, and the installed stack's download and proving run on in the page until they end, beside any
 * call started meanwhile over the same files; a call over other files waits for them to end.
 */
export function anonAadhaarMethod(options: AnonAadhaarMethodOptions = {}): IRecoveryMethod {
  if (options.stack !== undefined && options.artifacts !== undefined) {
    throw new TypeError(METHOD_AADHAAR_STACK_AND_ARTIFACTS_MESSAGE);
  }

  const artifacts = options.artifacts === undefined ? METHOD_AADHAAR_DEFAULT_ARTIFACTS : readArtifacts(options.artifacts);
  const stack = options.stack ?? coreStack(artifacts);

  return new AnonAadhaarMethod(stack, options.testMode ?? METHOD_AADHAAR_DEFAULT_TEST_MODE);
}
