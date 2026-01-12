import { RailgunNetworkConfig, ZERO_ADDRESS, ZERO_ARRAY } from "~/config";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { Address } from "viem";
import { createTx, TxData } from "@kohaku-eth/provider";
import { RailgunAddress } from "../actions/address";
import { PublicInputs, transact } from "~/railgun/logic/logic/transaction";
import { ABIRailgunSmartWallet } from "~/railgun/lib/abi/abi";
import { Interface } from "ethers";
import { GetNotes } from "../actions/notes";

export type CreateTransferTxFn = (token: Address, value: bigint, receiver: RailgunAddress, minGasPrice?: bigint) => Promise<TxData>;
export type CreateTransfer = { transfer: CreateTransferTxFn };

export type CreateTransferContext = {
    network: RailgunNetworkConfig;
    getTrees: () => MerkleTree[];
} & Pick<GetNotes, 'getTransactNotes'>;

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);

export const makeCreateTransfer = async ({ network, getTrees, getTransactNotes }: CreateTransferContext): Promise<CreateTransfer> => {
    const transfer: CreateTransferTxFn = async (token, value, receiver, minGasPrice = BigInt(0)) => {
        console.log('tree ', getTrees().length);

        if (!receiver.startsWith("0zk")) {
            throw new Error('receiver must be a railgun 0zk address');
        }

        console.log('transferring ', value, ' of ', token, ' to ', receiver);

        const { notesIn, notesOut } = await getTransactNotes(token, value, receiver);
        const allInputs: PublicInputs[] = [];

        // const formatBigInt =  (_, v) => typeof v === 'bigint' ? v.toString() : v;

        console.log('notesIn: ', notesIn);
        // console.log('notesIn: ', JSON.stringify(notesIn, formatBigInt, 2));
        console.log('notesOut: ', notesOut);
        // console.log('notesOut: ', JSON.stringify(notesOut, formatBigInt, 2));

        for (let i = 0; i < notesIn.length; i++) {
            if (notesIn[i]!.length === 0) { continue; }

            console.log('transacting ', notesIn[i]!.length, ' notes in tree ', i);

            const inputs = await transact(
                getTrees()[i]!,
                minGasPrice,
                0, // no unshield
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

    console.log('transfer function created');

    return { transfer };
};
