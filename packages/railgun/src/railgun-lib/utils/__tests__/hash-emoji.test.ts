import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { emojiHash } from '../hash-emoji';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('hash-emoji', () => {
  it('Should hash to an emoji', () => {
    expect(
      emojiHash('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 2),
    ).to.equal('🔮🕊️');
  });
});
