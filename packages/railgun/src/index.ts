import { initialize } from './init'

await initialize();
export type { RGPrivateOperation, RGInstance, RGBroadcaster } from './plugin'
export { RailgunPlugin, createRailgunPlugin } from './plugin'