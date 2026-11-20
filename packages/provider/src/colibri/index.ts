import { raw, RawProviderOptions } from '../raw';
import type { EthereumProvider } from '../provider';
import type { Config, default as Colibri, ProofStrategy } from '@corpus-core/colibri-stateless';
import { Provider } from 'ox/Provider';

export type ColibriConfig = Partial<Config>;

type ColibriConstructor = new (config?: ColibriConfig) => Colibri;

type ColibriModule = {
    default?: ColibriConstructor;
    Strategy?: { VerifiedOnly?: ProofStrategy };
};

async function importColibri(): Promise<{ Colibri: ColibriConstructor; verifiedOnly: ProofStrategy }> {
    const mod = (await import('@corpus-core/colibri-stateless')) as unknown as ColibriModule;

    if (!mod.default) {
        throw new Error(
            "Failed to import '@corpus-core/colibri-stateless' default export. " +
            "Ensure the package is installed and your bundler supports ESM default imports."
        );
    }

    // Without VerifiedOnly the adapter cannot fail closed, so it refuses to
    // build rather than fall back to Colibri's unverified default.
    const verifiedOnly = mod.Strategy?.VerifiedOnly;

    if (!verifiedOnly) {
        throw new Error(
            "'@corpus-core/colibri-stateless' does not export Strategy.VerifiedOnly. " +
            "The Colibri adapter needs it to reject unverified responses."
        );
    }

    return { Colibri: mod.default, verifiedOnly };
}

/**
  * Passed through to `new Colibri(...)`.
  * See Colibri-Stateless JS/TS docs for supported fields.
  * `options` configures Kohaku receipt waiting and is not passed to Colibri.
  *
  * Fails closed by default: unless `config.proofStrategy` is set (an explicit
  * `undefined` counts as unset), requests use
  * Colibri's `Strategy.VerifiedOnly`, so a response that cannot be proven is an
  * error. Colibri's own default (`WarningWithFallback`) returns the unverified
  * RPC answer with only a warning when verification fails. Pass another
  * strategy explicitly to opt out.
  */
export const colibri = async (config: ColibriConfig, options: RawProviderOptions = {}): Promise<EthereumProvider<Colibri>> => {
    const { Colibri: createColibri, verifiedOnly } = await importColibri();
    const client = new createColibri({
        verifyTransactions: config.fallback_provider ? true : false,
        zk_proof: true,
        ...config,
        proofStrategy: config.proofStrategy ?? verifiedOnly,
    });

    return {
        ...raw(client as unknown as Provider, options),
        _internal: client,
    }
}
