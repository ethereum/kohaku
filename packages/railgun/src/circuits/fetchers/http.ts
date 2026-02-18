import { RGCircuitGetterFn } from "..";

export const rgHttpFetcher = (baseUrl: string): RGCircuitGetterFn => async (path: string) => {
  const response = await fetch(baseUrl + path);

  return Buffer.from(await response.arrayBuffer());
}
