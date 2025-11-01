import { Address } from "viem";
import { E_ADDRESS, RailgunNetworkConfig, ZERO_ADDRESS } from "~/config";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { getERC20TokenData } from "~/utils/account/token";
import { Notebook } from "~/utils/notebook";

export type GetBalanceFn = (token?: Address) => Promise<bigint>;
export type GetBalance = { getBalance: GetBalanceFn };

export type GetBalanceFnParams = {
    notebooks: Notebook[];
    trees: MerkleTree[];
    network: RailgunNetworkConfig;
};

export const makeGetBalance = ({ notebooks, trees, network }: GetBalanceFnParams): GetBalanceFn => async (token: Address = ZERO_ADDRESS) => {
    const fixedToken = token === ZERO_ADDRESS || token === E_ADDRESS ? network.WETH : token;
    const tokenData = getERC20TokenData(fixedToken);
    let totalBalance = 0n;

    for (let i = 0; i < trees.length; i++) {
        const balance = await notebooks[i]!.getBalance(trees[i]!, tokenData);

        totalBalance += balance;
    }

    return totalBalance;
};
