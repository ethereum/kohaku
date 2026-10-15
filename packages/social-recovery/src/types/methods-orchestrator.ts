import type { Ctx, PaymentOrder } from '../interfaces';
import type { CancellationMembers } from './formats';

/** The members a request's digest closes over, its digest version always named. */
export type RequestMembers = CancellationMembers & { readonly digestVersion: string };

/** A request checked whole: the ctx an implementation reads, with the converted members its digest closes over. */
export type CheckedRequest = {
  readonly ctx: Ctx;
  readonly members: RequestMembers;
  /** The opening request's order; absent for a cancellation. */
  readonly order: PaymentOrder | undefined;
};

/** A request whose kind, version or purpose this build does not read, with the message a throwing member raises for it. */
export type UnreadRequest = {
  readonly unread: string;
};
