import { type ReactNode, useCallback, useMemo, useState } from "react";

import {
  ConsoleDispatchContext,
  ConsoleStateContext,
} from "../context/console";

const INITIAL_OUTPUTS: Record<string, string> = {
  create: "Ready to deploy quantum-resistant account...",
  send: "Ready to send transaction...\n\n⚠️ Don't forget to enter your Pimlico API key!",
};

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [outputs, setOutputs] =
    useState<Record<string, string>>(INITIAL_OUTPUTS);

  const log = useCallback((panel: string, msg: string) => {
    setOutputs((prev) => ({
      ...prev,
      [panel]: (prev[panel] ?? "") + "\n" + msg,
    }));
  }, []);

  const clear = useCallback((panel: string) => {
    setOutputs((prev) => ({ ...prev, [panel]: "" }));
  }, []);

  const dispatch = useMemo(() => ({ log, clear }), [log, clear]);

  return (
    <ConsoleStateContext.Provider value={outputs}>
      <ConsoleDispatchContext.Provider value={dispatch}>
        {children}
      </ConsoleDispatchContext.Provider>
    </ConsoleStateContext.Provider>
  );
}
