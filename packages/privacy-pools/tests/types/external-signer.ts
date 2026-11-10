// Consumer compile check: factory users can select external signing without casts.
import { analyzePPv1Withdrawal, createPPv1Plugin, type DelegatorAccount, type PPv1Instance, type PPv1LegacyInstance, type PPv1WithdrawalAnalysis } from '../../src';

declare const protocol: PPv1Instance;
declare const legacy: PPv1LegacyInstance;
declare const signer: DelegatorAccount;
declare const factory: ReturnType<typeof createPPv1Plugin>;
declare const notes: Awaited<ReturnType<PPv1Instance['notes']>>;
const asset = { asset: { __type: 'erc20', contract: '0x0000000000000000000000000000000000000001' }, amount: 1n } as const;
const recipient = '0x0000000000000000000000000000000000000002';
const analysis: PPv1WithdrawalAnalysis = analyzePPv1Withdrawal(notes, BigInt(asset.asset.contract), asset.amount, { batch: true });

void analysis.needsObfuscation;
void analysis.maxObfuscatedAmount;

for (const instance of [protocol, legacy, factory]) {
  void instance.prepareUnshield(asset, recipient, { mode: 'paymaster', delegation: { mode: 'external', signer }, batch: true, refundRecipient: recipient });
  void instance.prepareUnshield(asset, recipient, { mode: 'paymaster', batch: true, obfuscateAmounts: true });
  void instance.prepareUnshield(asset, recipient, { mode: 'paymaster', delegation: { mode: 'external', signer }, refundRecipient: recipient, exact: {} });
  void instance.prepareUnshield(asset, recipient);
  // @ts-expect-error A paymaster delegator is not a relayer-mode option.
  void instance.prepareUnshield(asset, recipient, { mode: 'relayer', delegation: { mode: 'external', signer } });
  void instance.prepareUnshield(asset, recipient, { mode: 'relayer', obfuscateAmounts: false });
  // @ts-expect-error External delegation needs both host signing callbacks.
  void instance.prepareUnshield(asset, recipient, { mode: 'paymaster', delegation: { mode: 'external', signer: { address: signer.address } } });
}
