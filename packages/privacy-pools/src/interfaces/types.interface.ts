// Shenanigan to show Precommitment in the map type instead of bigint.
export type Precommitment = bigint & {};
export type Nullifier = bigint & {};
export type Address = bigint & {};
export type Commitment = bigint & {};
export type Label = bigint & {};

/**
 * Where the ASP stands on a deposit. `approved` comes from the verified ASP tree;
 * `declined` and `poi_required` from the ASP's review feed, when one is configured.
 */
export type AspReviewStatus = 'pending' | 'approved' | 'declined' | 'poi_required';
