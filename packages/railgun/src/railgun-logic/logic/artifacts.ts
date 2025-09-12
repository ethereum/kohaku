import artifacts from '@railgun-community/circuit-artifacts';
import type { Artifact, VKey } from '@railgun-community/circuit-artifacts';
import { Verifier } from '../typechain-types';

export interface SolidityG1Point {
  x: bigint;
  y: bigint;
}

export interface SolidityG2Point {
  x: [bigint, bigint];
  y: [bigint, bigint];
}

export interface SolidityVKey {
  artifactsIPFSHash: string;
  alpha1: {
    x: bigint;
    y: bigint;
  };
  beta2: {
    x: [bigint, bigint];
    y: [bigint, bigint];
  };
  gamma2: {
    x: [bigint, bigint];
    y: [bigint, bigint];
  };
  delta2: {
    y: [bigint, bigint];
    x: [bigint, bigint];
  };
  ic: { x: bigint; y: bigint }[];
}

export type EventVKeyMatcher = (i: unknown) => boolean;

export interface FormattedArtifact extends Artifact {
  solidityVKey: SolidityVKey;
  eventVKeyMatcher: EventVKeyMatcher;
}

const circuitList = [
  {
    nullifiers: 1,
    commitments: 2,
  },
  {
    nullifiers: 1,
    commitments: 3,
  },
  {
    nullifiers: 2,
    commitments: 2,
  },
  {
    nullifiers: 2,
    commitments: 3,
  },
  {
    nullifiers: 8,
    commitments: 2,
  },
];

/**
 * Formats vkey for solidity input
 *
 * @param vkey - verification key to format
 * @returns formatted vkey
 */
function formatVKey(vkey: VKey): SolidityVKey {
  // Parse points to X,Y coordinate bigints and return
  return {
    artifactsIPFSHash: '',
    alpha1: {
      x: BigInt(vkey.vk_alpha_1[0]),
      y: BigInt(vkey.vk_alpha_1[1]),
    },
    beta2: {
      x: [BigInt(vkey.vk_beta_2[0][1]), BigInt(vkey.vk_beta_2[0][0])],
      y: [BigInt(vkey.vk_beta_2[1][1]), BigInt(vkey.vk_beta_2[1][0])],
    },
    gamma2: {
      x: [BigInt(vkey.vk_gamma_2[0][1]), BigInt(vkey.vk_gamma_2[0][0])],
      y: [BigInt(vkey.vk_gamma_2[1][1]), BigInt(vkey.vk_gamma_2[1][0])],
    },
    delta2: {
      x: [BigInt(vkey.vk_delta_2[0][1]), BigInt(vkey.vk_delta_2[0][0])],
      y: [BigInt(vkey.vk_delta_2[1][1]), BigInt(vkey.vk_delta_2[1][0])],
    },
    ic: vkey.IC.map((icEl) => ({
      x: BigInt(icEl[0]),
      y: BigInt(icEl[1]),
    })),
  };
}

/**
 * Check G1 points match
 *
 * @param point1 - point 1
 * @param point2 - point 2
 * @returns points match
 */
function matchG1Point(point1: Record<string, unknown>, point2: SolidityG1Point) {
  // Check coordinates match, not strict equals so that similar number types can be matched
  if (point1.x != point2.x) return false;
  if (point1.y != point2.y) return false;

  return true;
}

/**
 * Check G1 points match
 *
 * @param point1 - point 1
 * @param point2 - point 2
 * @returns points match
 */
function matchG2Point(point1: Record<string, unknown>, point2: SolidityG2Point) {
  // Check coordinate arrays exist
  if (!Array.isArray(point1.x)) return false;
  if (!Array.isArray(point1.y)) return false;

  // Check coordinates match, not strict equals so that similar number types can be matched
  if (point1.x[0] != point2.x[0]) return false;
  if (point1.x[1] != point2.x[1]) return false;
  if (point1.y[0] != point2.y[0]) return false;
  if (point1.y[1] != point2.y[1]) return false;

  return true;
}

/**
 * Formats vkey for solidity event checking
 *
 * @param vkey - verification key to format
 * @returns formatted vkey
 */
