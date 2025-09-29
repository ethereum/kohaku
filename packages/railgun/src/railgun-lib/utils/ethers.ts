import { Result } from 'ethers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const recursivelyDecodeResult = (result: Result): any => {
  if (typeof result !== 'object') {
    // End (primitive) value
    return result;
  }
  try {
    const obj = result.toObject();
    if ('_' in obj) {
      throw new Error('Decode as array, not object');
    }
    for (const key of Object.keys(obj)) {
      obj[key] = recursivelyDecodeResult(obj[key]);
    }
    return obj;
  } catch (err) {
    console.error(err);
    // Result is array.
    return result.toArray().map((item) => recursivelyDecodeResult(item as Result));
  }
};
