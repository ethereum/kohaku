import { FORMATS_HEX_BYTES_PATTERN } from '../constants';
import type { ProviderRevert } from './records';

/** Tells a reverted call from any other failure of the provider. */
export const isProviderRevert = (thrown: unknown): thrown is ProviderRevert =>
  typeof thrown === 'object' &&
  thrown !== null &&
  'data' in thrown &&
  typeof thrown.data === 'string' &&
  FORMATS_HEX_BYTES_PATTERN.test(thrown.data);
