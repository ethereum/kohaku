/** The enrollment parameter and input member carrying the holder's freshness window in seconds, and the errors that name it. */
export const METHOD_AADHAAR_WINDOW_PARAM = 'freshnessWindow';
export const METHOD_AADHAAR_WINDOW_TYPE_MESSAGE = 'must be a bigint or a safe integer';
export const METHOD_AADHAAR_WINDOW_RANGE_MESSAGE = 'must be at least 3600 seconds and fit a uint256';

/** The parameter carrying the method module's trusted keys exactly as `trustedParties` read them, and the error that names it. */
export const METHOD_AADHAAR_TRUSTED_KEYS_PARAM = 'trustedKeys';
export const METHOD_AADHAAR_TRUSTED_KEYS_MESSAGE = "must be the module's trusted keys as read: an array of exactly one 32-byte hex word";
