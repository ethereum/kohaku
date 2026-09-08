import { decodeAbiParameters, getAddress, parseAbiParameters } from 'viem';
import { describe, expect, it } from 'vitest';

import { encodeFeeData, encodePaymasterData, encodePrivacyPoolAdapterData } from '../../src/paymaster/adapter-data';
import { WithdrawalPayload } from '../../src/relayer/interfaces/relayer-client.interface';
import { WithdrawProveOutput } from '../../src/state/thunks/withdrawThunk';
import { mockedGroth16Proof } from '../utils/mock-prover';

const ADAPTER = '0x00112233445566778899aabbccddeeff00112233' as const;
const RECIPIENT = '0xcccccccccccccccccccccccccccccccccccccccc' as const;
const PAYMASTER = '0xdddddddddddddddddddddddddddddddddddddddd' as const;

const proof: WithdrawProveOutput = {
  proof: mockedGroth16Proof,
  publicSignals: ['1', '2', '3', '4', '5', '6', '7', '8'],
  // mappedSignals is unused by the encoder.
} as unknown as WithdrawProveOutput;

describe('paymaster adapter-data encoding', () => {
  it('encodeFeeData abi-encodes FeeData(recipient, feeRecipient, fee)', () => {
    const encoded = encodeFeeData({ recipient: RECIPIENT, feeRecipient: PAYMASTER, fee: 250n });
    const [decoded] = decodeAbiParameters(
      parseAbiParameters('(address recipient, address feeRecipient, uint256 fee)'),
      encoded,
    );

    expect(getAddress(decoded.recipient)).toBe(getAddress(RECIPIENT));
    expect(getAddress(decoded.feeRecipient)).toBe(getAddress(PAYMASTER));
    expect(decoded.fee).toBe(250n);
  });

  it('encodePaymasterData abi-encodes PaymasterData(adapter, adapterData)', () => {
    const packed = encodePaymasterData(ADAPTER, '0xdeadbeef');
    const [decoded] = decodeAbiParameters(parseAbiParameters('(address adapter, bytes adapterData)'), packed);

    expect(getAddress(decoded.adapter)).toBe(getAddress(ADAPTER));
    expect(decoded.adapterData).toBe('0xdeadbeef');
  });

  it('encodePrivacyPoolAdapterData abi-encodes AdapterData(withdrawal, proof)', () => {
    const withdrawal: WithdrawalPayload = {
      processooor: ADAPTER,
      data: encodeFeeData({ recipient: RECIPIENT, feeRecipient: PAYMASTER, fee: 100n }),
    };

    const adapterData = encodePrivacyPoolAdapterData(withdrawal, proof);
    const [decoded] = decodeAbiParameters(
      parseAbiParameters(
        '((address processooor, bytes data) withdrawal, (uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[8] pubSignals) proof)',
      ),
      adapterData,
    );

    expect(getAddress(decoded.withdrawal.processooor)).toBe(getAddress(ADAPTER));
    expect(decoded.proof.pubSignals.length).toBe(8);
    expect(decoded.proof.pubSignals[0]).toBe(1n);
  });
});
