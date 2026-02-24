import { AnyPluginInstance } from "./instance/base";
import { Broadcaster } from "./broadcaster/base";
import { Host } from "./host";
import { PrivateOperation } from "./shared";

export type Plugin<
    TName extends string = 'plugin',
    TInstance extends AnyPluginInstance = AnyPluginInstance,
    TPrivateOperation extends PrivateOperation = PrivateOperation,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    THost extends Host = Host,
    TBroadcaster extends Broadcaster<never, TPrivateOperation> | never = never,
    TExtraParams extends Record<string, any> = Record<string, any>
> = {
    plugin_name: TName,
    createInstance: () => Promise<TInstance> | TInstance;
    instances: () => Promise<TInstance[]> | TInstance[];
    readonly params: TExtraParams;
}
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    & (TBroadcaster extends never ? {} : { broadcaster: TBroadcaster })
    ;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPlugin = Plugin<any, any, any, any, any, any>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type PluginParams<TPlugin extends AnyPlugin> = TPlugin extends Plugin<any, any, any, any, any, infer TExtraParams> ? TExtraParams : never;

export type CreatePluginFn<TPlugin extends AnyPlugin> = (host: Host, params: PluginParams<TPlugin>) => Promise<TPlugin> | TPlugin;
