import type { TokenData } from "../../railgun/logic/logic/note";

export const getERC20TokenData = (token: string): TokenData => ({
  tokenType: 0,
  tokenAddress: token,
  tokenSubID: 0n,
});
