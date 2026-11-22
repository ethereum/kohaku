/* @ts-self-types="./kohaku_railgun_wasm.d.ts" */

/**
 * A known Railgun deployment and its contract configuration.
 */
class Chain {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Chain.prototype);
        obj.__wbg_ptr = ptr;
        ChainFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ChainFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_chain_free(ptr, 0);
    }
    /**
     * @returns {bigint}
     */
    get chainId() {
        const ret = wasm.chain_chainId(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {bigint}
     */
    get deploymentBlock() {
        const ret = wasm.chain_deploymentBlock(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * Find a configured deployment. Unknown chains return undefined.
     * @param {bigint} chain_id
     * @returns {Chain | undefined}
     */
    static fromChainId(chain_id) {
        const ret = wasm.chain_fromChainId(chain_id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] === 0 ? undefined : Chain.__wrap(ret[0]);
    }
    /**
     * @returns {Chain}
     */
    static mainnet() {
        const ret = wasm.chain_mainnet();
        return Chain.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    get poiEndpoint() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.chain_poiEndpoint(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {bigint}
     */
    get poiStartBlock() {
        const ret = wasm.chain_poiStartBlock(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {string}
     */
    get railgunSmartWallet() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.chain_railgunSmartWallet(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Chain}
     */
    static sepolia() {
        const ret = wasm.chain_sepolia();
        return Chain.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    get subsquidEndpoint() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.chain_subsquidEndpoint(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get unshieldFeeBps() {
        const ret = wasm.chain_unshieldFeeBps(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {string}
     */
    get wrappedBaseToken() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.chain_wrappedBaseToken(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Chain.prototype[Symbol.dispose] = Chain.prototype.free;
exports.Chain = Chain;

/**
 * A PPOI-enabled wallet. The caller owns encryption and must persist
 * `checkpointJson()` after each successful sync or proof-processing pass.
 */
class PoiSession {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(PoiSession.prototype);
        obj.__wbg_ptr = ptr;
        PoiSessionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PoiSessionFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_poisession_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get address() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.poisession_address(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Promise<string>}
     */
    balancesJson() {
        const ret = wasm.poisession_balancesJson(this.__wbg_ptr);
        return ret;
    }
    /**
     * Caller-encrypted checkpoint. Persist it after sync and proof processing.
     * @returns {string}
     */
    checkpointJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.poisession_checkpointJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {Promise<string>}
     */
    notesJson() {
        const ret = wasm.poisession_notesJson(this.__wbg_ptr);
        return ret;
    }
    /**
     * Open a known-chain wallet with caller-supplied RPC and encrypted-storage
     * plaintext. The JSON checkpoint is from `checkpointJson()` or omitted for
     * a full resync; old combined SDK checkpoints are intentionally unsupported.
     * @param {Chain} chain
     * @param {string} rpc_url
     * @param {string} spending_key
     * @param {string} viewing_key
     * @param {string | null} [checkpoint_json]
     * @param {string | null} [artifact_base_url]
     * @returns {Promise<PoiSession>}
     */
    static open(chain, rpc_url, spending_key, viewing_key, checkpoint_json, artifact_base_url) {
        _assertClass(chain, Chain);
        const ptr0 = passStringToWasm0(rpc_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(spending_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(viewing_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        var ptr3 = isLikeNone(checkpoint_json) ? 0 : passStringToWasm0(checkpoint_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len3 = WASM_VECTOR_LEN;
        var ptr4 = isLikeNone(artifact_base_url) ? 0 : passStringToWasm0(artifact_base_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len4 = WASM_VECTOR_LEN;
        const ret = wasm.poisession_open(chain.__wbg_ptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        return ret;
    }
    /**
     * @returns {string}
     */
    poiListKeysJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.poisession_poiListKeysJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    poiPendingJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.poisession_poiPendingJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    poiRecoveredValidJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.poisession_poiRecoveredValidJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @param {string} blinded_commitment
     * @returns {string}
     */
    poiStatusPerListJson(blinded_commitment) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(blinded_commitment, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.poisession_poiStatusPerListJson(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Prove a private transfer and prepare its signed paymaster `UserOperation`.
     * Persist `checkpointJson()` before submitting `signed` to the bundler.
     * @param {RailgunAddress} recipient
     * @param {string} token
     * @param {bigint} amount
     * @param {string} memo
     * @param {string} account_private_key
     * @param {string} bundler_url
     * @returns {Promise<string>}
     */
    prepareTransferUserOpJson(recipient, token, amount, memo, account_private_key, bundler_url) {
        _assertClass(recipient, RailgunAddress);
        const ptr0 = passStringToWasm0(token, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(memo, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(account_private_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(bundler_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.poisession_prepareTransferUserOpJson(this.__wbg_ptr, recipient.__wbg_ptr, ptr0, len0, amount, ptr1, len1, ptr2, len2, ptr3, len3);
        return ret;
    }
    /**
     * Prove an unshield and prepare a signed paymaster `UserOperation`. For
     * native ETH, unshield WETH and prefix `WETH.withdraw` before user calls.
     * User calls may only execute on the unshield recipient's own 7702 account.
     * The amount is the desired recipient amount; protocol fee is added on top.
     * @param {string} recipient
     * @param {string} token
     * @param {bigint} amount
     * @param {boolean} unwrap_native
     * @param {string} tail_calls_json
     * @param {string} account_private_key
     * @param {string} bundler_url
     * @returns {Promise<string>}
     */
    prepareUnshieldUserOpJson(recipient, token, amount, unwrap_native, tail_calls_json, account_private_key, bundler_url) {
        const ptr0 = passStringToWasm0(recipient, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(token, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(tail_calls_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(account_private_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ptr4 = passStringToWasm0(bundler_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len4 = WASM_VECTOR_LEN;
        const ret = wasm.poisession_prepareUnshieldUserOpJson(this.__wbg_ptr, ptr0, len0, ptr1, len1, amount, unwrap_native, ptr2, len2, ptr3, len3, ptr4, len4);
        return ret;
    }
    /**
     * Generate and send queued proofs. The JSON report describes attempts,
     * not POI acceptance. Sync lists again before displaying Valid.
     * @returns {Promise<string>}
     */
    processPendingPoiJson() {
        const ret = wasm.poisession_processPendingPoiJson(this.__wbg_ptr);
        return ret;
    }
    /**
     * Refresh PPOI/TXIDs and recover missing proofs without submitting them.
     * @returns {Promise<void>}
     */
    refreshPoi() {
        const ret = wasm.poisession_refreshPoi(this.__wbg_ptr);
        return ret;
    }
    /**
     * History-only window; call refreshPoi after the final window.
     * @param {bigint} block
     * @returns {Promise<void>}
     */
    syncHistoryTo(block) {
        const ret = wasm.poisession_syncHistoryTo(this.__wbg_ptr, block);
        return ret;
    }
    /**
     * Bounded variant for resumable first syncs. Persist `checkpointJson()`
     * after every successful window.
     * @param {bigint} block
     * @returns {Promise<void>}
     */
    syncToWithoutPoiSubmission(block) {
        const ret = wasm.poisession_syncToWithoutPoiSubmission(this.__wbg_ptr, block);
        return ret;
    }
    /**
     * Sync UTXOs, TXIDs, and PPOI lists; recover old missing proofs into the
     * pending queue without sending any proof to the PPOI node.
     * @returns {Promise<void>}
     */
    syncWithoutPoiSubmission() {
        const ret = wasm.poisession_syncWithoutPoiSubmission(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {bigint}
     */
    get syncedBlock() {
        const ret = wasm.poisession_syncedBlock(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
}
if (Symbol.dispose) PoiSession.prototype[Symbol.dispose] = PoiSession.prototype.free;
exports.PoiSession = PoiSession;

/**
 * A Railgun recipient address. Chain IDs are advisory in the core protocol.
 */
class RailgunAddress {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(RailgunAddress.prototype);
        obj.__wbg_ptr = ptr;
        RailgunAddressFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RailgunAddressFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_railgunaddress_free(ptr, 0);
    }
    /**
     * Return the address with an all-chains advisory hint.
     * @returns {RailgunAddress}
     */
    allChains() {
        const ret = wasm.railgunaddress_allChains(this.__wbg_ptr);
        return RailgunAddress.__wrap(ret);
    }
    /**
     * Derive an address from two 32-byte private keys. Keep the inputs secret.
     * @param {Hex} spending_key
     * @param {Hex} viewing_key
     * @param {bigint} chain_id
     * @returns {RailgunAddress}
     */
    static fromPrivateKeys(spending_key, viewing_key, chain_id) {
        const ret = wasm.railgunaddress_fromPrivateKeys(spending_key, viewing_key, chain_id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return RailgunAddress.__wrap(ret[0]);
    }
    /**
     * Construct an address from the public master and viewing keys.
     * @param {Hex} master_key
     * @param {Hex} viewing_public_key
     * @param {bigint} chain_id
     * @returns {RailgunAddress}
     */
    static fromPublicKeys(master_key, viewing_public_key, chain_id) {
        const ret = wasm.railgunaddress_fromPublicKeys(master_key, viewing_public_key, chain_id);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return RailgunAddress.__wrap(ret[0]);
    }
    /**
     * Parse and validate a Bech32m Railgun address.
     * @param {string} text
     * @returns {RailgunAddress}
     */
    static parse(text) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.railgunaddress_parse(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return RailgunAddress.__wrap(ret[0]);
    }
    /**
     * @returns {string}
     */
    toString() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.railgunaddress_toString(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) RailgunAddress.prototype[Symbol.dispose] = RailgunAddress.prototype.free;
exports.RailgunAddress = RailgunAddress;

/**
 * Prepare one or more Railgun shields without broadcasting or persisting state.
 */
class Shield {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ShieldFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_shield_free(ptr, 0);
    }
    /**
     * Add an ERC20 shield. Amount is in token base units.
     * @param {RailgunAddress} recipient
     * @param {Hex} token
     * @param {bigint} amount
     */
    addErc20(recipient, token, amount) {
        _assertClass(recipient, RailgunAddress);
        const ret = wasm.shield_addErc20(this.__wbg_ptr, recipient.__wbg_ptr, token, amount);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Add a native-currency shield. Amount is in wei.
     * @param {RailgunAddress} recipient
     * @param {bigint} amount
     */
    addNative(recipient, amount) {
        _assertClass(recipient, RailgunAddress);
        const ret = wasm.shield_addNative(this.__wbg_ptr, recipient.__wbg_ptr, amount);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Build transaction calls. ERC20 shielding also requires caller-managed approval.
     * @returns {Call[]}
     */
    build() {
        const ptr = this.__destroy_into_raw();
        const ret = wasm.shield_build(ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Chain} chain
     */
    constructor(chain) {
        _assertClass(chain, Chain);
        const ret = wasm.shield_new(chain.__wbg_ptr);
        this.__wbg_ptr = ret >>> 0;
        ShieldFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) Shield.prototype[Symbol.dispose] = Shield.prototype.free;
exports.Shield = Shield;

/**
 * A struct representing a Trap
 */
class Trap {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Trap.prototype);
        obj.__wbg_ptr = ptr;
        TrapFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        TrapFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_trap_free(ptr, 0);
    }
    /**
     * A marker method to indicate that an object is an instance of the `Trap`
     * class.
     */
    static __wbg_wasmer_trap() {
        wasm.trap___wbg_wasmer_trap();
    }
}
if (Symbol.dispose) Trap.prototype[Symbol.dispose] = Trap.prototype.free;
exports.Trap = Trap;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_BigInt_b7bbccdff258c9f2: function(arg0) {
            const ret = BigInt(arg0);
            return ret;
        },
        __wbg_Error_8c4e43fe74559d73: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Number_04624de7d0e8332d: function(arg0) {
            const ret = Number(arg0);
            return ret;
        },
        __wbg_String_8f0eb39a4a4c2f66: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_8fcf4ce7f1ca72a2: function(arg0, arg1) {
            const v = arg1;
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_bbbb1c18aa2f5e25: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_0bc8482c6e3508ae: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_function_table_5ae7216dfcbcc506: function() {
            const ret = wasm.__wbindgen_export;
            return ret;
        },
        __wbg___wbindgen_is_bigint_31b12575b56f32fc: function(arg0) {
            const ret = typeof(arg0) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_0095a73b8b156f76: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_5ae8e5880f2c1fbd: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_cd444516edc5b180: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_9e4d92534c42d778: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_11888390b0186270: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_9dd77d8cd6671811: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_lt_bb59cc3d23526e0d: function(arg0, arg1) {
            const ret = arg0 < arg1;
            return ret;
        },
        __wbg___wbindgen_neg_6b4d356dff49dcc6: function(arg0) {
            const ret = -arg0;
            return ret;
        },
        __wbg___wbindgen_number_get_8ff4255516ccad3e: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_rethrow_05525c567f154472: function(arg0) {
            throw arg0;
        },
        __wbg___wbindgen_shr_ef8e07cce709eb54: function(arg0, arg1) {
            const ret = arg0 >> arg1;
            return ret;
        },
        __wbg___wbindgen_string_get_72fb696202c56729: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_d9b87ff7982e3b21: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_abort_2f0584e03e8e3950: function(arg0) {
            arg0.abort();
        },
        __wbg_abort_d549b92d3c665de1: function(arg0, arg1) {
            arg0.abort(arg1);
        },
        __wbg_append_a992ccc37aa62dc4: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.append(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_apply_2e22c45cb4f12415: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.apply(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_arrayBuffer_bb54076166006c39: function() { return handleError(function (arg0) {
            const ret = arg0.arrayBuffer();
            return ret;
        }, arguments); },
        __wbg_bind_29ba380591735d8c: function(arg0, arg1, arg2) {
            const ret = arg0.bind(arg1, arg2);
            return ret;
        },
        __wbg_call_389efe28435a9388: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_call_4708e0c13bdc8e95: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_clearTimeout_5a54f8841c30079a: function(arg0) {
            const ret = clearTimeout(arg0);
            return ret;
        },
        __wbg_clearTimeout_7bfb119a4102d492: function(arg0) {
            const ret = clearTimeout(arg0);
            return ret;
        },
        __wbg_constructor_ad6c0ed428f55d34: function(arg0) {
            const ret = arg0.constructor;
            return ret;
        },
        __wbg_crypto_86f2631e91b51511: function(arg0) {
            const ret = arg0.crypto;
            return ret;
        },
        __wbg_done_57b39ecd9addfe81: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_entries_04679661ea6e74fc: function(arg0) {
            const ret = arg0.entries();
            return ret;
        },
        __wbg_exports_794a42000dacd046: function(arg0) {
            const ret = WebAssembly.Module.exports(arg0);
            return ret;
        },
        __wbg_exports_86b4926134c40288: function(arg0) {
            const ret = arg0.exports;
            return ret;
        },
        __wbg_fetch_afb6a4b6cacf876d: function(arg0, arg1) {
            const ret = arg0.fetch(arg1);
            return ret;
        },
        __wbg_fetch_deda9dd882c80f3e: function(arg0) {
            const ret = fetch(arg0);
            return ret;
        },
        __wbg_getPrototypeOf_2653517f1dc884d5: function() { return handleError(function (arg0) {
            const ret = Reflect.getPrototypeOf(arg0);
            return ret;
        }, arguments); },
        __wbg_getRandomValues_a8ddca022803a145: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getRandomValues_b3f15fcbfabb0f8b: function() { return handleError(function (arg0, arg1) {
            arg0.getRandomValues(arg1);
        }, arguments); },
        __wbg_get_7efbcc3819719b0f: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.get(arg1 >>> 0);
            return ret;
        }, arguments); },
        __wbg_get_9b94d73e6221f75c: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_b3ed3ad4be2bc8ac: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_has_d4e53238966c12b6: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.has(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_headers_59a2938db9f80985: function(arg0) {
            const ret = arg0.headers;
            return ret;
        },
        __wbg_imports_8333d40ab24779ad: function(arg0) {
            const ret = WebAssembly.Module.imports(arg0);
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_c367199e2fa2aa04: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Error_8573fe0b0b480f46: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Error;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Function_2a29eec978bb3b11: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Function;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Global_2db767b6b2347f01: function(arg0) {
            let result;
            try {
                result = arg0 instanceof WebAssembly.Global;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Memory_dc8c61e3f831ee37: function(arg0) {
            let result;
            try {
                result = arg0 instanceof WebAssembly.Memory;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Object_1c6af87502b733ed: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Object;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Response_ee1d54d79ae41977: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Response;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Table_127f216e592f4159: function(arg0) {
            let result;
            try {
                result = arg0 instanceof WebAssembly.Table;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Tag_f1d6b24a98b95210: function(arg0) {
            let result;
            try {
                result = arg0 instanceof WebAssembly.Tag;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_9b9075935c74707c: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_d314bb98fcf08331: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_length_32ed9a279acd054c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_35a7bace40f36eac: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_message_9ddc4b9a62a7c379: function(arg0) {
            const ret = arg0.message;
            return ret;
        },
        __wbg_msCrypto_d562bbe83e0d4b91: function(arg0) {
            const ret = arg0.msCrypto;
            return ret;
        },
        __wbg_new_361308b2356cecd0: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_3eb36ae241fe6f44: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_57c27ff3ddf5b62c: function() { return handleError(function (arg0) {
            const ret = new WebAssembly.Module(arg0);
            return ret;
        }, arguments); },
        __wbg_new_64284bd487f9d239: function() { return handleError(function () {
            const ret = new Headers();
            return ret;
        }, arguments); },
        __wbg_new_a4e3cab1cdd635ba: function() { return handleError(function (arg0, arg1) {
            const ret = new WebAssembly.Instance(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_new_b061c0550d9f3281: function() { return handleError(function (arg0) {
            const ret = new WebAssembly.Memory(arg0);
            return ret;
        }, arguments); },
        __wbg_new_b5d9e2fb389fef91: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke___wasm_bindgen_c2db0c93d537ef26___JsValue__wasm_bindgen_c2db0c93d537ef26___JsValue_____(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = state0.b = 0;
            }
        },
        __wbg_new_b949e7f56150a5d1: function() { return handleError(function () {
            const ret = new AbortController();
            return ret;
        }, arguments); },
        __wbg_new_dd2b680c8bf6ae29: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_from_slice_a3d2629dc1826784: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_no_args_1c7c842f08d00ebb: function(arg0, arg1) {
            const ret = new Function(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_with_length_1763c527b2923202: function(arg0) {
            const ret = new Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_length_a2c39cbe88fd8ff1: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return ret;
        },
        __wbg_new_with_str_and_init_a61cbc6bdef21614: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Request(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_next_3482f54c49e8af19: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_node_e1f24f89a7336c2e: function(arg0) {
            const ret = arg0.node;
            return ret;
        },
        __wbg_now_2c95c9de01293173: function(arg0) {
            const ret = arg0.now();
            return ret;
        },
        __wbg_now_a3af9a2f4bbaa4d1: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_performance_7a3ffd0b17f663ad: function(arg0) {
            const ret = arg0.performance;
            return ret;
        },
        __wbg_poisession_new: function(arg0) {
            const ret = PoiSession.__wrap(arg0);
            return ret;
        },
        __wbg_process_3975fd6c72f520aa: function(arg0) {
            const ret = arg0.process;
            return ret;
        },
        __wbg_prototypesetcall_bdcdcc5842e4d77d: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_8ffdcb2063340ba5: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_queueMicrotask_0aa0a927f78f5d98: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_5bb536982f78a56f: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_randomFillSync_f8c153b79f285817: function() { return handleError(function (arg0, arg1) {
            arg0.randomFillSync(arg1);
        }, arguments); },
        __wbg_require_b74f47fc2d022fd6: function() { return handleError(function () {
            const ret = module.require;
            return ret;
        }, arguments); },
        __wbg_resolve_002c4b7d9d8f6b64: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_setTimeout_0ee837fe2edf935b: function(arg0, arg1) {
            const ret = setTimeout(arg0, arg1);
            return ret;
        },
        __wbg_setTimeout_db2dbaeefb6f39c7: function() { return handleError(function (arg0, arg1) {
            const ret = setTimeout(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_set_3f1d0b984ed272ed: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_6cb8631f80447a67: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_body_9a7e00afe3cfe244: function(arg0, arg1) {
            arg0.body = arg1;
        },
        __wbg_set_cache_315a3ed773a41543: function(arg0, arg1) {
            arg0.cache = __wbindgen_enum_RequestCache[arg1];
        },
        __wbg_set_credentials_c4a58d2e05ef24fb: function(arg0, arg1) {
            arg0.credentials = __wbindgen_enum_RequestCredentials[arg1];
        },
        __wbg_set_f43e577aea94465b: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_headers_cfc5f4b2c1f20549: function(arg0, arg1) {
            arg0.headers = arg1;
        },
        __wbg_set_method_c3e20375f5ae7fac: function(arg0, arg1, arg2) {
            arg0.method = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_mode_b13642c312648202: function(arg0, arg1) {
            arg0.mode = __wbindgen_enum_RequestMode[arg1];
        },
        __wbg_set_signal_f2d3f8599248896d: function(arg0, arg1) {
            arg0.signal = arg1;
        },
        __wbg_signal_d1285ecab4ebc5ad: function(arg0) {
            const ret = arg0.signal;
            return ret;
        },
        __wbg_static_accessor_GLOBAL_12837167ad935116: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_e628e89ab3b1c95f: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_a621d3dfbb60d0ce: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_f8727f0cf888e0bd: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_status_89d7e803db911ee7: function(arg0) {
            const ret = arg0.status;
            return ret;
        },
        __wbg_subarray_a96e1fef17ed23cb: function(arg0, arg1, arg2) {
            const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
            return ret;
        },
        __wbg_text_083b8727c990c8c0: function() { return handleError(function (arg0) {
            const ret = arg0.text();
            return ret;
        }, arguments); },
        __wbg_then_0d9fe2c7b1857d32: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_then_b9e7b3b5f1a9e1b5: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_toString_56d946daff83867b: function(arg0, arg1, arg2) {
            const ret = arg1.toString(arg2);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_toString_964ff7fe6eca8362: function(arg0) {
            const ret = arg0.toString();
            return ret;
        },
        __wbg_trap_new: function(arg0) {
            const ret = Trap.__wrap(arg0);
            return ret;
        },
        __wbg_url_c484c26b1fbf5126: function(arg0, arg1) {
            const ret = arg1.url;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_value_0546255b415e96c1: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbg_versions_4e31226f5e8dc909: function(arg0) {
            const ret = arg0.versions;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { dtor_idx: 1866, function: Function { arguments: [], shim_idx: 1867, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen_c2db0c93d537ef26___closure__destroy___dyn_core_9b3796e30d99ddb7___ops__function__FnMut_____Output_______, wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke______);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { dtor_idx: 3171, function: Function { arguments: [], shim_idx: 3172, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen_c2db0c93d537ef26___closure__destroy___dyn_core_9b3796e30d99ddb7___ops__function__FnMut_____Output________1_, wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke_______1_);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { dtor_idx: 3187, function: Function { arguments: [Externref], shim_idx: 3188, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm.wasm_bindgen_c2db0c93d537ef26___closure__destroy___dyn_core_9b3796e30d99ddb7___ops__function__FnMut__wasm_bindgen_c2db0c93d537ef26___JsValue____Output_______, wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke___wasm_bindgen_c2db0c93d537ef26___JsValue_____);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000005: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000006: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000007: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000008: function(arg0, arg1) {
            // Cast intrinsic for `U128 -> Externref`.
            const ret = (BigInt.asUintN(64, arg0) | (BigInt.asUintN(64, arg1) << BigInt(64)));
            return ret;
        },
        __wbindgen_cast_0000000000000009: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./kohaku_railgun_wasm_bg.js": import0,
    };
}

function wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke______(arg0, arg1) {
    wasm.wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke______(arg0, arg1);
}

function wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke_______1_(arg0, arg1) {
    wasm.wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke_______1_(arg0, arg1);
}

function wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke___wasm_bindgen_c2db0c93d537ef26___JsValue_____(arg0, arg1, arg2) {
    wasm.wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke___wasm_bindgen_c2db0c93d537ef26___JsValue_____(arg0, arg1, arg2);
}

function wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke___wasm_bindgen_c2db0c93d537ef26___JsValue__wasm_bindgen_c2db0c93d537ef26___JsValue_____(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke___wasm_bindgen_c2db0c93d537ef26___JsValue__wasm_bindgen_c2db0c93d537ef26___JsValue_____(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_RequestCache = ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"];


const __wbindgen_enum_RequestCredentials = ["omit", "same-origin", "include"];


const __wbindgen_enum_RequestMode = ["same-origin", "no-cors", "cors", "navigate"];
const ChainFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_chain_free(ptr >>> 0, 1));
const PoiSessionFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_poisession_free(ptr >>> 0, 1));
const RailgunAddressFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_railgunaddress_free(ptr >>> 0, 1));
const ShieldFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_shield_free(ptr >>> 0, 1));
const TrapFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_trap_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => state.dtor(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeMutClosure(arg0, arg1, dtor, f) {
    const state = { a: arg0, b: arg1, cnt: 1, dtor };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            state.dtor(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/kohaku_railgun_wasm_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
const wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
wasm.__wbindgen_start();
