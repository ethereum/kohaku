---
"@kohaku-eth/tornado-cash": patch
---

Try other available note combinations when largest-first withdrawal selection cannot reach the requested gross total exactly. This fixes requests such as 0.12 ETH from four 0.03 ETH notes when a 0.1 ETH note would otherwise block selection. Successful existing selections and fee handling are unchanged.
