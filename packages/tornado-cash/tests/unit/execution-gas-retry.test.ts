import { describe, expect, it } from 'vitest';
import { RpcRequestError } from 'viem';
import { isExecutionOutOfGas } from '../../src/paymaster/execution-gas-retry';
describe('execution gas retry evidence', () => {
  it('recognizes an execution shortage through viem wrappers without inspecting the request body', () => {
    const error = new RpcRequestError({ url: 'unused', body: { paymaster: '0x1234' }, error: { code: -32521, message: 'Execution out of gas' } });
    expect(isExecutionOutOfGas(error)).toBe(true);
    expect(isExecutionOutOfGas(new Error('callGasLimit is too low'))).toBe(true);
  });
  it.each(['out of gas', 'validation out of gas', 'AA23 reverted: out of gas', 'AA33 out of gas', 'paymaster validation out of gas', 'intrinsic gas too low', 'gas required exceeds allowance', 'insufficient funds', 'execution reverted with reason: out of gas'])('does not retry %s', message => {
    expect(isExecutionOutOfGas(new Error(message))).toBe(false);
  });
  it('rejects nonempty revert data and unknown failures', () => {
    expect(isExecutionOutOfGas(Object.assign(new Error('Execution out of gas'), { data: '0x1234' }))).toBe(false);
    expect(isExecutionOutOfGas(Object.assign(new Error('Execution out of gas'), { data: { data: '0x1234' } }))).toBe(false);
    expect(isExecutionOutOfGas(new Error('Unknown internal error'))).toBe(false);
  });
});
