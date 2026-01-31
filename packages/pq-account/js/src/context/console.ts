import { createContext } from "react";

export interface ConsoleContextValue {
  outputs: Record<string, string>;
  log: (panel: string, msg: string) => void;
  clear: (panel: string) => void;
}

export const ConsoleContext = createContext<ConsoleContextValue | null>(null);
