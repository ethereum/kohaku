import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { binarySearchForString, binarySearchForUpperBoundIndex } from '../search';
import BinarySearchData from './binary-search-data.json';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('search', () => {
  it('Should binary search for index', () => {
    expect(binarySearchForUpperBoundIndex([1, 2, 3], (n) => n < 5)).to.equal(2);
    expect(binarySearchForUpperBoundIndex([1, 2, 3], (n) => n < 4)).to.equal(2);
    expect(binarySearchForUpperBoundIndex([1, 2, 3], (n) => n < 3)).to.equal(1);
    expect(binarySearchForUpperBoundIndex([1, 2, 3], (n) => n < 2)).to.equal(0);
    expect(binarySearchForUpperBoundIndex([1, 2, 3, 4, 5, 6, 7, 8, 9], (n) => n < 7)).to.equal(5);
    expect(binarySearchForUpperBoundIndex([1, 2, 3, 4, 5, 6, 7, 8, 9], (n) => n < 20)).to.equal(8);
    expect(binarySearchForUpperBoundIndex([1, 2, 3, 4, 5, 6, 7, 8, 9], (n) => n < -1)).to.equal(-1);
    expect(binarySearchForUpperBoundIndex([1], (n) => n < 2)).to.equal(0);
    expect(binarySearchForUpperBoundIndex([1], (n) => n < 1)).to.equal(-1);
    expect(binarySearchForUpperBoundIndex([1, 2], (n) => n < 3)).to.equal(1);
    expect(binarySearchForUpperBoundIndex([1, 2, 5, 7, 10000], (n) => n < 3)).to.equal(1);
    expect(binarySearchForUpperBoundIndex([1, 2, 5, 7, 10000], (n) => n > 2)).to.equal(4);
    expect(binarySearchForUpperBoundIndex([1, 2, 5, 7, 10000], (n) => n < 8)).to.equal(3);
    expect(binarySearchForUpperBoundIndex([], (n) => n < 8)).to.equal(-1);
  });

  it('Should binary search large data set', () => {
    const str = '1bb5956c6183d8c42294c6f00ab02b0543268d48c241d7eea59179a887af24de';
    expect(binarySearchForString(BinarySearchData, str, (n) => n.hash ?? '')).to.equal(1522);
    expect(BinarySearchData[1522].hash).to.equal(str);

    expect(binarySearchForString(BinarySearchData, 'ccc', (n) => n.hash ?? '')).to.equal(-1);
  });
});
