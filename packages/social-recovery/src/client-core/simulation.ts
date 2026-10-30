import { CLIENT_CORE_SIMULATION_FROM } from '../constants';
import { decodeRevert } from '../errors';
import { assertArray, assertBool, assertBytes, assertObject, checkedBlock, lowerHex, normalizeAddress } from '../formats/guards';
import {
  isProviderRevert,
  SENDERS,
  type Address,
  type ClientConfiguration,
  type Hex,
  type IProvider,
  type PinnedBlock,
  type PreparedBatch,
  type PreparedCall,
  type PrepareOptions,
  type Sender,
  type SimulationResult,
} from '../interfaces';
import type { CheckedCall } from '../types/client-core';

/** Refuses a sender the prepared records do not name. */
function assertSender(value: unknown, name: string): asserts value is Sender {
  if (!(SENDERS as readonly unknown[]).includes(value)) throw new TypeError(`${name} must be one of ${SENDERS.join(', ')}`);
}

/** Refuses a prepared record that is neither a call nor a batch. */
function assertKind(value: unknown, name: string): asserts value is 'call' | 'batch' {
  if (value !== 'call' && value !== 'batch') throw new TypeError(`${name} must be 'call' or 'batch'`);
}

/**
 * The call's target checksummed and data lower-cased, refusing a malformed sender, target or data, and any value but
 * zero, since a simulation sends none.
 */
function checkedCall(call: unknown, name: string): CheckedCall {
  assertObject(call, name);

  const { sender, target, data, value } = call as Partial<Record<keyof PreparedCall, unknown>>;

  assertSender(sender, `${name}.sender`);

  const checkedTarget = normalizeAddress(target, `${name}.target`);

  assertBytes(data, `${name}.data`);

  if (value !== 0n) throw new TypeError(`${name}.value must be 0n`);

  return { sender, target: checkedTarget, data: lowerHex(data) };
}

/** The address a sender's simulation runs from, for a sender already checked. */
const fromFor = (sender: Sender, account: Address, options: PrepareOptions | undefined): Address => {
  if (sender === 'account') return normalizeAddress(account, 'account');

  return options?.from === undefined ? CLIENT_CORE_SIMULATION_FROM : normalizeAddress(options.from, 'options.from');
};

/**
 * The address a call's simulation runs from: the account for a call the account sends, whatever `options.from` says;
 * else `options.from`, or `CLIENT_CORE_SIMULATION_FROM` where it is omitted.
 */
export function simulationFrom(call: PreparedCall, account: Address, options?: PrepareOptions): Address {
  assertObject(call, 'call');
  assertSender(call.sender, 'call.sender');

  return fromFor(call.sender, account, options);
}

/** One `eth_call` of checked values at the block number; a revert comes back decoded, any other failure rejects. */
async function simulateChecked(provider: IProvider, target: Address, data: Hex, from: Address, at: number): Promise<SimulationResult> {
  try {
    await provider.call(target, data, from, at);
  } catch (thrown) {
    if (!isProviderRevert(thrown)) throw thrown;

    return { success: false, from, error: decodeRevert(thrown.data) };
  }

  return { success: true };
}

/** One `eth_call` of the prepared call at the block; a revert comes back decoded and any other failure rejects as itself. */
export async function simulateCall(
  provider: IProvider,
  call: PreparedCall,
  from: Address,
  block: PinnedBlock,
): Promise<SimulationResult> {
  const { target, data } = checkedCall(call, 'call');
  const sender = normalizeAddress(from, 'from');
  const pinned = checkedBlock(block, 'block');

  return await simulateChecked(provider, target, data, sender, pinned.number);
}

/** Whether two checked blocks are the same block. */
const sameBlock = (left: PinnedBlock, right: PinnedBlock): boolean => left.number === right.number && left.hash === right.hash;

/** Every call of the record checked, a batch call pinned to another block than the batch's refused. */
function checkedCalls(prepared: PreparedCall | PreparedBatch, block: PinnedBlock): CheckedCall[] {
  if (prepared.kind === 'call') return [checkedCall(prepared, 'prepared')];

  assertArray(prepared.calls, 'prepared.calls');

  const checked: CheckedCall[] = [];

  for (let index = 0; index < prepared.calls.length; index += 1) {
    const call = prepared.calls[index];
    const name = `prepared.calls[${index}]`;

    checked.push(checkedCall(call, name));

    if (!sameBlock(checkedBlock((call as PreparedCall).block, `${name}.block`), block)) {
      throw new TypeError(`${name} is pinned to another block than the batch`);
    }
  }

  return checked;
}

/**
 * The prepared record with a simulation on its call, or on every call of the batch one after the other in list order,
 * all at the record's block; unchanged where `options.simulate`, or else the configuration's default, is false.
 * The record is checked whether or not it is simulated: a malformed call, or a batch call pinned to another block than
 * the batch's, throws a `TypeError`. Every simulation address is resolved before the first call is simulated.
 */
export async function simulatePrepared<P extends PreparedCall | PreparedBatch>(
  provider: IProvider,
  prepared: P,
  account: Address,
  configuration: Pick<ClientConfiguration, 'simulate'>,
  options?: PrepareOptions,
): Promise<P> {
  assertObject(prepared, 'prepared');
  assertKind(prepared.kind, 'prepared.kind');
  assertObject(configuration, 'configuration');

  if (options?.simulate !== undefined) assertBool(options.simulate, 'options.simulate');
  else assertBool(configuration.simulate, 'configuration.simulate');

  const block = checkedBlock(prepared.block, 'prepared.block');
  const checked = checkedCalls(prepared, block);

  if (!(options?.simulate ?? configuration.simulate)) return prepared;

  const froms = checked.map(({ sender }) => fromFor(sender, account, options));
  const simulations: SimulationResult[] = [];

  for (const [index, { target, data }] of checked.entries()) {
    simulations.push(await simulateChecked(provider, target, data, froms[index] as Address, block.number));
  }

  if (prepared.kind === 'call') return { ...prepared, simulation: simulations[0] } as P;

  return { ...prepared, calls: prepared.calls.map((call, index) => ({ ...call, simulation: simulations[index] })) } as P;
}
