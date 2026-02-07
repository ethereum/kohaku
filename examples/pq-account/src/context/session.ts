import { createContext } from "react";

export type SessionData = {
  pimlicoApiKey: string;
  accountAddress: string;
  preQuantumSeed: string;
  postQuantumSeed: string;
};

export type SessionContextType = {
  session: SessionData;
  updateSession: (data: Partial<SessionData>) => void;
};

export const SessionContext = createContext<SessionContextType | null>(null);
