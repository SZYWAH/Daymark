# QA case result template

Use one record for every executed matrix case. A case without a record is `UNVERIFIED`; it must never be inferred as passing from a nearby smoke test.

```yaml
caseId: G-01
status: PASS | FAIL | UNVERIFIED | BLOCKED
severity: P0 | P1 | P2 | P3 | null
fixture: empty | canonical | lineage | link-graph | library-large | sessions | import | none
environment: browser-edge | tauri-windows | node-fake-indexeddb | rust-unit
preconditions:
  - ...
steps:
  - ...
expected:
  - ...
actual:
  - ...
evidence:
  - work/qa/<run-id>/...
reproducibility: "0/0"
notes: ...
```

Safety rules:

- Stop the run immediately on P0.
- `BLOCKED` names the earlier gate and does not count as execution.
- Browser evidence cannot satisfy a native case.
- A data-layer assertion cannot be reported as UI import or WebView2 performance.
- Mock-server self-tests cannot be reported as Daymark AI integration tests.
