import { Host } from "~/host";
import { AccountId } from "~/types";

// Can use a factory pattern to enforce standardization
interface PluginFactory {
    createPlugin(host: Host, options: any): Promise<Plugin>;
}

abstract class Plugin {
    // Can't do `static abstract create(host: Host, options: any): Promise<Plugin>;`
    // so we need to imlp it on the implementing class, and use a factory for standardization
    abstract account(): Promise<AccountId>;
}

class MyPlugin extends Plugin {
    private constructor(private readonly host: Host, private readonly options: any) {
        super();
    }

    static async create(host: Host, options: any): Promise<MyPlugin> {
        return new MyPlugin(host, options);
    }

    async account(): Promise<AccountId> { throw new Error("Method not implemented."); }
}

export const MyPluginFactory: PluginFactory = {
    async createPlugin(host: Host, options: any): Promise<Plugin> {
        return MyPlugin.create(host, options);
    },
};
