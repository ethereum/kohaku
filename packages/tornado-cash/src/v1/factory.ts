import { CreatePluginFn, Host } from "@kohaku-eth/plugins";
import { PrivacyPoolsBroadcaster, PrivacyPoolsV1Protocol } from "../plugin";
import { TCBroadcaster, TCBroadcasterParameters, TCInstance, TCPluginParameters } from "./interfaces";

export const createTCBroadcaster = (
  host: Host,
  params: TCBroadcasterParameters,
): TCBroadcaster => {
  return new PrivacyPoolsBroadcaster({ host, ...params });
};

export const createTCPlugin = ((
  host: Host,
  params: TCPluginParameters,
): TCInstance => new PrivacyPoolsV1Protocol(host, params)) satisfies CreatePluginFn<
  TCInstance,
  TCPluginParameters
>;
