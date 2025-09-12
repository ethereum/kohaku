import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { initCurve25519Promise, scalarMultiplyWasmFallbackToJavascript } from '../scalar-multiply';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('scalar-multiply', () => {
  it('Should throw when y coordinate is invalid', async () => {
    await initCurve25519Promise;
    const point = new Uint8Array([
      122, 247, 122, 242, 41, 199, 22, 160, 168, 36, 83, 200, 250, 170, 208, 189, 116, 82, 157, 77,
      82, 192, 120, 42, 62, 13, 148, 15, 17, 141, 227, 22,
    ]);
    const scalar = 10928541092740192740192704n;
    expect(() => scalarMultiplyWasmFallbackToJavascript(point, scalar)).to.throw(
      /scalarMultiply failed/,
    );
  });
});
