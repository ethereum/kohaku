import { createAsyncThunk } from '@reduxjs/toolkit';
import { TxData } from '@kohaku-eth/provider';
import { ISecretManager } from '../../account/keys';
import { prepareErc20Shield, prepareNativeShield } from '../../account/tx/shield';
import { Address } from '../../interfaces/types.interface';
import { addressToHex } from '../../utils';
import { RootState } from '../store';
import { activePoolsSelector, instanceRegistryInfoSelector, signatureNextNonceSelector, signatureUserSecretsSelector } from '../selectors/slices.selectors';
import { reserveSignatureNonces } from '../slices/signatureNoncesSlice';
import { IPool } from '../../data/interfaces/events.interface';
import { catalogInstanceFor, instanceCatalog, ITornadoInstance } from '../../instances';

export enum DepositStrategy {
  MaxAnonimitySet,
  MinFee
}

export interface GetDepositPayloadThunkParams {
  secretManager: ISecretManager;
  asset: Address;
  amount: bigint;
  strategy: DepositStrategy;
  /** Overrides the built-in instance catalog for this chain. */
  instances?: readonly ITornadoInstance[];
}

interface PoolWithDeposits extends IPool {
  depositsCount: number;
}

const calculatePoolsDeposits = (
  pools: IPool[],
  value: bigint,
  strategy: DepositStrategy,
): PoolWithDeposits[] => {
  if (!pools.length) {
    throw new Error('No pools to deposit into');
  }

  const poolsToDepositInto: PoolWithDeposits[] = [];

  switch (strategy) {
    case DepositStrategy.MaxAnonimitySet: {
      // Smallest denomination is only a stand-in for the largest anonymity set
      // among the classic pools. The extended denominations start empty, so
      // they stay out of this strategy.
      const classicPools = pools.filter((pool) => !pool.extended);
      const candidates = classicPools.length > 0 ? classicPools : pools;
      const lowToHighDenominationPools = [...candidates].sort((a, b) => Number(a.denomination - b.denomination));
      const lowestDenominationPool = lowToHighDenominationPools[0]!;
      
      const depositsCount = Number(value / lowestDenominationPool.denomination);

      poolsToDepositInto.push({
        ...lowestDenominationPool,
        depositsCount,
      });
      break;
    }
    case DepositStrategy.MinFee: {
      const highToLowDenominationPools = pools.sort((a, b) => Number(b.denomination - a.denomination));

      highToLowDenominationPools.reduce((remainingAmount, pool) => {
        const depositsForThisPool = remainingAmount / pool.denomination;

        if (depositsForThisPool > 0n) {
          poolsToDepositInto.push({
            ...pool,
            depositsCount: Number(depositsForThisPool)
          })
        }

        return remainingAmount - (depositsForThisPool * pool.denomination);
      }, value);
      break;
    }
  }

  return poolsToDepositInto;
}

export const getDepositPayloadThunk = createAsyncThunk<
  TxData[],
  GetDepositPayloadThunkParams,
  { state: RootState }
>(
  'deposits/getPayload',
  async ({ secretManager, asset, amount, strategy, instances }, { getState, dispatch }) => {
    const state = getState();
    const pools = activePoolsSelector(state);
    const { chainId } = instanceRegistryInfoSelector(state);
    const catalog = instanceCatalog(chainId, instances);

    if (!catalog) {
      throw new Error(`No Tornado instance catalog for chain ${chainId}. Pass protocolConfig.instances to allow deposits.`);
    }

    const signatureSecrets = signatureUserSecretsSelector(state);
    // Start after every nonce already handed out, mined or not, so an earlier
    // payload that is still pending never shares a commitment with this one.
    let nonce = signatureNextNonceSelector(state);

    for (const records of signatureSecrets.values()) {
      for (const record of records) {
        if (record.nonce >= nonce) nonce = record.nonce + 1;
      }
    }

    // Synced pools come from the RPC; only catalog instances are deposit targets.
    const poolsCandidates = Array.from(pools.values())
      .filter((p) => p.asset === asset && catalogInstanceFor(catalog, p));
    
    if (poolsCandidates.length === 0) throw new Error(`No pools available for asset ${addressToHex(asset)}`);

    const poolsToDepositInto = calculatePoolsDeposits(poolsCandidates, amount, strategy);
    const totalNotes = poolsToDepositInto.reduce((total, pool) => total + pool.depositsCount, 0);

    if (!Number.isSafeInteger(totalNotes) || totalNotes > 1000) {
      throw new Error('Deposit preparation is limited to 1000 notes; split the amount into smaller requests');
    }

    const nonceAssignments = poolsToDepositInto.map((pool) => {
      const startNonce = nonce;

      nonce += pool.depositsCount;

      return { pool, startNonce };
    });

    const depositInfo = await Promise.all(nonceAssignments.map(async ({ pool, startNonce }) => {
      const secrets = await Promise.all(
        Array.from({ length: pool.depositsCount }, (_, i) =>
          secretManager.getSignatureSecrets({
            chainId,
            nonce: startNonce + i,
            poolAddress: pool.address,
          }),
        ),
      );

      return {
        ...pool,
        secrets,
      }
    }));

    const newDeposits = depositInfo.reduce((txData, {secrets, ...pool}) => {
      const poolAddressHex = addressToHex(pool.address);
  
      if (!pool.isERC20) {
        const newDeposits = secrets.map(({ commitment }) =>
          prepareNativeShield({
            commitment,
            poolAddress: poolAddressHex,
            poolDenomination: pool.denomination,
          }),
        );

        return txData.concat(newDeposits);
      }

      const assetHex = addressToHex(pool.asset);
  
      const newDeposits = secrets.flatMap(({ commitment }) =>
        prepareErc20Shield({
          commitment,
          tokenAddress: assetHex,
          poolAddress: poolAddressHex,
          denomination: pool.denomination,
        }),
      );

      return txData.concat(newDeposits)
    }, [] as TxData[])

    // The caller may submit any subset of these, in any order; discovery scans
    // up to this mark so whichever ones are mined are found.
    dispatch(reserveSignatureNonces(nonce));

    return newDeposits;
  },
);
