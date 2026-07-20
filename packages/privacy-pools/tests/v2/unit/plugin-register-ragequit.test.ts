import type {
    INoteManager,
    PoolSession,
    PrepareRageQuitResult,
    RegisterKeystoreResult,
} from "@0xbow-io/privacy-pools-v2-sdk";
import { pad } from "viem";
import { describe, expect, it, vi } from "vitest";
import { AlreadyRegisteredError } from "../../../src/v2/interfaces/errors";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { PPv2Plugin } from "../../../src/v2/plugin";

const OWNER = "0x00000000000000000000000000000000000000aa" as const;
const KEYSTORE = "0x1111111111111111111111111111111111111111" as const;
const POOL_VAULT = "0x2222222222222222222222222222222222222222" as const;

/** Plugin over a no-op sync session with the given method overrides. */
function makePlugin(session: Partial<PoolSession>) {
    const full = {
        discoverNotes: vi.fn(async () => []),
        purgePhantomNotes: vi.fn(async () => []),
        ...session,
    } as unknown as PoolSession;
    const noteManager = { getNotes: () => [] } as unknown as INoteManager;
    const params = { chainId: 11155111n, ownerAddress: OWNER } as unknown as PPv2PluginParameters;

    return new PPv2Plugin({ session: full, noteManager, params });
}

describe("PPv2Plugin.prepareRegisterKeystore", () => {
    it("returns setAuthPolicy then setViewingKey as ordered TxData (US5 AC-1)", async () => {
        const result: RegisterKeystoreResult = {
            alreadyRegistered: false,
            keystoreCalldata: { to: KEYSTORE, data: "0xaaaa", value: "0x0" },
            viewingKeyCalldata: { to: KEYSTORE, data: "0xbbbb", value: "0x0" },
            nullifyingKeyHash: pad("0x01"),
            authDigest: pad("0x02"),
        };
        const plugin = makePlugin({
            prepareRegisterKeystore: vi.fn(async () => result),
        } as unknown as Partial<PoolSession>);

        const op = await plugin.prepareRegisterKeystore();

        expect(op.__type).toBe("publicOperation");
        expect(op.txs).toEqual([
            { to: KEYSTORE, data: "0xaaaa", value: 0n }, // setAuthPolicy first
            { to: KEYSTORE, data: "0xbbbb", value: 0n }, // then setViewingKey
        ]);
    });

    it("throws AlreadyRegistered when the account is registered (US5 AC-3)", async () => {
        const result: RegisterKeystoreResult = {
            alreadyRegistered: true,
            keystoreCalldata: null,
            viewingKeyCalldata: null,
            nullifyingKeyHash: pad("0x01"),
            authDigest: pad("0x02"),
        };
        const plugin = makePlugin({
            prepareRegisterKeystore: vi.fn(async () => result),
        } as unknown as Partial<PoolSession>);

        await expect(plugin.prepareRegisterKeystore()).rejects.toBeInstanceOf(
            AlreadyRegisteredError,
        );
    });
});

describe("PPv2Plugin.prepareRageQuit", () => {
    it("returns a PoolVault.ragequit public op for the commitment (US6 AC-1)", async () => {
        const commitment = pad("0xc0");
        const result: PrepareRageQuitResult = {
            commitment,
            value: pad("0x64"),
            tokenId: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            nullifierHash: pad("0x03"),
            recipientAddress: OWNER,
            callData: "0xdeadbeef",
            to: POOL_VAULT,
        } as unknown as PrepareRageQuitResult;
        const prepareRageQuit = vi.fn(async () => result);
        const plugin = makePlugin({ prepareRageQuit } as unknown as Partial<PoolSession>);

        const op = await plugin.prepareRageQuit(commitment);

        expect(prepareRageQuit).toHaveBeenCalledWith({ commitment });
        expect(op.__type).toBe("publicOperation");
        expect(op.txs).toEqual([{ to: POOL_VAULT, data: "0xdeadbeef", value: 0n }]);
    });

    it("works without registration (guaranteed exit, no guard)", async () => {
        const isKeystoreRegistered = vi.fn(async () => false);
        const plugin = makePlugin({
            isKeystoreRegistered,
            prepareRageQuit: vi.fn(async () => ({
                commitment: pad("0xc0"),
                value: pad("0x64"),
                tokenId: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
                nullifierHash: pad("0x03"),
                recipientAddress: OWNER,
                callData: "0x",
                to: POOL_VAULT,
            })),
        } as unknown as Partial<PoolSession>);

        await expect(plugin.prepareRageQuit(pad("0xc0"))).resolves.toBeDefined();
        expect(isKeystoreRegistered).not.toHaveBeenCalled();
    });
});
