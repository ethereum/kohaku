import { describe, expect, it } from 'vitest';
import { EVENT_MANAGER_MANAGER_EVENTS, EVENT_MANAGER_METHOD_EVENTS, type Hex } from '../../src/index';
import { byTopic0 } from '../../src/event-manager/by-topic0';
import { TOPIC0 } from './fixture';

const shout = (hex: Hex): Hex => `0x${hex.slice(2).toUpperCase()}`;

describe('byTopic0', () => {
  it('finds the entry whose topic0 is the lower-case topic given', () => {
    expect(byTopic0(EVENT_MANAGER_MANAGER_EVENTS, TOPIC0.SetupCleared)?.event.name).toBe('SetupCleared');
    expect(byTopic0(EVENT_MANAGER_METHOD_EVENTS, TOPIC0.Paused)?.event.name).toBe('Paused');
  });

  it('compares the topic as given, so an upper-case spelling finds nothing', () => {
    expect(byTopic0(EVENT_MANAGER_MANAGER_EVENTS, shout(TOPIC0.SetupCleared))).toBeUndefined();
  });

  it('a missing topic or a topic of another list finds nothing', () => {
    expect(byTopic0(EVENT_MANAGER_MANAGER_EVENTS, undefined)).toBeUndefined();
    expect(byTopic0(EVENT_MANAGER_MANAGER_EVENTS, TOPIC0.Paused)).toBeUndefined();
  });
});
