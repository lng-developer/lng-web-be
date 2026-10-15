# Execution ledger: 2026-10-15-etsy-flow-regression-tests

- Executing in existing feature branch codex/etsy-extension-provider to test the uncommitted Etsy implementation; no production files changed, no commits requested.
- Preflight: Task 2 and 3 consume Task 1 ephemeral Mongo fixture and real import output IDs.
- MongoMemoryReplSet startup probe passed.
- Tests exercise existing code, so passing characterization tests are expected; no artificial product regression is introduced for RED/GREEN.
- Task 1 verified: actual CSV importer, real repositories, queue services, and public ports; Smarty and queue transport are external test boundaries.
- Ruling: add Node --experimental-vm-modules to the dedicated command. Driver runtime dynamic imports fail inside Jest without it; no driver or production code patched.
- Ruling: run queue processors explicitly rather than Redis workers. Queue persistence side effects remain real; Redis scheduling/retries require separate acceptance coverage.
- Tasks 1-3: 8 persistence cases passed; final focused command passed 111/111 across 8 suites. Architecture passed 22/22. Syntax checks passed.
- Broad repository run was stopped after exceeding 4 GB working memory without finishing; no full-suite green claim. It exposed an outdated order public-port mock in the existing fulfillment E2E contract. Added the missing guard mock only; that suite then passed 11/11 in isolation. The real guard remains exercised by the Etsy persistence tests.
- Related Design/Catalog/Mapping/Production regression: 46 suites, 648/648 tests passed using Node --experimental-vm-modules and --runInBand. Task diff checked; no commit/push or operational restart performed.
- Independent review: no blocking safety issue. Vendor race at the second dispatch guard remains outside persistence coverage; documented rather than claiming live vendor E2E.
- Ruling: seed READY synthetic PSD metadata, not uploaded binary files; upload transport/PSD byte validation is outside this backend lifecycle test and documented.
