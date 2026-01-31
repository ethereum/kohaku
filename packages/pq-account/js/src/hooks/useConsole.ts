import { useCallback, useContext } from "react";

import { ConsoleContext } from "../context/console";

export function useConsole(panel: string) {
  const context = useContext(ConsoleContext);

  if (!context)
    throw new Error("useConsole must be used within ConsoleProvider");

  const log = useCallback(
    (msg: string) => context.log(panel, msg),
    [context, panel]
  );
  const clear = useCallback(() => context.clear(panel), [context, panel]);
  const output = context.outputs[panel] ?? "";

  return { output, log, clear };
}
