import { z } from "zod";
import { createToolHandler } from "@opensea/tool-sdk";
import { manifest } from "./manifest.js";

const inputSchema = z.object({
  action: z.enum(["ANCHOR", "DECREE", "DEPLOY", "SIMULATE", "SCAN", "PROPOSE"]),
  substrate: z.enum(["870-B", "865", "864", "863", "862", "861", "860", "859"]),
  sequence: z.string().optional(),
});

const outputSchema = z.object({
  status: z.string(),
  tx_hash: z.string(),
  seal: z.string(),
  phi_c: z.number(),
  ghost_threshold: z.number(),
  metadata: z.any(),
  registry_index: z.number(),
  verification_url: z.string(),
});

export const handler = createToolHandler({
  manifest,
  inputSchema,
  outputSchema,
  gates: [],
  handler: async (input, ctx) => {
    const res = await fetch("http://localhost:8700/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json();
    return data;
  },
});