import { Interface } from "ethers";
import { match } from "ts-pattern";
import { ABIRailgunSmartWallet } from "~/railgun/lib/abi/abi";
import { makeHandleShieldEvent, ShieldEvent } from "./shield";
import { makeHandleNullifiedEvent, NullifiedEvent } from "./nullified";
import { makeHandleTransactEvent, TransactEvent } from "./transact";
import { DerivedKeys } from "../keys";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { Notebook } from "~/utils/notebook";
import { RailgunLog } from "~/provider";

export type ProcessLogContext = {
    notebooks: Notebook[];
    trees: MerkleTree[];
} & Pick<DerivedKeys, 'viewing' | 'spending'>;

export type ProcessLogParams = {
    log: RailgunLog;
    skipMerkleTree: boolean;
};

export type ProcessLogFn = (params: ProcessLogParams) => Promise<void>;
export type ProcessLog = { processLog: ProcessLogFn };

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);

export type RailgunLogEvent = { name: 'Shield', args: ShieldEvent } | { name: 'Transact', args: TransactEvent } | { name: 'Nullified', args: NullifiedEvent };

export const makeProcessLog = async ({ notebooks, trees, viewing, spending }: ProcessLogContext): Promise<ProcessLogFn> => {
    const handleShieldEvent = await makeHandleShieldEvent({ notebooks, trees, viewing, spending });
    const handleTransactEvent = await makeHandleTransactEvent({ notebooks, trees, viewing, spending });
    const handleNullifiedEvent = await makeHandleNullifiedEvent({ notebooks, trees });

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
