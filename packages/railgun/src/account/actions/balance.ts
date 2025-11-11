import { Address } from "viem";
import { E_ADDRESS, RailgunNetworkConfig, ZERO_ADDRESS } from "~/config";
import { Indexer } from "~/indexer/base";
import { getERC20TokenData } from "~/utils/account/token";
import { Notebook } from "~/utils/notebook";

export type GetBalanceFn = (token?: Address) => Promise<bigint>;
export type GetBalance = { getBalance: GetBalanceFn };

export type GetBalanceFnParams = {
    notebooks: Notebook[];
    network: RailgunNetworkConfig;
} & Pick<Indexer, 'getTrees'>;

export const makeGetBalance = ({ notebooks, getTrees, network }: GetBalanceFnParams): GetBalanceFn => async (token: Address = ZERO_ADDRESS) => {
    const fixedToken = token === ZERO_ADDRESS || token.toLowerCase() === E_ADDRESS ? network.WETH : token;
    const tokenData = getERC20TokenData(fixedToken);
    let totalBalance = 0n;

    for (let i = 0; i < getTrees().length; i++) {
        if (!notebooks[i]) {
            notebooks[i] = new Notebook();
        }

        const balance = await notebooks[i]!.getBalance(getTrees()[i]!, tokenData);

        totalBalance += balance;
    }

    return totalBalance;
};
