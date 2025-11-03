import { Interface } from "ethers";
import { match } from "ts-pattern";
import { ABIRailgunSmartWallet } from "~/railgun/lib/abi/abi";
import { makeHandleShieldEvent, ShieldEvent } from "./shield";
import { makeHandleNullifiedEvent, NullifiedEvent } from "./nullified";
import { makeHandleTransactEvent, TransactEvent } from "./transact";
import { RailgunLog } from "~/provider";
import { Indexer } from "~/indexer/base";

export type ProcessLogContext = Pick<Indexer, 'getTrees' | 'accounts'>;

export type ProcessLogParams = {
    log: RailgunLog;
    skipMerkleTree: boolean;
};

export type ProcessLogFn = (params: ProcessLogParams) => Promise<void>;
export type ProcessLog = { processLog: ProcessLogFn };

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);

export type RailgunLogEvent = { name: 'Shield', args: ShieldEvent } | { name: 'Transact', args: TransactEvent } | { name: 'Nullified', args: NullifiedEvent };

export const makeProcessLog = async ({ getTrees, accounts }: ProcessLogContext): Promise<ProcessLogFn> => {
    const handleShieldEvent = await makeHandleShieldEvent({ getTrees, accounts });
    const handleTransactEvent = await makeHandleTransactEvent({ getTrees, accounts });
    const handleNullifiedEvent = await makeHandleNullifiedEvent({ getTrees });

    return async ({ log, skipMerkleTree = false }) => {
        // KASS TODO: also scan legacy events !!!
        // Parse log
        const parsedLog = RAILGUN_INTERFACE.parseLog(log);

        if (!parsedLog) return;

        const event = parsedLog as unknown as RailgunLogEvent;

        await match(event)
            .with({ name: 'Shield' }, (event) => handleShieldEvent(event.args, skipMerkleTree))
            .with({ name: 'Transact' }, (event) => handleTransactEvent(event.args, skipMerkleTree))
            .with({ name: 'Nullified' }, (event) => handleNullifiedEvent(event.args, skipMerkleTree))
            .otherwise(() => {
                // throw new Error(`Unknown event: ${parsedLog.name}`);
                console.warn(`Unknown event: ${parsedLog.name}`);
            });
    };
};
