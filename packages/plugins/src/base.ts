import { AnyAccount } from "./account/base";
import { Broadcaster } from "./broadcaster/base";
import { Host } from "./host";
import { PrivateOperation } from "./shared";

export type Plugin<
    TName extends string = 'plugin',
    TAccount extends AnyAccount = AnyAccount,
    TPrivateOperation extends PrivateOperation = PrivateOperation,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    THost extends Host = Host,
    TBroadcaster extends Broadcaster<never, TPrivateOperation> | never = never,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    TExtraParams extends Record<string, unknown> = Record<string, unknown>,
> = {
    plugin_name: TName,
    createAccount: () => Promise<TAccount> | TAccount;
    accounts: () => Promise<TAccount[]> | TAccount[];
}
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    & (TBroadcaster extends never ? {} : { broadcaster: TBroadcaster })
    ;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPlugin = Plugin<any, any, any, any, any>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type PluginParams<TPlugin extends AnyPlugin> = TPlugin extends Plugin<infer TName, infer TAccount, infer TPrivateOperation, infer THost, infer TBroadcaster, infer TExtraParams> ? TExtraParams : never;

export type CreatePluginFn<TPlugin extends AnyPlugin> = (host: Host, params: PluginParams<TPlugin>) => Promise<TPlugin> | TPlugin;
