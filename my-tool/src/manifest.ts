import { defineManifest } from "@opensea/tool-sdk";

export const manifest = defineManifest({
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
  name: "arkhe-gateway",
  description: "ARKHE HTTP GATEWAY — Bridge Real (Substrato 870-G). Rotas /publish e /verify unificadas para todo o ecossistema ARKHE.",
  endpoint: "http://localhost:8700/publish",
  inputs: {
    type: "object",
    properties: {
      action: { type: "string", description: "O tipo de ação. (ex: ANCHOR, DECREE, DEPLOY, SIMULATE, SCAN, PROPOSE)" },
      substrate: { type: "string", description: "O substrato." },
      sequence: { type: "string", description: "Sequência binária (opcional)" },
    },
    required: ["substrate", "action"],
  },
  outputs: {
    type: "object",
    properties: {
      status: { type: "string" },
      tx_hash: { type: "string" },
      seal: { type: "string" },
      phi_c: { type: "number" },
      ghost_threshold: { type: "number" },
      metadata: { type: "object" },
      registry_index: { type: "integer" },
      verification_url: { type: "string" }
    },
  },
  creatorAddress: "0x0000000000000000000000000000000000000000",
});