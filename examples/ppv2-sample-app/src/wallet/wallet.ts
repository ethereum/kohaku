/**
 * WALLET SIDE — the transacting account and public-operation submission path.
 *
 * The PPv2 plugin never signs or sends anything (INV-1): every public verb
 * (`prepareRegisterKeystore`, `prepareShield`, `prepareRageQuit`) returns plain
 * `TxData[]` for the wallet to sign and broadcast from its own account. In the
 * extension that is the user-approved signer flow; here it is a tiny wrapper
 * over an injected submitter so the demo can mine transactions in-process.
 *
 * IMPORTANT: public operations MUST be sent from `ownerAddress` — the
 * registration and ragequit calls bind to `msg.sender` (DEP-6).
 */
import type { Keystore } from "@kohaku-eth/plugins";
import type { TxData } from "@kohaku-eth/provider";
import type { PPv2PublicOperation } from "@kohaku-eth/privacy-pools";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/** Standard first external account of the wallet's seed phrase. */
const TRANSACTING_ACCOUNT_PATH = "m/44'/60'/0'/0/0";

/** Where signed transactions go: a real signer+RPC in production, the devnet here. */
export type TransactionSubmitter = {
    sendTransaction(tx: TxData & { from: Address }): Promise<Hex>;
};

export class SampleWallet {
    private constructor(
        readonly ownerAddress: Address,
        private readonly submitter: TransactionSubmitter,
    ) {}

    /** Derive the wallet's transacting account from the same keystore the plugin uses. */
    static async create(keystore: Keystore, submitter: TransactionSubmitter): Promise<SampleWallet> {
        const privateKey = await keystore.deriveAt(TRANSACTING_ACCOUNT_PATH);
        const account = privateKeyToAccount(privateKey);

        return new SampleWallet(account.address, submitter);
    }

    /**
     * Sign and broadcast a plugin-prepared public operation, in order (an ERC20
     * shield is `[approve, deposit]` — order matters). Returns the tx hashes.
     */
    async sendPublicOperation(operation: PPv2PublicOperation): Promise<Hex[]> {
        const hashes: Hex[] = [];

        for (const tx of operation.txs) {
            hashes.push(
                await this.submitter.sendTransaction({ ...tx, from: this.ownerAddress }),
            );
        }

        return hashes;
    }
}
