---
"@kohaku-eth/tornado-cash": patch
"@kohaku-eth/privacy-pools": patch
---

Paymaster withdrawals call the `tailCalls` callback once per preparation and reuse its calls for every estimate and the signed operation. Before, the callback ran again on every rebuild, so a callback that answered differently could produce signed calls that were never estimated and run out of gas after the payout reached the sender.

The callback must resolve to an array of `{ to, value, data }` calls with a valid address, a non-negative bigint `value` and hex `data`. Anything else stops preparation before estimation or proving. The SDK copies the calls, so later changes to the returned objects have no effect.
