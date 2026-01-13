/// <reference path="../../global.d.ts" />
import { babyjub } from '@railgun-community/circomlibjs';

export class Babyjubjub {
  static packPoint = babyjub.packPoint;

  static unpackPoint = babyjub.unpackPoint;
}
