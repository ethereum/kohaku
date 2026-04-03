import { CreatePluginFn, Host } from "@kohaku-eth/plugins";
import { PrivacyPoolsBroadcaster, PrivacyPoolsV1Protocol } from "../plugin";
import {
  PPv1Broadcaster,
  PPv1BroadcasterParameters,
  PPv1Instance,
  PPv1LegacyInstance,
  PPv1PluginParameters,
  PPv1PluginWithMnemonicParameters,
} from "./interfaces";

export const createPPv1Broadcaster = (
  host: Host,
  params: PPv1BroadcasterParameters,
): PPv1Broadcaster => {
  return new PrivacyPoolsBroadcaster({ host, ...params });
};

export const createPPv1Plugin = (<
  Params extends PPv1PluginParameters | PPv1PluginWithMnemonicParameters,
>(
  host: Host,
  params: Params,
): Params extends PPv1PluginWithMnemonicParameters
  ? PPv1LegacyInstance
  : PPv1Instance => {
  if ("mnemonic" in params) {
    throw new Error("Not implemented.");
  }

  const broadcasterUrl = params.broadcasterUrl;
  const relayersList =
    typeof broadcasterUrl === "string"
      ? { default: broadcasterUrl }
      : broadcasterUrl;

  return new PrivacyPoolsV1Protocol(host, {
    ...params,
    relayersList,
  });
}) satisfies CreatePluginFn<
  PPv1Instance,
  PPv1PluginParameters | PPv1PluginWithMnemonicParameters
>;
