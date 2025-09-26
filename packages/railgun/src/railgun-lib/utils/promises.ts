 
export const delay = (delayInMS: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, delayInMS));
};

export function promiseTimeout<T>(
  promise: Promise<T>,
  ms: number,
  customError?: string,
): Promise<T> {
  // Create a promise that rejects in <ms> milliseconds
  const timeout = new Promise((_resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearTimeout(timeoutId);
      reject(new Error(customError ?? `Timed out in ${ms} ms.`));
    }, ms);
  });

  // Returns a race between our timeout and the passed in promise
  return Promise.race([promise, timeout])
    .then((result) => result as T)
    .catch((err) => {
      throw err;
    });
}
