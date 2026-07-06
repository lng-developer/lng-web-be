# AI Workflow

Use this workflow when asking Codex or another agent to work in this repository.

## Prompt Shape

Good task prompts include:

```text
Goal:
Context:
Constraints:
Done when:
```

Example:

```text
Goal: Scaffold externalOrderImport boundary under integration.
Context: Follow docs/architecture/ORDER_IMPORT_PIPELINE.md and AGENTS.md.
Constraints: No SP-API. Cross-module communication only through public.js. Do not modify shop.model.js.
Done when: node -c changed JS files, npm run test:architecture -- --runInBand, and targeted tests pass.
```

For catalog work, include:

```text
Context: Follow AGENTS.md and docs/architecture/CATALOG_MODULE.md.
```

## Default Work Loop

1. Read `AGENTS.md`.
2. Inspect current code and docs before proposing changes.
3. Use Codegraph for flow, symbol, and impact questions.
4. Plan before changing code when a task touches multiple modules.
5. Keep edits scoped to the requested module/behavior.
6. Add or update tests in proportion to risk.
7. Run verification commands.
8. Report files changed, commands run, results, and unresolved risks.

## When To Ask For A Plan First

Ask for a plan before implementation when work involves:

- new module boundaries
- data migrations
- destructive DB operations
- public API changes
- RBAC changes
- import pipeline behavior
- cross-module public ports
- state machine changes

## Data Safety

Before any DB mutation:

1. Identify database name from `.env` or runtime config.
2. Report the target database.
3. Take a read-only count/sample when useful.
4. Ask for confirmation before destructive operations.
5. Verify counts or sample documents after the mutation.

## Verification Expectations

Use the narrowest meaningful verification:

```bash
node -c path/to/file.js
npm run test:architecture -- --runInBand
npm run test:auth -- --runInBand
npm run test:organization -- --runInBand
npm run test:shop -- --runInBand
npm test -- --runInBand
```

## Review Expectations

The final response should be concise and include:

- what changed
- where it changed
- commands run and results
- intentionally deferred work
- risks or assumptions

Do not claim success without fresh command output.

## Reusable Agent Instructions

When an agent repeats the same mistake twice, update `AGENTS.md` or a focused architecture doc instead of relying on longer prompts.
