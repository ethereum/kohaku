import { createContext } from "react";

export interface SessionData {
  pimlicoApiKey: string;
  accountAddress: string;
  preQuantumSeed: string;
  postQuantumSeed: string;
}

export interface SessionContextType {
  session: SessionData;
  updateSession: (data: Partial<SessionData>) => void;
}

export const SessionContext = createContext<SessionContextType | null>(null);
