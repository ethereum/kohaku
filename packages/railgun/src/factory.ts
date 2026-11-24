import type { CreatePluginFn, Host } from "@kohaku-eth/plugins";
import { RailgunBroadcaster } from "./broadcaster.js";
import { RailgunProtocol, type RailgunInstance, type RailgunPluginOptions } from "./plugin.js";

export const createRailgunPlugin = ((host: Host, options: RailgunPluginOptions) =>
  RailgunProtocol.open(host, options)) satisfies CreatePluginFn<RailgunInstance, RailgunPluginOptions>;

export const createRailgunBroadcaster = (host: Host): RailgunBroadcaster =>
  new RailgunBroadcaster({ host });
