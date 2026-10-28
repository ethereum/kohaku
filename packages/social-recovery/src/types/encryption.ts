import type { Configuration } from '../interfaces';

/** A configuration read from the front of `bytes`, with the number of bytes it took. */
export type ParsedConfiguration = { readonly configuration: Configuration; readonly length: number };

/** A credential's fields as bytes, validated against their widths. */
export type CredentialBytes = { readonly method: Uint8Array; readonly config: Uint8Array; readonly salt?: Uint8Array };

/** A clause's fields as bytes, validated against their widths. */
export type ClauseBytes = { readonly threshold: number; readonly credentials: readonly CredentialBytes[] };
