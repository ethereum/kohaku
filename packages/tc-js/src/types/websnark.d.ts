declare module "@tornado/websnark/src/groth16" {
    export default function buildGroth16(): Promise<Groth16>;

    export interface Groth16 {
        proof(
            signals: Uint8Array,
            provingKey: ArrayBuffer
        ): Promise<{
            pi_a: [string, string];
            pi_b: [[string, string], [string, string]];
            pi_c: [string, string];
        }>;
    }
}

declare module "@tornado/websnark/src/utils" {
    export function genWitnessAndProve(
        groth16: any,
        input: Record<string, bigint | bigint[]>,
        circuit: any,
        provingKey: ArrayBuffer
    ): Promise<{
        pi_a: [string, string];
        pi_b: [[string, string], [string, string]];
        pi_c: [string, string];
        publicSignals: string[];
    }>;
}