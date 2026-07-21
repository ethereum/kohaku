/**
 * DEVNET SIDE — the orchestrator tying chain + services together.
 *
 * It implements the wallet's `TransactionSubmitter`: when the demo wallet
 * "signs and broadcasts" a plugin-prepared transaction, the devnet mines it
 * and emits the events the real contracts would have emitted (registration
 * events for `setAuthPolicy`, an encrypted note + state leaf for a deposit),
 * then the ASP approves the deposit's label — so the plugin's chain-driven
 * sync discovers everything exactly as it would on Sepolia.
 *
 * One approximation: the devnet cannot recover the exact note secrets from
 * the deposit calldata (they never leave the SDK), so it mints an equivalent
 * fresh note of the same value to the same owner. On the real chain the
 * Entrypoint emits the precise note the plugin prepared.
 */
import type { Keystore } from "@kohaku-eth/plugins";
import type { PPv2Factories } from "@kohaku-eth/privacy-pools";
import type { TxData } from "@kohaku-eth/provider";
import type { EthereumProvider } from "@kohaku-eth/provider";
import { DEPLOYMENTS } from "@0xbow-io/privacy-pools-v2-sdk";
import type { Address, Hex } from "viem";
import { DevnetChain } from "./chain";
import { mintDeposit, mintRegistration } from "./minting";
import {
    createDevnetAsp,
    createDevnetEntrypoint,
    createDevnetProofService,
    createDevnetRelayer,
    DEVNET_ENTRYPOINT,
    type DevnetAsp,
} from "./services";

/** The canonical native-asset token id used by the protocol. */
const NATIVE_TOKEN_ID = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;

export class Devnet {
    readonly chain: DevnetChain;
    readonly asp: DevnetAsp;
    /**
     * The keystore contract the session reads/writes registration through.
     * With an entrypoint factory injected, the plugin drops `params.deployment`
     * and falls back to the SDK's `DEPLOYMENTS` map — so the devnet must serve
     * that same address.
     */
    private readonly keystoreAddress: string;
    private registrationMined = false;
    private stateLeafCount = 0n;

    constructor(private readonly accounts: { keystore: Keystore; ownerAddress: Address }) {
        const keystoreAddress = DEPLOYMENTS[11155111]?.keystoreAddress;

        if (!keystoreAddress) throw new Error("SDK DEPLOYMENTS has no Sepolia entry");

        this.keystoreAddress = keystoreAddress.toLowerCase();
        this.chain = new DevnetChain({ keystoreAddress });
        this.asp = createDevnetAsp();
    }

    /** The Host-facing chain view. */
    provider(): EthereumProvider {
        return this.chain.provider();
    }

    /** The plugin factory seams replacing the real off-chain services. */
    factories(): PPv2Factories {
        return {
            aspClient: this.asp,
            aspDataProvider: this.asp,
            relayerInteractor: createDevnetRelayer(this.chain, { feeAmount: 5n }),
            proofService: createDevnetProofService(),
            entrypointInteractor: createDevnetEntrypoint(),
        };
    }

    /**
     * `TransactionSubmitter` — mine a wallet-signed transaction and emit the
     * contract events it would produce on the real chain.
     */
    async sendTransaction(tx: TxData & { from: Address }): Promise<Hex> {
        const minedAt = this.chain.mineTransaction();
        const to = tx.to.toLowerCase();

        if (to === this.keystoreAddress && !this.registrationMined) {
            // First keystore call is `setAuthPolicy` (the follow-up is
            // `setViewingKey`, which emits nothing the demo consumes).
            await mintRegistration({
                chain: this.chain,
                keystore: this.accounts.keystore,
                ownerAddress: this.accounts.ownerAddress,
                minedAt,
            });
            this.registrationMined = true;
        } else if (to === DEVNET_ENTRYPOINT.toLowerCase()) {
            // A native deposit: the deposited value rides in `msg.value`
            // (zero vetting fee on the devnet).
            const minted = await mintDeposit({
                chain: this.chain,
                keystore: this.accounts.keystore,
                ownerAddress: this.accounts.ownerAddress,
                tokenId: NATIVE_TOKEN_ID,
                value: tx.value,
                stateLeafIndex: this.stateLeafCount++,
                minedAt,
            });

            // The devnet ASP vets and approves the fresh deposit right away.
            this.asp.approveLabel(minted.labelHash);
        }

        return minedAt.txHash;
    }
}
