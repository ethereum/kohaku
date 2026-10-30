/** The most privilege entries the account's creation code writes. */
export const FORMATS_CREATION_MAX_ENTRIES = 3;

/** The opcode below `PUSH1`, so `PUSHn` is this plus `n`. */
export const FORMATS_CREATION_PUSH0_OPCODE = 0x5f;

/** The widest push, and the width of a storage slot and of a stored value. */
export const FORMATS_CREATION_WORD_BYTES = 32;

/** The `SSTORE` opcode that closes each privilege entry. */
export const FORMATS_CREATION_SSTORE_OPCODE = 0x55;

/** The deploy code after the entries, up to the `PUSH1` whose operand is the runtime's offset. */
export const FORMATS_CREATION_DEPLOY_HEAD = '0x3d602d8060';

/** The deploy code after the offset operand, which copies and returns the runtime. */
export const FORMATS_CREATION_DEPLOY_TAIL = '0x3d3981f3';

/** The minimal proxy's runtime before the push of its implementation address. */
export const FORMATS_CREATION_RUNTIME_HEAD = '0x363d3d373d3d3d363d';

/** The minimal proxy's runtime after the push of its implementation address. */
export const FORMATS_CREATION_RUNTIME_TAIL = '0x5af43d82803e903d91602b57fd5bf3';
