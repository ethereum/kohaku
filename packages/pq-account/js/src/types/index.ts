export interface Deployments {
  [network: string]: {
    accounts?: {
      [mode: string]: {
        address: string;
      };
    };
  };
}
