/**
 * LIVE MODE — the one dev seam left when running against real Sepolia: a real
 * Groth16 prover over the locally built circuit artifacts, injected via
 * `PPv2Factories.proofService`.
 *
 * Everything else is the production path: the plugin builds its real HTTP ASP
 * client/data provider from `asp.baseUrl` + pinned `publicKey`, and its real
 * relayer client from the `relayers` list.
 *
 * Why the prover is still injected: the plugin's default path fetches
 * artifacts from IPFS via the pinned CID manifest, and the SDK build in use
 * ships an empty `DEFAULT_CIRCUIT_MANIFEST`. The local `circuits/build`
 * artifacts are verified to match the deployed verifiers (deposits prove and
 * mine), so local proving is both faster and trustworthy here.
 */
import {
    Groth16Prover,
    type IProofService,
    LocalCircuitArtifacts,
    ProofService,
} from "@0xbow-io/privacy-pools-v2-sdk";

/** Real Groth16 proving over the locally built circuit artifacts. */
export function createLocalProofService(circuitsBuildDir: string): IProofService {
    return new ProofService({
        circuitArtifacts: new LocalCircuitArtifacts({ baseDir: circuitsBuildDir }),
        groth16Prover: new Groth16Prover(),
    });
}
