// eslint-disable-next-line @typescript-eslint/no-require-imports
const buildGroth16 = require('websnark/src/groth16');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const websnarkUtils = require('websnark/src/utils');

import { toHex } from 'viem';

export interface TornadoWithdrawInputs {
  nullifier: bigint;
  secret: bigint;
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
  nullifierHash: bigint;
  recipient: bigint; // address as bigint
  relayer: bigint;   // address as bigint
  fee: bigint;
  refund: bigint;
}

export interface TornadoProveOutput {
  proof: `0x${string}`;  // packed groth16 for Solidity
  args: [
    `0x${string}`, // root
    `0x${string}`, // nullifierHash
    `0x${string}`, // recipient
    `0x${string}`, // relayer
    `0x${string}`, // fee
    `0x${string}`, // refund
  ];
}

export interface ITornadoProver {
  prove(inputs: TornadoWithdrawInputs): Promise<TornadoProveOutput>;
}

let _groth16: unknown = null;

async function getGroth16() {
  if (!_groth16) {
    _groth16 = await buildGroth16({ wasmInitialMemory: 2000 });
  }

  return _groth16;
}

export async function createTornadoProver(
  circuit: object,
  provingKey: ArrayBuffer,
): Promise<ITornadoProver> {
  return {
    async prove(inputs: TornadoWithdrawInputs): Promise<TornadoProveOutput> {
      const groth16Instance = await getGroth16();

      try {
        const proofData = await websnarkUtils.genWitnessAndProve(
          groth16Instance,
          inputs,
          circuit,
          provingKey,
        );
        const { proof } = websnarkUtils.toSolidityInput(proofData);
  
        return {
          proof: proof as `0x${string}`,
          args: [
            toHex(inputs.root, { size: 32 }),
            toHex(inputs.nullifierHash, { size: 32 }),
            toHex(inputs.recipient, { size: 20 }),
            toHex(inputs.relayer, { size: 20 }),
            toHex(inputs.fee, { size: 32 }),
            toHex(inputs.refund, { size: 32 }),
          ],
        };
      } catch (error) {
        console.log(error)
        throw error;
      }

    },
  };
}
