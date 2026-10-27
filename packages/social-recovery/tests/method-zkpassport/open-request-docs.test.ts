import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsDocOf, SRC_ROOT } from '../helpers/source';

const SESSION = join(SRC_ROOT, 'method-zkpassport', 'session.ts');
const METHOD = join(SRC_ROOT, 'method-zkpassport', 'zkpassport-method.ts');

describe('the openRequest note', () => {
  it.each([
    ['opener', SESSION],
    ['enrollInput', METHOD],
    ['signingInput', METHOD],
  ])('%s says a second scan is refused by the bridge with no event, and that cancel() ends the wait', (name, file) => {
    const doc = jsDocOf(file, name);

    expect(doc).toMatch(/second handshake/);
    expect(doc).toMatch(/no event/);
    expect(doc).toContain('cancel()');
  });

  it('opener names the bridge and the peer that leaves its error unheard', () => {
    const doc = jsDocOf(SESSION, 'opener');

    expect(doc).toContain('@obsidion/bridge');
    expect(doc).toContain('@zkpassport/sdk');
  });
});
