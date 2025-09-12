export const isReactNative =
  typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

export const isNodejs =
  typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
