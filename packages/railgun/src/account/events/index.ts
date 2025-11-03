import { Indexer } from "~/indexer/base";
import { RailgunLog } from "~/provider";
import { Notebook } from "~/utils/notebook";

import { DerivedKeys } from "../keys";
import { HandleShieldEvent, makeHandleShieldEvent } from "./shield";
import { HandleTransactEvent, makeHandleTransactEvent } from "./transact";

export type ProcessLogContext = {
  notebooks: Notebook[];
  saveNotebooks: () => Promise<void>;
} & Pick<DerivedKeys, "viewing" | "spending"> &
  Pick<Indexer, "getTrees">;

export type ProcessLogParams = {
  log: RailgunLog;
  skipMerkleTree: boolean;
};

export type ProcessLog = HandleShieldEvent & HandleTransactEvent;

export const makeProcessLog = async ({
  notebooks,
  getTrees,
  viewing,
  spending,
  saveNotebooks,
}: ProcessLogContext): Promise<ProcessLog> => {
  const handleShieldEvent = await makeHandleShieldEvent({
    notebooks,
    getTrees,
    viewing,
    spending,
    saveNotebooks,
  });
  const handleTransactEvent = await makeHandleTransactEvent({
    notebooks,
    getTrees,
    viewing,
    spending,
    saveNotebooks,
  });

  return { handleShieldEvent, handleTransactEvent };
};
