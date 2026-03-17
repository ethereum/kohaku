import { PrivateOperation } from "~/shared";

export type Broadcaster<
    TPrivateOperation extends PrivateOperation = PrivateOperation,
    TPrivateOperationResult = void
> = {
    /**
     * Broadcasts the specified private operation. Broadcasting an operation may
     * involve signing messages, submitting transactions to the blockchain, or
     * interacting with external services.
     * @param operation The operation to be broadcasted.
     * 
     * @throws {Error} If the operation could not be broadcasted.
     */
    broadcast: (operation: TPrivateOperation) => Promise<TPrivateOperationResult>;
};
