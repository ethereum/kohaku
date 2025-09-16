import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { getGlobalTreePosition } from '../global-tree-position';
import { TREE_MAX_ITEMS } from '../../models/merkletree-types';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('global-tree-position', () => {
  it('Should calculate global tree position', async () => {
    expect(getGlobalTreePosition(0, 0)).to.equal(0n);
    expect(getGlobalTreePosition(1, 0)).to.equal(BigInt(TREE_MAX_ITEMS));
    expect(getGlobalTreePosition(99999, 99999)).to.equal(BigInt(99999 * 65536 + 99999));
  });
});
