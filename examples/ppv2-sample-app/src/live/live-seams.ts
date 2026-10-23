/**
 * LIVE MODE — the one dev seam left when running against real Sepolia: a real
 * Groth16 prover over the locally built circuit artifacts, injected via
 * `PPv2Factories.proofService`.
 *
 * Everything else is the production path: the plugin builds its real HTTP ASP
 * client/data provider from `asp.baseUrl` + pinned `publicKey`, and its real
 * relayer client from the `relayers` list.
 *
 * Why a prover can still be injected: the plugin's default path fetches
 * artifacts from IPFS via the pinned CID manifest (the same CIDs as the SDK's
 * `DEFAULT_CIRCUIT_MANIFEST`). When `CIRCUITS_DIR` points at a local
 * `circuits/build`, proving from those files skips the IPFS fetch and is faster;
 * the artifacts match the deployed verifiers (deposits prove and mine).
 */
import {
    Groth16Prover,
    type IProofService,
    LocalCircuitArtifacts,
    ProofService,
} from "@0xbow/privacy-pools-v2-sdk";

/** Real Groth16 proving over the locally built circuit artifacts. */
export function createLocalProofService(circuitsBuildDir: string): IProofService {
    return new ProofService({
        circuitArtifacts: new LocalCircuitArtifacts({ baseDir: circuitsBuildDir }),
        groth16Prover: new Groth16Prover(),
    });
}
