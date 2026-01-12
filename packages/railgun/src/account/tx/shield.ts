import { E_ADDRESS, RailgunNetworkConfig, ZERO_ADDRESS } from "~/config";
import { createTx, TxData } from "@kohaku-eth/provider";
import { ABIRailgunSmartWallet, ABIRelayAdapt } from "~/railgun/lib/abi/abi";
import { Interface } from "ethers";
import { Address } from "viem";
import { ShieldRequestStruct } from '~/railgun/lib/abi/typechain/RailgunSmartWallet';
import { ByteUtils } from "~/railgun/lib/utils";
import { ShieldNoteERC20 } from "~/railgun/lib/note";
import { DerivedKeys } from "../keys";
import { keccak256 } from 'ethereum-cryptography/keccak';

export type CreateShieldTxFn = (token: Address, value: bigint) => Promise<TxData>;
export type CreateShieldNativeTxFn = (value: bigint) => Promise<TxData>;
export type CreateShieldMultiTxFn = (tokens: Address[], values: bigint[]) => Promise<TxData>;
export type CreateShield = { shield: CreateShieldTxFn, shieldNative: CreateShieldNativeTxFn, shieldMulti: CreateShieldMultiTxFn };

export type CreateShieldContext = {
    network: RailgunNetworkConfig;
} & Pick<DerivedKeys, 'master' | 'viewing' | 'signer'>;

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);
const RELAY_ADAPT_INTERFACE = new Interface(ABIRelayAdapt);

export const makeCreateShield = async ({ network, master, viewing, signer }: CreateShieldContext): Promise<CreateShield> => {
    const getShieldPrivateKey = async (): Promise<Uint8Array> => {

        if (!signer) {
            throw new Error('shield key eth signer not set');
        }

        const msg = ShieldNoteERC20.getShieldPrivateKeySignatureMessage();
        const signature = await signer.signMessage(msg);
        const signatureBytes = ByteUtils.hexStringToBytes(signature);

        return keccak256(signatureBytes);
    };

    const buildShieldNote = async (token: Address, value: bigint): Promise<ShieldNoteERC20> => {
        return new ShieldNoteERC20(master, ByteUtils.randomHex(16), value, token);
    };

    const encodeShieldNote = async (shieldNote: ShieldNoteERC20): Promise<ShieldRequestStruct> => {
        const shieldPrivateKey = await getShieldPrivateKey();
        const { pubkey: viewingPubkey } = await viewing.getViewingKeyPair();

        return shieldNote.serialize(shieldPrivateKey, viewingPubkey);
    };

    const createShieldRequest = async (token: Address, value: bigint): Promise<ShieldRequestStruct> => {
        const shieldNote = await buildShieldNote(token, value);
        const request = await encodeShieldNote(shieldNote);

        return request;
    };

    const shield: CreateShieldTxFn = async (token, value) => {
        const request = await createShieldRequest(token, value);
        const data = RAILGUN_INTERFACE.encodeFunctionData('shield', [[request]]);

        return createTx(network.RAILGUN_ADDRESS, data);
    };

    const shieldNative: CreateShieldNativeTxFn = async (value) => {
        const request = await createShieldRequest(network.WETH, value);
        const wrapTxData = createTx(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('wrapBase', [value]));
        const shieldTxData = createTx(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('shield', [[request]]));
        const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('multicall', [true, [wrapTxData, shieldTxData]]);

        return createTx(network.RELAY_ADAPT_ADDRESS, data, value);
    };

    const shieldMulti: CreateShieldMultiTxFn = async (tokens, values) => {
        if (tokens.length !== values.length) {
            throw new Error('tokens and values must have the same length');
        }

        let nativeValue = 0n;
        const requests: ShieldRequestStruct[] = [];

        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i] === ZERO_ADDRESS || tokens[i]?.toLowerCase() === E_ADDRESS) {
                nativeValue += values[i]!;
                requests.push(await createShieldRequest(network.WETH, values[i]!));
            } else {
                requests.push(await createShieldRequest(tokens[i]!, values[i]!));
            }
        }

        if (nativeValue == 0n) {
            const data = RAILGUN_INTERFACE.encodeFunctionData('shield', [requests]);

            return createTx(network.RAILGUN_ADDRESS, data);
        }

        const wrapTxData = createTx(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('wrapBase', [nativeValue]));
        const shieldTxData = createTx(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('shield', [requests]));
        const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('multicall', [true, [wrapTxData, shieldTxData]]);

        return createTx(network.RELAY_ADAPT_ADDRESS, data, nativeValue);
    };

    return {
        shield,
        shieldNative,
        shieldMulti,
    };
};
