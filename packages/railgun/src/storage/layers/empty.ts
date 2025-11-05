import { StorageLayer } from "../base";

// Empty storage layer mostly used for tests
export const createEmptyStorageLayer = (): StorageLayer => {
  let storage: string | undefined;

  return {
    read() {
      if (!storage) return;

      return JSON.parse(storage);
    },
    async write(data) {
      storage = JSON.stringify(data);
    },
  };
};
