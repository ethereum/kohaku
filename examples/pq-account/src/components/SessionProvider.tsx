import { type ReactNode, useCallback, useEffect, useState } from "react";

import { SessionContext, type SessionData } from "../context/session";

const SESSION_STORAGE_KEY = "@kohaku/pq-account/js";

const DEFAULT_SESSION: SessionData = {
  pimlicoApiKey: "",
  accountAddress: "",
  preQuantumSeed:
    "0x0000000000000000000000000000000000000000000000000000000000000001",
  postQuantumSeed:
    "0x0000000000000000000000000000000000000000000000000000000000000001",
};

const loadSession = (): SessionData => {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);

    return stored ? JSON.parse(stored) : DEFAULT_SESSION;
  } catch {
    return DEFAULT_SESSION;
  }
};

const saveSession = (data: SessionData) => {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("Failed to save session:", error);
  }
};

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<SessionData>(loadSession);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  const updateSession = useCallback((data: Partial<SessionData>) => {
    setSession((prev) => ({ ...prev, ...data }));
  }, []);

  return (
    <SessionContext.Provider value={{ session, updateSession }}>
      {children}
    </SessionContext.Provider>
  );
};
