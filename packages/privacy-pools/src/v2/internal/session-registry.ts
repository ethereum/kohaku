import type { PoolSession } from "@0xbow-io/privacy-pools-v2-sdk";
import type { PPv2Instance } from "../interfaces/plugin.interface";

/**
 * Links a plugin instance to its SDK `PoolSession` without exposing the session on
 * the public `PPv2Instance` type (which would breach the `@kohaku-eth/*`-only
 * boundary, SC-001). `createPPv2Plugin` registers the instance; `createPPv2Broadcaster`
 * looks it up so both share one session — the basis for FR-053 (relay persists note
 * updates through the plugin-owned note manager). A `WeakMap` keeps it leak-free.
 */
const sessions = new WeakMap<PPv2Instance, PoolSession>();

/** Link an instance to its session; called only by `createPPv2Plugin`. */
export function registerSession(instance: PPv2Instance, session: PoolSession): void {
    sessions.set(instance, session);
}

/** The session registered for an instance, or `undefined` if it never was. */
export function getSession(instance: PPv2Instance): PoolSession | undefined {
    return sessions.get(instance);
}
