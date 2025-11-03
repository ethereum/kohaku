import { RailgunNetworkConfig, ZERO_ADDRESS, ZERO_ARRAY } from "~/config";
import { createTx, TxData } from "./base";
import { Address } from "viem";
import { transact, PublicInputs } from '~/railgun/logic/logic/transaction';
import { ABIRailgunSmartWallet, ABIRelayAdapt } from "~/railgun/lib/abi/abi";
import { Interface } from "ethers";
import { ByteUtils } from "~/railgun/lib/utils";
import { GetNotes } from "../actions/notes";
import { getAdaptParamsHash } from "~/utils/account/adapt";
import { Indexer } from "~/indexer/base";

export type CreateUnshieldTxFn = (token: Address, value: bigint, receiver: Address, minGasPrice?: bigint) => Promise<TxData>;
export type CreateUnshieldNativeTxFn = (value: bigint, receiver: string, minGasPrice?: bigint) => Promise<TxData>;
export type CreateUnshield = { unshield: CreateUnshieldTxFn, unshieldNative: CreateUnshieldNativeTxFn };

export type CreateUnshieldContext = {
    network: RailgunNetworkConfig;
} & Pick<Indexer, 'getTrees'> & Pick<GetNotes, 'getTransactNotes'>;

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);
const RELAY_ADAPT_INTERFACE = new Interface(ABIRelayAdapt);

export const makeCreateUnshield = async ({ network, getTrees, getTransactNotes }: CreateUnshieldContext): Promise<CreateUnshield> => {
    const unshield: CreateUnshieldTxFn = async (token, value, receiver, minGasPrice = BigInt(0)) => {
        const { notesIn, notesOut } = await getTransactNotes(token, value, receiver);
        const allInputs: PublicInputs[] = [];

        for (let i = 0; i < notesIn.length; i++) {
            if (notesIn[i]!.length === 0) { continue; }

            const inputs = await transact(
                getTrees()[i]!,
                minGasPrice,
                1, // unshield type
                network.CHAIN_ID,
                ZERO_ADDRESS, // adapt contract
                ZERO_ARRAY, // adapt params
                notesIn[i]!,
                notesOut[i]!,
            );

            allInputs.push(inputs);
        }
        const data = RAILGUN_INTERFACE.encodeFunctionData('transact', [allInputs]);

        return createTx(network.RAILGUN_ADDRESS, data);
    };

    const unshieldNative: CreateUnshieldNativeTxFn = async (value, receiver, minGasPrice = BigInt(0)) => {
        const { notesIn, notesOut, nullifiers } = await getTransactNotes(network.WETH, value, network.RELAY_ADAPT_ADDRESS, true);
        const unwrapTxData = createTx(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('unwrapBase', [0]));
        const ethTransfer = [{ token: { tokenType: 0, tokenAddress: ZERO_ADDRESS, tokenSubID: 0n }, to: receiver, value: 0n }];
        const transferTxData = createTx(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('transfer', [ethTransfer]));
        const actionData = {
            random: "0x" + ByteUtils.randomHex(31),
            requireSuccess: true,
            minGasLimit: minGasPrice,
            calls: [unwrapTxData, transferTxData],
        }
        const nonEmptyNullifiers = nullifiers.filter(arr => arr.length > 0);
        const nullifiers2D: string[][] = nonEmptyNullifiers.map(
            arr => arr.map(n => ByteUtils.hexlify(n, true))
        );
        const relayAdaptParams = getAdaptParamsHash(nullifiers2D, actionData);
        const allInputs: PublicInputs[] = [];

        for (let i = 0; i < notesIn.length; i++) {
            if (notesIn[i]!.length === 0) { continue; }

            const inputs = await transact(
                getTrees()[i]!,
                minGasPrice,
                1, // unshield type
                network.CHAIN_ID,
                network.RELAY_ADAPT_ADDRESS,
                relayAdaptParams,
                notesIn[i]!,
                notesOut[i]!,
            );

            allInputs.push(inputs);
        }
        const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('relay', [allInputs, actionData]);

        return createTx(network.RELAY_ADAPT_ADDRESS, data);
    };

    return {
        unshield,
        unshieldNative,
    };
};
