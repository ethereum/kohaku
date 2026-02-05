import { useCallback, useContext } from "react";

import {
  ConsoleDispatchContext,
  ConsoleStateContext,
} from "../context/console";

export const useConsoleLog = (panel: string) => {
  const dispatch = useContext(ConsoleDispatchContext);

  if (!dispatch)
    throw new Error("useConsoleLog must be used within ConsoleProvider");

  const { log: ctxLog, clear: ctxClear } = dispatch;

  const log = useCallback((msg: string) => ctxLog(panel, msg), [ctxLog, panel]);
  const clear = useCallback(() => ctxClear(panel), [ctxClear, panel]);

  return { log, clear };
};

export const useConsoleOutput = (panel: string) => {
  const outputs = useContext(ConsoleStateContext);

  if (!outputs)
    throw new Error("useConsoleOutput must be used within ConsoleProvider");

  return outputs[panel] ?? "";
};

export const useConsole = (panel: string) => {
  const { log, clear } = useConsoleLog(panel);
  const output = useConsoleOutput(panel);

  return { output, log, clear };
};
