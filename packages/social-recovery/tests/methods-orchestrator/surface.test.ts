import { describe, expect, it } from 'vitest';
import * as core from '../../src/index';
import type { IMethodsOrchestrator } from '../../src/index';
import { orchestratorOver } from './doubles';

describe('the orchestrator on the public surface', () => {
  it('MethodsOrchestrator is a class exported from the core entry', () => {
    expect(typeof core.MethodsOrchestrator).toBe('function');
  });

  it('an instance satisfies IMethodsOrchestrator with all six members', () => {
    const orchestrator: IMethodsOrchestrator = orchestratorOver([]);

    for (const member of ['describeRequest', 'verify', 'signingInput', 'replyFrom', 'enrollInput', 'configFrom'] as const) {
      expect(typeof orchestrator[member]).toBe('function');
    }
  });
});
