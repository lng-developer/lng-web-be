# HR Demo Profile Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed idempotent HR demo employee profiles so the isolated full-demo chain and gated RBAC integration suite can run without development data.

**Architecture:** A top-level script orchestrates Auth-owned demo Account reads and HR-owned EmployeeProfile writes. It reuses `buildDemoUsers()` as the canonical identity list and exposes dependency-injected functions for focused tests without connecting to MongoDB.

**Tech Stack:** Node.js CommonJS, Mongoose, Jest, existing npm seed scripts.

## Global Constraints

- Never write to the development database during verification.
- Do not seed payroll, attendance, compensation, identity, personal-email, or banking fields.
- Keep Auth and HR production modules independent; cross-module orchestration lives under `src/scripts/`.
- Reuse existing dependencies and demo user definitions.

---

### Task 1: Add the HR demo profile seed and complete the isolated RBAC integration path

**Files:**
- Create: `src/scripts/seedHrDemoProfiles.js`
- Create: `src/test/hr/scripts/seedHrDemoProfiles.test.js`
- Modify: `package.json`
- Modify: `src/modules/auth/scripts/seedDemoUsers.js`
- Modify: `src/test/auth/scripts/seedDemoUsers.test.js`
- Modify: `src/test/auth/integration/rbacDemoAccounts.integration.test.js`

**Interfaces:**
- Consumes: `buildDemoUsers(): DemoUser[]`, Account `find`, EmployeeProfile `bulkWrite`.
- Produces: `buildProfileOperations(users, accounts)`, `seedHrDemoProfiles(dependencies?)`, and npm script `seed:hr:demo-profiles`.

- [ ] **Step 1: Write the failing focused tests**

Test that canonical users map to update-one/upsert operations containing `accountId`, `employeeCode`, `fullName`, `jobTitle`, `workEmail`, active/full-time/onsite status, and no sensitive fields. Test that a missing Account throws before `bulkWrite`, and that the filter is `{ accountId }` for idempotency.

Also extend the Auth seed test to require every Organization member code: Sales `J2506-J2509` and `J2514-J2522`, Design `J2510-J2513` and `J2523-J2530`. Generated fillers must be scoped `USER` records while existing named personas retain their overrides.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm test -- --runInBand src/test/hr/scripts/seedHrDemoProfiles.test.js
```

Expected: fail because `src/scripts/seedHrDemoProfiles.js` does not exist.

- [ ] **Step 3: Implement the minimal orchestration script**

First expand `buildDemoUsers()` with generated missing team members, then the HR script must:

```js
const users = buildDemoUsers();
const accounts = await Account.find({ email: { $in: users.map(({ email }) => email) } }).lean();
const operations = buildProfileOperations(users, accounts);
await EmployeeProfile.bulkWrite(operations, { ordered: true });
```

Each operation uses `updateOne.filter = { accountId }`, `$set` for the approved public demo fields, and `upsert: true`. The CLI wrapper connects and disconnects through the existing database config.

- [ ] **Step 4: Add npm orchestration**

Add:

```json
"seed:hr:demo-profiles": "node src/scripts/seedHrDemoProfiles.js"
```

Change `seed:demo:full` to:

```text
npm run seed:auth:demo-users && npm run seed:hr:demo-profiles && npm run seed:organization:demo && npm run seed:shop:demo
```

- [ ] **Step 5: Verify GREEN and isolated data flow**

Run the focused Jest test, seed `lng_web_be_auth_test`, run Organization and Shop seeds, then run the gated RBAC integration suite with `RUN_DB_RBAC_TESTS=true` against only that database.

- [ ] **Step 6: Run module regression checks**

Run:

```powershell
npm run test:auth -- --runInBand
npm run test:organization -- --runInBand
npm run test:shop -- --runInBand
npm run test:architecture -- --runInBand
git diff --check
```

- [ ] **Step 7: Commit**

```powershell
git add package.json src/scripts/seedHrDemoProfiles.js src/test/hr/scripts/seedHrDemoProfiles.test.js src/test/auth/integration/rbacDemoAccounts.integration.test.js
git commit -m "test(seed): add isolated HR demo profiles"
```
