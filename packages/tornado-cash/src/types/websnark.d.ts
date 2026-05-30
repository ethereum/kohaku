type Groth16Instance = unknown;

declare module 'websnark/src/groth16' {
    function buildGroth16(params: {wasmInitialMemory: number}): Promise<Groth16Instance>;
}

declare module 'websnark/src/utils' {
    function genWitnessAndProve(instance: Groth16Instance, inputs: unknown, circuit: unknown, provingKey: ArrayBuffer): Promise<unknown>;
    function toSolidityInput(proof: unknown): { proof: unknown };
}