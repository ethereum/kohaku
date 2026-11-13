/** A decimal unsigned integer, the form the stack reports a unique identifier in; kept out of the constants index so the parser stays private. */
export const METHOD_ZKPASSPORT_DECIMAL_PATTERN = /^[0-9]+$/;

/** The leading `http://` or `https://` the zkPassport stack strips from a domain. */
export const METHOD_ZKPASSPORT_DOMAIN_SCHEME_PATTERN = /^https?:\/\//;

/** The last `/` and what follows it, which the stack strips next. */
export const METHOD_ZKPASSPORT_DOMAIN_PATH_PATTERN = /\/[^/]*$/;

/** The first `:` followed by digits, which the stack strips next. */
export const METHOD_ZKPASSPORT_DOMAIN_PORT_PATTERN = /:[0-9]+/;

/** A `?` and what follows it, which the stack strips next. */
export const METHOD_ZKPASSPORT_DOMAIN_QUERY_PATTERN = /\?.*$/;

/** A `#` and what follows it, which the stack strips last before lower-casing. */
export const METHOD_ZKPASSPORT_DOMAIN_FRAGMENT_PATTERN = /#.*$/;
