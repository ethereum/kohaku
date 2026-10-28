/** The gathering record's kind. */
export const GATHERING_KIND = 'gathering';

/** The gathering record's version this build writes and reads. */
export const GATHERING_VERSION = 1;

/** The approver request's kind. */
export const GATHERING_REQUEST_KIND = 'recovery-proof-request';

/** The approver request's version this build writes. */
export const GATHERING_REQUEST_VERSION = 1;

/** The approver reply's kind. */
export const GATHERING_REPLY_KIND = 'recovery-proof-reply';

/** The approver reply's version this build reads. */
export const GATHERING_REPLY_VERSION = 1;

/** Thrown where a gathering record's kind or version is not the one this build reads. */
export const GATHERING_UNREAD_RECORD_MESSAGE = 'gathering record: kind or version this build does not read';

/** Thrown by `order` where the record's window has passed at the moment given. */
export const GATHERING_WINDOW_PASSED_MESSAGE = 'gathering: the window has passed at this moment';

/** Thrown by `order` where the filed replies, or the selected ones, do not satisfy the rule. */
export const GATHERING_RULE_UNSATISFIED_MESSAGE = 'gathering: the replies do not satisfy the rule';

/** Thrown by `order` where a selection names a place no filed reply fills. */
export const GATHERING_SELECTION_UNFILLED_MESSAGE = 'gathering: the selection names a place no reply fills';
