import { HandleShieldEvent, makeHandleShieldEvent } from "./shield";
import { HandleTransactEvent, makeHandleTransactEvent } from "./transact";
import { DerivedKeys } from "../keys";
import { Notebook } from "~/utils/notebook";
import { RailgunLog } from "~/provider";
import { Indexer } from "~/indexer/base";

export type ProcessLogContext = {
    notebooks: Notebook[];
    saveNotebooks: () => Promise<void>;
    setAccountEndBlock: (endBlock: number) => void;
} & Pick<DerivedKeys, 'viewing' | 'spending'> & Pick<Indexer, 'getTrees'>;

// Note: setAccountEndBlock is used internally by event handlers to update account endBlock

export type ProcessLogParams = {
    log: RailgunLog;
    skipMerkleTree: boolean;
};

export type ProcessLog = HandleShieldEvent & HandleTransactEvent;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const makeProcessLog = async ({ notebooks, getTrees, viewing, spending, saveNotebooks, setAccountEndBlock }: ProcessLogContext): Promise<ProcessLog> => {
    const handleShieldEvent = await makeHandleShieldEvent({ notebooks, getTrees, viewing, spending, saveNotebooks });
    const handleTransactEvent = await makeHandleTransactEvent({ notebooks, getTrees, viewing, spending, saveNotebooks });

    return { handleShieldEvent, handleTransactEvent };
};
