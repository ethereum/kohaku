import { createSelector } from "@reduxjs/toolkit";

import { Deserialize } from "../interfaces/utils.interface";
import { RootState } from "../store";
import { deserialize } from "./serialize.utils";

export const selectEntityMap = <
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SelectorType extends (state: RootState) => [any, any][],
  const TransformFn extends (
    tuple: ReturnType<SelectorType>[number],
  ) => [Deserialize<(typeof tuple)[0]>, Deserialize<(typeof tuple)[1]>],
>(
  mapFn: SelectorType,
  transform: TransformFn = deserialize as TransformFn,
): ((
  state: RootState,
) => Map<ReturnType<TransformFn>[0], ReturnType<TransformFn>[1]>) =>
  createSelector([mapFn], (tuple) => new Map(tuple.map(transform))) as never;
