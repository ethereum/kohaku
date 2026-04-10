import { CreatePluginFn, Host } from "@kohaku-eth/plugins";
import { TornadoCashBroadcaster, TornadoCashProtocol } from "../plugin";
import { TCBroadcaster, TCBroadcasterParameters, TCInstance, TCPluginParameters } from "./interfaces";

export const createTCBroadcaster = (
  host: Host,
  params: TCBroadcasterParameters,
): TCBroadcaster => {
  return new TornadoCashBroadcaster({ host, ...params });
};

export const createTCPlugin = ((
  host: Host,
  params: TCPluginParameters,
): TCInstance => new TornadoCashProtocol(host, params)) satisfies CreatePluginFn<
  TCInstance,
  TCPluginParameters
>;
