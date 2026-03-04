import { Address } from "../../interfaces/types.interface";

export interface IBaseRelayerRequest {
  relayerUrl: string;
}

export interface IRelayFeesRequest extends IBaseRelayerRequest {
  chainId: bigint;
  assetAddress: Address;
}

export interface IRelayData {
  readonly recipient: string;
  readonly feeRecipient: string;
  readonly relayFeeBps: bigint;
}

export interface IRelayerFeeResponse {
  feeBPS: string;
  feeReceiverAddress: string;
  chainId: number;
  assetAddress: string;
  minWithdrawAmount: string;
  maxGasPrice: string;
}

interface TransactionCostDetail {
  /** Gas units required for the transaction. */
  gas: string;
  /** Cost in wei (ETH base units). */
  eth: string;
}

interface IQuoteDetailBreakdown {
  /** Cost breakdown for the relay transaction. */
  relayTxCost: TransactionCostDetail;
  /** Amount of extra gas funding (only when extraGas is enabled). */
  extraGasFundAmount?: TransactionCostDetail;
  /** Cost breakdown for the extra gas transaction (only when extraGas is enabled). */
  extraGasTxCost?: TransactionCostDetail;
}

interface FeeCommitment {
  /** Expiration timestamp for the quote/commitment (in milliseconds). */
  expiration: number;
  /** Encoded withdrawal data associated with the commitment (hex string). */
  withdrawalData: string;
  /** Relayer's signature committing to the fee and withdrawal data (hex string). */
  signedRelayerCommitment: string;
  /** Whether native token drop for gas fees is enabled (optional). */
  extraGas?: boolean;
}

export interface IQuoteResponse {
  /** The base fee rate charged by the relayer, in Basis Points (string representation). */
  baseFeeBPS: string;
  /** The dynamic fee rate adjusted for gas costs, in Basis Points (string representation). */
  feeBPS: string;
  /** Current gas price used for calculations (in wei). */
  gasPrice: string;
  /** The signed fee commitment from the relayer. */
  feeCommitment: FeeCommitment;
  /** Detailed breakdown of costs and gas amounts. */
  detail: IQuoteDetailBreakdown;
}

export interface IQuoteRequest extends IBaseRelayerRequest {
  /** The chain ID for the withdrawal. */
  chainId: bigint;
  /** The withdrawal amount as a string representation of a BigInt (in wei or base units). */
  amount: bigint;
  /** The address of the asset being withdrawn. */
  asset: Address;
  /** The recipient address for the withdrawal. */
  recipient: Address;
  /** Whether to include native token drop for gas fees (optional, defaults to false). */
  extraGas?: boolean;
}

export interface WithdrawalPayload {
  /** Relayer address (0xAdDrEsS) */
  processooor: `0x${string}`;
  /** Transaction data (hex encoded) */
  data: `0x${string}`;
}

interface ProofRelayerPayload {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
}

export interface IEthRelayRequest {
  /** Withdrawal details */
  withdrawal: WithdrawalPayload;
  /** Public signals as string array */
  publicSignals: string[];
  /** Proof details */
  proof: ProofRelayerPayload;
  /** Pool scope */
  scope: string;
  /** Chain ID to process the request on */
  chainId: string;
  /** The fee commitment obtained from the /quote endpoint */
  feeCommitment: IQuoteResponse['feeCommitment'];
}

export interface IRelayRequest extends IBaseRelayerRequest {
  /** Withdrawal details */
  withdrawal: WithdrawalPayload;
  /** Public signals as string array */
  publicSignals: string[];
  /** Proof details */
  proof: ProofRelayerPayload;
  /** Pool scope */
  scope: bigint;
  /** Chain ID to process the request on */
  chainId: bigint;
  /** The fee commitment obtained from the /quote endpoint */
  feeCommitment: IQuoteResponse['feeCommitment'];
}

export interface IRelayRequestBody extends Omit<IRelayRequest, 'scope' | 'chainId' | 'relayerUrl'> {
  scope: string;
  chainId: string;
}

interface IBaseRelayResponse {
  /** Timestamp of the response */
  timestamp: number;
  /** Unique request identifier (UUID) */
  requestId: string;
}


export interface ISuccessfullRelayResponse extends IBaseRelayResponse {
  success: true;
  txHash: `0x${string}`;
}

interface IFailedRelayResponse extends IBaseRelayResponse {
  success: false;
  error: string;
}

export type IRelayResponse = ISuccessfullRelayResponse | IFailedRelayResponse;

export interface IRelayerClient {
  getQuote(
    body: IQuoteRequest,
  ): Promise<IQuoteResponse>;
  relay(
    body: IRelayRequest,
  ): Promise<ISuccessfullRelayResponse>;
  getFees(
    body: IRelayFeesRequest,
  ): Promise<IRelayerFeeResponse>;
}
