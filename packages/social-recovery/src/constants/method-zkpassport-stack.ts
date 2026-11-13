/** The stack version this build pins and its standing, as `describe` reports it; kept out of the constants index so the core entry does not re-export it. */
export const METHOD_ZKPASSPORT_STACK_STANDING = Object.freeze({ package: '@zkpassport/sdk', version: '0.17.1', status: 'pinned-only' } as const);

/** The code Node's ESM resolver gives the stack's `import ... from 'buffer/'`, the one failure on which its CommonJS build is loaded instead. */
export const METHOD_ZKPASSPORT_STACK_DIRECTORY_IMPORT = 'ERR_UNSUPPORTED_DIR_IMPORT';

/** The Node built-in that loads the stack's CommonJS build, reached through `process.getBuiltinModule` so no bundle imports it. */
export const METHOD_ZKPASSPORT_STACK_NODE_MODULE = 'node:module';
