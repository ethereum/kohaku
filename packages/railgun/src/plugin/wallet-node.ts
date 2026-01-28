/**
 * constant defining the derivation path prefixes for spending and viewing keys
 * must be appended with index' to form a complete path
 */
const DERIVATION_PATH_PREFIXES = {
    SPENDING: "m/44'/1984'/0'/0'/",
    VIEWING: "m/420'/1984'/0'/0'/",
};

/**
 * Helper to append DERIVATION_PATH_PREFIXES with index'
 */
export const derivePathsForIndex = (index: number = 0) => {
    return {
        spending: `${DERIVATION_PATH_PREFIXES.SPENDING}${index}'`,
        viewing: `${DERIVATION_PATH_PREFIXES.VIEWING}${index}'`,
    };
};