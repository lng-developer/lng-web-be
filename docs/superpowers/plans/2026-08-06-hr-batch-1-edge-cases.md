# HR Batch 1 Edge Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix approved Employee Profile and Staff Provisioning edge cases while preserving the `123456` provisioning password.

**Architecture:** Keep validation in Joi validators, orchestration in HR services, persistence in repositories, and cross-module writes through public ports. Reuse Media asset discard and Organization membership repository behavior; add only the missing public deactivation port.

**Tech Stack:** Node.js, CommonJS, Joi, Mongoose transactions, Jest.

## Global Constraints

- Keep `createProvisionedAccount()` password `123456` unchanged.
- Provisioned HR profiles always start as `PROBATION`.
- Cross-module calls use `public.js` only.
- Use TDD and the narrowest meaningful test during each task.
- Run the 12-suite Batch 1 verification once after implementation stabilizes.

---

### Task 1: Provisioning contract and date validation

**Files:**
- Modify: `src/modules/hr/validators/staffProvisioning.validator.js`
- Modify: `src/modules/hr/validators/employeeProfile.validator.js`
- Modify: `src/modules/hr/services/employeeProfile.service.js`
- Test: `src/test/hr/validators/staffProvisioning.validator.test.js`
- Test: `src/test/hr/validators/employeeProfile.validator.test.js`
- Test: `src/test/hr/services/employeeProfile.service.test.js`

**Interfaces:**
- Produces: validated provisioning payload without caller-controlled `status`; boundary validation plus service validation of the merged current/profile patch date state.

- [ ] Add failing tests proving provisioning rejects a supplied `status`, defaults output behavior to no status field, and rejects `probationEndDate < startDate`.
- [ ] Add failing tests proving profile create/update rejects `probationEndDate < startDate`, `endDate < startDate`, and `contractEndDate < contractStartDate` when both dates are present.
- [ ] Add a failing service test updating only an end date to before the profile's persisted start date.
- [ ] Run `npx jest src/test/hr/validators/staffProvisioning.validator.test.js src/test/hr/validators/employeeProfile.validator.test.js src/test/hr/services/employeeProfile.service.test.js --runInBand`; confirm the new assertions fail for missing rules.
- [ ] Mark provisioning `status` as `Joi.forbidden()`, add Joi `.custom()` boundary checks, and add a small service assertion over `{ ...current, ...patch }` before profile persistence.
- [ ] Re-run the three targeted tests and confirm green.

### Task 2: Fixed provisioning lifecycle and leave year

**Files:**
- Modify: `src/modules/hr/services/staffProvisioning.service.js`
- Test: `src/test/hr/services/staffProvisioning.service.test.js`
- Test: `src/test/hr/services/staffProvisioning.persistence.test.js`

**Interfaces:**
- Consumes: validated `startDate` and no caller status from Task 1.
- Produces: profile status `hrEmployeeStatuses.PROBATION`; annual balance year `new Date(startDate).getUTCFullYear()`.

- [ ] Add failing service assertions using a non-current start year and expecting `PROBATION` plus that start year in `ensureBalance()` and the DTO.
- [ ] Run the two provisioning service tests and confirm failure shows current-year/caller-status behavior.
- [ ] Import `hrEmployeeStatuses`, persist `PROBATION`, and derive the leave year from `payload.startDate`.
- [ ] Re-run the provisioning service tests and confirm green.

### Task 3: Organization membership synchronization

**Files:**
- Modify: `src/modules/organization/services/organization.service.js`
- Modify: `src/modules/organization/public.js`
- Modify: `src/modules/hr/repositories/employeeProfile.repository.js`
- Modify: `src/modules/hr/services/employeeProfile.service.js`
- Test: `src/test/organization/services/organization.service.test.js`
- Test: `src/test/hr/repositories/employeeProfile.repository.test.js`
- Test: `src/test/hr/services/employeeProfile.service.test.js`

**Interfaces:**
- Produces: `organization.public.deactivateTeamMembership(accountId, { session })`; `employeeProfileRepository.updateById(profileId, patch, { session } = {})`.

- [ ] Add failing Organization test expecting `deactivateTeamMembership()` to call the existing `deactivateActiveByAccountId()` repository method with the transaction session.
- [ ] Add failing HR tests expecting team move to call `syncTeamMembership()` and team clearing to call `deactivateTeamMembership()`, both in the same session passed to profile update.
- [ ] Run the three targeted test files and confirm missing port/session behavior fails.
- [ ] Expose the minimal Organization service/public port, add optional repository session, and wrap only team-changing profile updates in a Mongoose transaction.
- [ ] Re-run the three targeted tests and confirm green.

### Task 4: Avatar content validation and asset cleanup

**Files:**
- Modify: `src/modules/hr/services/employeeProfile.service.js`
- Test: `src/test/hr/services/employeeProfile.service.test.js`

**Interfaces:**
- Consumes: `media.public.discardUnattachedAsset(assetId, expectedMetadata, reason)`.
- Produces: signature-validated avatar replacement with cleanup metadata `{ source: 'HR_AVATAR', profileId }`.

- [ ] Add failing tests for spoofed PNG bytes, cleanup of a newly stored asset after profile update failure, and cleanup of the previous asset after success.
- [ ] Run the employee profile service test and confirm all three new cases fail for the expected missing behavior.
- [ ] Add minimal JPEG/PNG/WebP signature checks; use `discardUnattachedAsset()` best-effort without replacing the primary failure; discard the old asset only after the new reference persists.
- [ ] Re-run the employee profile service test and confirm green.

### Task 5: Idempotent delete and restore

**Files:**
- Modify: `src/modules/hr/services/employeeProfile.service.js`
- Test: `src/test/hr/services/employeeProfile.service.test.js`

**Interfaces:**
- Produces: repeated delete/restore returns the current DTO without repository mutation or audit write.

- [ ] Add failing tests for deleting `isDeleted: true` and restoring `isDeleted: false`, asserting no mutation and no audit record.
- [ ] Run the employee profile service test and confirm current code performs the mutation.
- [ ] Return the current DTO early for both no-op states.
- [ ] Re-run the employee profile service test and confirm green.

### Task 6: Batch verification and implementation commit

**Files:**
- Verify all files changed in Tasks 1-5.

**Interfaces:**
- Produces: one reviewed implementation commit on `fix/auth-last-super-admin-guard`.

- [ ] Run `node -c` for every changed JavaScript file.
- [ ] Run the same 12 targeted Batch 1 suites used for the baseline; expect `62+` tests and zero failures.
- [ ] Run `npm run test:organization -- --runInBand` because Task 3 changes an Organization public port.
- [ ] Run `npm run test:architecture -- --runInBand` because cross-module public contracts changed.
- [ ] Run `git diff --check` and inspect `git diff` for unrelated changes or leaked secrets.
- [ ] Commit production and test changes with `fix(hr): harden profile and provisioning edge cases`.
