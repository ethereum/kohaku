import { describe, expect, it } from 'vitest';
import { BaseError, HttpRequestError, RpcRequestError } from 'viem';
import { isExecutionOutOfGas } from '../../src/paymaster/execution-gas-retry';
/** A bundler JSON-RPC rejection, as viem raises it. */
const rejection = (code: number, message: string, data?: unknown) =>
  new RpcRequestError({ url: 'unused', body: { paymaster: '0x1234' }, error: { code, message, ...(data === undefined ? {} : { data }) } });

describe('execution gas retry evidence', () => {
  it('recognizes an execution shortage through viem wrappers without inspecting the request body', () => {
    expect(isExecutionOutOfGas(rejection(-32521, 'Execution out of gas'))).toBe(true);
    expect(isExecutionOutOfGas(rejection(-32521, 'callGasLimit is too low'))).toBe(true);
    expect(isExecutionOutOfGas(new BaseError('wrapped', { cause: rejection(-32521, 'Execution out of gas') }))).toBe(true);
  });

  it.each(['out of gas', 'validation out of gas', 'AA23 reverted: out of gas', 'AA33 out of gas', 'paymaster validation out of gas', 'intrinsic gas too low', 'gas required exceeds allowance', 'insufficient funds', 'execution reverted with reason: out of gas'])('does not retry %s', message => {
    expect(isExecutionOutOfGas(rejection(-32521, message))).toBe(false);
  });

  it.each([
    ['a validation-phase code', rejection(-32500, 'Execution out of gas')],
    ['an invalid-params code', rejection(-32602, 'callGasLimit is too low')],
    ['a plain error', new Error('Execution out of gas')],
    ['an HTTP error', new HttpRequestError({ url: 'unused', status: 502, details: 'Execution out of gas' })],
    ['a string', 'Execution out of gas'],
  ])('does not retry the out-of-gas words from %s', (_case, error) => {
    expect(isExecutionOutOfGas(error)).toBe(false);
  });

  it('does not retry an execution revert that is not out of gas', () => {
    expect(isExecutionOutOfGas(rejection(-32521, 'UserOperation reverted during execution phase'))).toBe(false);
  });

  it('rejects nonempty revert data and unknown failures', () => {
    expect(isExecutionOutOfGas(rejection(-32521, 'Execution out of gas', '0x1234'))).toBe(false);
    expect(isExecutionOutOfGas(Object.assign(rejection(-32521, 'Execution out of gas'), { data: { data: '0x1234' } }))).toBe(false);
    expect(isExecutionOutOfGas(rejection(-32521, 'Unknown internal error'))).toBe(false);
  });
});
