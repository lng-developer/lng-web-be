# Contributing Guide

This repository uses a strict Git workflow for the Enterprise E-commerce POD FBM backend. Follow these rules exactly unless the team lead approves an exception.

## Branches

```text
main       -> production, do not commit directly
develop    -> feature integration before release

feature/EC-xxx-feature-name
fixbug/EC-xxx-bug-description
hotfix/EC-xxx-urgent-bug
chore/EC-xxx-description
test/EC-xxx-description
release/x.x.x
```

Examples:

```text
feature/EC-101-product-listing
fixbug/EC-312-fix-payment-null
hotfix/EC-400-order-status-stuck
chore/EC-205-upgrade-dependencies
test/EC-310-add-cart-unit-tests
```

Hotfix branches must start from `main`, not `develop`.

## Commit Messages

Format:

```text
<type>(<scope>): <description>
```

Allowed types:

| Type | Use when |
| --- | --- |
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Refactor without behavior change |
| `style` | Formatting or whitespace only |
| `perf` | Performance improvement |
| `test` | Add or update tests |
| `chore` | Config, dependencies, tooling |
| `ci` | CI/CD changes |
| `build` | Build system changes |
| `docs` | Documentation changes |
| `revert` | Revert previous commit |

Common scopes:

```text
integration catalog order production finance media mapping shipment auth audit report vendor-submission
```

Good examples:

```text
feat(order): add normalized Amazon FBM order ingestion
fix(payment): handle missing settlement fee
chore(deps): upgrade mongoose
test(order): add status transition contract tests
```

Bad examples:

```text
fix
update code
sua loi abc
```

## Daily Flow

Start a new task:

```bash
git checkout develop
git pull origin develop
git checkout -b feature/EC-101-task-name
```

Sync every morning with rebase, not merge:

```bash
git fetch origin
git rebase origin/develop
```

Push and create a PR into `develop`:

```bash
git push origin feature/EC-101-task-name
```

## Hotfix Flow

Hotfix starts from `main`:

```bash
git checkout main
git pull origin main
git checkout -b hotfix/EC-400-order-status-stuck
```

After the fix, open a PR into `main`.

After merge into `main`, merge back into `develop`:

```bash
git checkout develop
git pull origin develop
git merge hotfix/EC-400-order-status-stuck
git push origin develop
```

## Pull Requests

Before creating a PR:

- Read the diff yourself.
- Remove debug code and unnecessary `console.log`.
- Confirm there are no hardcoded secrets, API keys, tokens, or private credentials.
- Run local tests relevant to the change.
- Confirm the target branch is correct.

Merge rules:

- At least 1 approval is required.
- Do not self-merge your own PR.
- Delete the branch after merge.

Merge strategy:

- Feature/fixbug into `develop`: Squash and merge.
- Release/hotfix into `main`: Merge commit.
- Do not use Rebase and merge for another person's branch.

## Never Do This

```bash
git push --force origin main
git push --force origin develop
git checkout main && git commit
git checkout develop && git commit
git add .env
```

If a branch has been open for more than 1 week, ask whether it is still active before continuing.
