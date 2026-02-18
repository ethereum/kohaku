import { createContext } from "react";

export type ConsoleOutputs = Record<string, string>;

export type ConsoleDispatch = {
  log: (panel: string, msg: string) => void;
  clear: (panel: string) => void;
};

export const ConsoleStateContext = createContext<ConsoleOutputs | null>(null);
export const ConsoleDispatchContext = createContext<ConsoleDispatch | null>(
  null
);
