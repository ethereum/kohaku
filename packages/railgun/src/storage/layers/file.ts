import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { StorageLayer } from "../base";

export type FileStorageParams = {
  skipWrite?: boolean;
};

export const createFileStorageLayer = (
  path: string,
  params?: FileStorageParams
): StorageLayer => {
  const fullPath = join(process.cwd(), path);
  const skipWrite = params?.skipWrite ?? false;

  console.log("fullPath", fullPath);

  return {
    async read() {
      if (!existsSync(fullPath)) return;

      return JSON.parse(await readFile(fullPath, "utf8"));
    },
    async write(data) {
      console.log("writing to file", fullPath);

      if (skipWrite) return;

      await writeFile(fullPath, JSON.stringify(data));
    },
  };
};
