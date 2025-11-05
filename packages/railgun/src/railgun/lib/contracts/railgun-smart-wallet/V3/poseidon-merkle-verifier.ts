import { Contract, ContractTransaction, FallbackProvider } from "ethers";
import { PollingJsonRpcProvider } from "../../../provider/polling-json-rpc-provider";
import { PoseidonMerkleVerifier } from "../../../abi/typechain/PoseidonMerkleVerifier";
import { ABIPoseidonMerkleVerifier } from "../../../abi/abi";
import { ShieldCiphertextStruct } from "../../../abi/typechain/RailgunSmartWallet";

export class PoseidonMerkleVerifierContract {
  readonly contract: PoseidonMerkleVerifier;

  readonly address: string;

  constructor(
    address: string,
    provider: PollingJsonRpcProvider | FallbackProvider
  ) {
    this.address = address;
    this.contract = new Contract(
      address,
      ABIPoseidonMerkleVerifier,
      provider
    ) as unknown as PoseidonMerkleVerifier;
  }

  generateExecute(
    transactions: PoseidonMerkleVerifier.TransactionStruct[],
    shields: PoseidonMerkleVerifier.ShieldRequestStruct[],
    globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct,
    unshieldChangeCiphertext: ShieldCiphertextStruct
  ): Promise<ContractTransaction> {
    return this.contract.execute.populateTransaction(
      transactions,
      shields,
      globalBoundParams,
      unshieldChangeCiphertext
    );
  }
}
