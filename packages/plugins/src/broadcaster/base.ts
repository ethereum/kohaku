/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrivateOperation } from "~/shared";

export type Broadcaster<
    TParameters extends Record<string, unknown>,
    TPrivateOperation extends PrivateOperation = PrivateOperation,
> = {
    /**
     * Broadcasts the specified private operation. Broadcasting an operation may
     * involve signing messages, submitting transactions to the blockchain, or
     * interacting with external services.
     * @param operation The operation to be broadcasted.
     * 
     * @throws {Error} If the operation could not be broadcasted.
     */
    broadcast: (operation: TPrivateOperation) => Promise<void>;
};

export type BroadcasterParameters<T> = T extends Broadcaster<infer TParameters, any> ? TParameters : never;
