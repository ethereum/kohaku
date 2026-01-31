export interface NetworkInfo {
  key: string;
  name: string;
  chainId: string;
  supported: boolean;
}

export interface Deployments {
  [network: string]: {
    accounts?: {
      [mode: string]: {
        address: string;
      };
    };
  };
}

export interface WindowEthereum extends Window {
  ethereum?: {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on: (event: string, callback: (...args: unknown[]) => void) => void;
    removeListener: (
      event: string,
      callback: (...args: unknown[]) => void
    ) => void;
  };
}

export interface WalletState {
  isConnected: boolean;
  networkName: string;
  isSupported: boolean;
  chainId: string;
  networkKey: string | null; // 'sepolia' | 'arbitrumSepolia' | null
  account: string | null; // connected wallet address
}

export interface ConsoleEntry {
  id: number;
  message: string;
}

export type LogFn = (msg: string) => void;

export interface DeployStepLog {
  steps: string[]; // accumulated log messages
}
