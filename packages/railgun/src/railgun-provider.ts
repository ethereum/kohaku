import { Host } from "@kohaku-eth/plugins";
import { RailgunPlugin } from "./plugin";
import { SignerPool } from "./signer-pool";
import { chainConfig, ChainConfig, EthereumProviderAdapter, NoteSyncer, RailgunProvider, RailgunSigner } from "@kohaku-eth/railgun-ts";

// export async function loadRailgunProvider(host: Host): Promise<RailgunPlugin> {
//     // const savedState = host.storage.get(STATE_KEY);

//     if (!savedState) {
//         throw new Error("No saved state found for Railgun plugin");
//     }

//     const { providerState, internalSigners, chainId }: RailgunPluginState = JSON.parse(savedState);
//     const remoteChainId = await host.provider.getChainId();

//     if (remoteChainId !== BigInt(chainId)) {
//         throw new Error(`Unexpected chain ID: remote: ${remoteChainId}, expected: ${chainId}`);
//     }

//     const provider = await newRailgunProvider(host, chainId);

//     // provider.setState(providerState);

//     if (internalSigners.length === 0) {
//         throw new Error("No internal signers found in saved state");
//     }

//     const primary = RailgunSigner.privateKey(internalSigners[0]!.spendingKey, internalSigners[0]!.viewingKey, chainId);
//     const pool = new SignerPool(primary);

//     for (const signer of internalSigners.slice(1)) {
//         pool.add(RailgunSigner.privateKey(signer.spendingKey, signer.viewingKey, chainId));
//     }

//     const plugin = new RailgunPlugin(chainId, provider, pool, host.storage);

//     for (const signer of internalSigners) {
//         plugin.addInternalSigner(signer.spendingKey, signer.viewingKey);
//     }

//     return plugin;
// }

// TODO: Delete me in favor of builder
// export async function newRailgunProvider(host: Host, chainId: number): Promise<RailgunProvider> {
//     const chain = chainConfig(chainId);
//     if (!chain) throw new Error(`Unsupported chain ID: ${chainId}`);

//     const rpcAdapter = new EthereumProviderAdapter(host.provider);
//     const syncer = NoteSyncer.chained([
//         NoteSyncer.subsquid(chain),
//     ]);

//     return new RailgunProvider(chain, rpcAdapter, syncer);
// }
