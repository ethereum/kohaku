import { CreatePluginFn, Host } from "@kohaku-eth/plugins";
import { TornadoCashBroadcaster, TornadoCashProtocol } from "../plugin";
import { TCBroadcaster, TCBroadcasterParameters, TCInstance, TCPluginParameters } from "./interfaces";
import { TornadoPaymasterConfigs } from "../config";

export const createTCBroadcaster = (
  host: Host,
  params?: TCBroadcasterParameters,
): TCBroadcaster => {
  const paymasterConfig = params?.paymasterConfig || TornadoPaymasterConfigs;

  return new TornadoCashBroadcaster({ host, ...params, paymasterConfig });
};

export const createTCPlugin = ((
  host: Host,
  params: TCPluginParameters,
): TCInstance => new TornadoCashProtocol(host, params)) satisfies CreatePluginFn<
  TCInstance,
  TCPluginParameters
>;
