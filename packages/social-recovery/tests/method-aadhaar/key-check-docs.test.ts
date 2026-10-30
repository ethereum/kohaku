import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsDocOf, SRC_ROOT } from '../helpers/source';

const STACK = join(SRC_ROOT, 'method-aadhaar', 'stack.ts');

describe('the default stack\'s key check, documented', () => {
  it.each(['signedByModeKey', 'coreStack'])('%s says an unknown key outside test mode is left to the chain as not-judged', (name) => {
    const doc = jsDocOf(STACK, name);

    expect(doc).toMatch(/test mode/i);
    expect(doc).toContain('not-judged');
  });

  it('signedByModeKey says test mode is for the peer\'s test QR and names the rotation the peer follows only with a release', () => {
    const doc = jsDocOf(STACK, 'signedByModeKey');

    expect(doc).toMatch(/test QR/);
    expect(doc).toContain('setTrustedKeys');
    expect(doc).toMatch(/release/);
  });

  it('coreStack says signedAt imports the peer without init', () => {
    const doc = jsDocOf(STACK, 'coreStack');

    expect(doc).toContain('signedAt');
    expect(doc).toContain('init');
  });
});
