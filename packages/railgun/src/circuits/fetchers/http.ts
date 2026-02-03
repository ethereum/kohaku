import { RGCircuitGetterFn } from "..";

export const rgHttpFetcher: RGCircuitGetterFn = async (path: string) => {
  const response = await fetch(`https://raw.githubusercontent.com/lucemans/railguntemp/refs/heads/master/package/${path}`);

  return Buffer.from(await response.arrayBuffer());
}
