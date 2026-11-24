// Consumer compile check: factory users can select a shield's deposit index without casts.
import { createPPv1Plugin, type PPv1Instance, type PPv1LegacyInstance, type PPv1ShieldOptions } from '../../src';

declare const protocol: PPv1Instance;
declare const legacy: PPv1LegacyInstance;
declare const factory: ReturnType<typeof createPPv1Plugin>;
const asset = { asset: { __type: 'erc20', contract: '0x0000000000000000000000000000000000000001' }, amount: 1n } as const;
const options: PPv1ShieldOptions = { depositIndex: 17 };

for (const instance of [protocol, legacy, factory]) {
  void instance.prepareShield(asset);
  void instance.prepareShield(asset, options);
  void instance.prepareShield(asset, '0x0000000000000000000000000000000000000002');
  // @ts-expect-error A deposit index is a number.
  void instance.prepareShield(asset, { depositIndex: '17' });
}
