import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { isDefined } from '../is-defined';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('is-defined', () => {
  it('Should return false for undefined/null and true for anything else', () => {
    expect(isDefined(undefined)).to.equal(false);
    expect(isDefined(null)).to.equal(false);
    expect(isDefined('')).to.equal(true);
    expect(isDefined(0)).to.equal(true);
  });
});
