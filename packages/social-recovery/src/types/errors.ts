import type { AbiErrorItem, KitErrorSource } from '../interfaces';

/** One error of the set, with the source that raises it. */
export type SourcedError = {
  readonly source: KitErrorSource;
  readonly item: AbiErrorItem;
};
