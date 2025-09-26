export type EngineDebugger = {
  log: (msg: string) => void;
  error: (error: Error) => void;
  verboseScanLogging: boolean;
};

export type KeyNode = {
  chainKey: string;
  chainCode: string;
};

export enum ChainType {
  EVM = 0,
}

export type Chain = {
  type: ChainType;
  chainId: number;
};
