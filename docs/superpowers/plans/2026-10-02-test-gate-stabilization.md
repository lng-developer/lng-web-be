# Backend Test Gate Stabilization Plan

## Goal

Keep persistence coverage isolated and make the Jest command compatible with the current MongoDB driver without introducing a second database-dependent test path.

## Scope

1. Retain the Node VM-module Jest entrypoint required by the MongoDB driver's ESM loading.
2. Confirm memory Mongo instances are stopped by the tests that create them.
3. Keep the existing CI sharding design; add no cache or script unless measurement demonstrates a real bottleneck.

## Verification

- Targeted persistence regression test.
- `npm run test:architecture`.
- `npm run test:full`.
