import { Host } from '@kohaku-eth/plugins';
import { groth16 } from 'snarkjs';
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
  proof: `0x${string}`;  // 256-byte packed groth16 for Solidity
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

// Pack proof for Solidity verifier: pi_a[0,1], pi_b[0][1,0], pi_b[1][1,0], pi_c[0,1]
// pi_b inner arrays are reversed per EVM convention (G2 point encoding)
function packProof(proof: Awaited<ReturnType<typeof groth16.fullProve>>['proof']): `0x${string}` {
  const elements = [
    proof.pi_a[0], proof.pi_a[1],
    proof.pi_b[0]![1], proof.pi_b[0]![0],
    proof.pi_b[1]![1], proof.pi_b[1]![0],
    proof.pi_c[0], proof.pi_c[1],
  ] as string[];

  return ('0x' + elements.map(e => BigInt(e).toString(16).padStart(64, '0')).join('')) as `0x${string}`;
}


export async function downloadArtifactsAndCreateProver(
  { network: { fetch } }: Host,
  wasmUrl: string,
  zkeyUrl: string,
): Promise<ITornadoProver> {
  const [wasmResponse, zkeyResponse] = await Promise.all([
    fetch(wasmUrl),
    fetch(zkeyUrl),
  ]);

  const [wasmBuffer, zkeyBuffer] = await Promise.all([
    wasmResponse.arrayBuffer(),
    zkeyResponse.arrayBuffer(),
  ]);

  return createTornadoProver(new Uint8Array(wasmBuffer), new Uint8Array(zkeyBuffer));
}

export function createTornadoProver(
  wasm: Uint8Array,
  zkey: Uint8Array,
): ITornadoProver {
  return {
    async prove(inputs: TornadoWithdrawInputs): Promise<TornadoProveOutput> {
      const { proof, publicSignals } = await groth16.fullProve(
        {
          nullifier: inputs.nullifier.toString(),
          secret: inputs.secret.toString(),
          pathElements: inputs.pathElements.map(String),
          pathIndices: inputs.pathIndices,
          root: inputs.root.toString(),
          nullifierHash: inputs.nullifierHash.toString(),
          recipient: inputs.recipient.toString(),
          relayer: inputs.relayer.toString(),
          fee: inputs.fee.toString(),
          refund: inputs.refund.toString(),
        },
        wasm,
        zkey,
      );

      return {
        proof: packProof(proof),
        args: [
          toHex(BigInt(publicSignals[0]!), { size: 32 }), // root
          toHex(BigInt(publicSignals[1]!), { size: 32 }), // nullifierHash
          toHex(BigInt(publicSignals[2]!), { size: 20 }), // recipient
          toHex(BigInt(publicSignals[3]!), { size: 20 }), // relayer
          toHex(BigInt(publicSignals[4]!), { size: 32 }), // fee
          toHex(BigInt(publicSignals[5]!), { size: 32 }), // refund
        ],
      };
    },
  };
}
