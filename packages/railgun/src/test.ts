import { Eip155ChainId } from "@kohaku-eth/plugins";
import { Broadcasters } from "./broadcasters";


async function test() {
    const broadcasters = await Broadcasters.create(new Eip155ChainId(1));
}

test()