function formatVKeyMatcher(vkey: VKey): EventVKeyMatcher {
  const vkeySolidity = formatVKey(vkey);

  return (i: unknown): boolean => {
    // Check type
    if (!i) return false;
    if (typeof i !== 'object') return false;

    // Cast to record
    const iCast = i as Record<string, unknown>;

    // Check artifactsIPFSHash
    if (iCast.artifactsIPFSHash !== vkeySolidity.artifactsIPFSHash) return false;

    // Check alpha point
    if (!iCast.alpha1) return false;
    if (typeof iCast.alpha1 !== 'object') return false;
    if (!matchG1Point(iCast.alpha1 as Record<string, unknown>, vkeySolidity.alpha1)) return false;

    // Check beta point
    if (!iCast.beta2) return false;
    if (typeof iCast.beta2 !== 'object') return false;
    if (!matchG2Point(iCast.beta2 as Record<string, unknown>, vkeySolidity.beta2)) return false;

    // Check beta point
    if (!iCast.gamma2) return false;
    if (typeof iCast.gamma2 !== 'object') return false;
    if (!matchG2Point(iCast.gamma2 as Record<string, unknown>, vkeySolidity.gamma2)) return false;

    // Check beta point
    if (!iCast.delta2) return false;
    if (typeof iCast.delta2 !== 'object') return false;
    if (!matchG2Point(iCast.delta2 as Record<string, unknown>, vkeySolidity.delta2)) return false;

    // Check IC
    if (!Array.isArray(iCast.ic)) return false;
    if (iCast.ic.length !== vkeySolidity.ic.length) return false;
    for (let index = 0; index < iCast.ic.length; index += 1) {
      if (!matchG1Point(iCast.ic[index] as Record<string, unknown>, vkeySolidity.ic[index]))
        return false;
    }

    return true;
  };
}

/**
 * Fetches artifact with formatted verification key
 *
 * @param nullifiers - nullifier count
 * @param commitments - commitment count
 * @returns keys
 */
function getKeys(nullifiers: number, commitments: number): FormattedArtifact {
  // Get artifact or undefined
  const artifact = artifacts.getArtifact(nullifiers, commitments);

  // Get format solidity vkey
  const artifactFormatted: FormattedArtifact = {
    ...artifact,
    solidityVKey: formatVKey(artifact.vkey),
    eventVKeyMatcher: formatVKeyMatcher(artifact.vkey),
  };

  return artifactFormatted;
}

/**
 * Returns all artifacts available
 *
 * @returns nullifier -\> commitments -\> keys
 */
function allArtifacts(): (undefined | (undefined | FormattedArtifact)[])[] {
  // Map each existing artifact to formatted artifact
  const circuitArtifacts: (undefined | (undefined | FormattedArtifact)[])[] = [];

  circuitList.forEach((circuit) => {
    if (!circuitArtifacts[circuit.nullifiers]) circuitArtifacts[circuit.nullifiers] = [];

    const artifact = artifacts.getArtifact(circuit.nullifiers, circuit.commitments);

    // @ts-expect-error will always be set above
    circuitArtifacts[circuit.nullifiers][circuit.commitments] = {
      ...artifact,
      solidityVKey: formatVKey(artifact.vkey),
      eventVKeyMatcher: formatVKeyMatcher(artifact.vkey),
    };
  });

  return circuitArtifacts;
}

/**
 * Lists all artifacts available
 *
 * @returns artifact configs
 */
function availableArtifacts() {
  return circuitList;
}

/**
 * Loads all artifacts into verifier contract
 *
 * @param verifierContract - verifier Contract
 * @returns complete
 */
async function loadAllArtifacts(verifierContract: Verifier) {
  for (const artifactConfig of artifacts.listArtifacts()) {
    const artifact = getKeys(artifactConfig.nullifiers, artifactConfig.commitments);
    await (
      await verifierContract.setVerificationKey(
        artifactConfig.nullifiers,
        artifactConfig.commitments,
        artifact.solidityVKey,
      )
    ).wait();
  }
}

/**
 * Loads available artifacts into verifier contract
 *
 * @param verifierContract - verifier Contract
 * @returns complete
 */
async function loadAvailableArtifacts(verifierContract: Verifier) {
  for (const artifactConfig of availableArtifacts()) {
    const artifact = getKeys(artifactConfig.nullifiers, artifactConfig.commitments);
    await (
      await verifierContract.setVerificationKey(
        artifactConfig.nullifiers,
        artifactConfig.commitments,
        artifact.solidityVKey,
      )
    ).wait();
  }
}

export {
  formatVKey,
  formatVKeyMatcher,
  getKeys,
  allArtifacts,
  availableArtifacts,
  loadAllArtifacts,
  loadAvailableArtifacts,
};
