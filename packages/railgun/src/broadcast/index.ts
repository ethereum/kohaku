import type { Broadcaster, BroadcasterParameters } from "@kohaku-eth/plugins/broadcaster";

export type RGBroadcaster = Broadcaster<{
    broadcasterUrl: string;
}>;

export const createRailgunBroadcaster = (params: BroadcasterParameters<RGBroadcaster>): RGBroadcaster => {
    const config = params;

    return {
        async broadcast(operation) {
            
        },
    };
};
