const mongoose = require('mongoose');
const { generateRandomToken, hashPassword } = require('../../../shared/utils/crypto');
const accountRepository = require('../repositories/account.repository');
const accessAssignmentRepository = require('../repositories/accessAssignment.repository');
const permissionRepository = require('../repositories/permission.repository');
const roleRepository = require('../repositories/role.repository');
const userProfileRepository = require('../repositories/userProfile.repository');
const {
  accountStatuses,
  accessAssignmentStatuses,
} = require('../constants/auth.constants');

function ids(values = []) {
  return values.map(String).sort();
}

function sameValue(left, right) {
  if (left instanceof Date || right instanceof Date) {
    return new Date(left || 0).getTime() === new Date(right || 0).getTime();
  }
  return String(left ?? '') === String(right ?? '');
}

function profilePayload(item) {
  return Object.fromEntries(Object.entries({
    email: item.email,
    fullName: item.fullName,
    employeeCode: item.employeeCode,
    phone: item.phone,
    avatarUrl: item.avatarUrl,
    personalEmail: item.personalEmail,
    dateOfBirth: item.dateOfBirth,
    gender: item.gender ? String(item.gender).toLowerCase() : null,
    address: item.address,
  }).filter(([, value]) => value !== undefined));
}

function profileMatches(profile, payload) {
  return profile && Object.entries(payload).every(([key, value]) => sameValue(profile[key], value));
}

function assignmentMatches(existing, expected) {
  return existing.some((current) => (
    String(current.roleId) === String(expected.roleId)
    && current.scopeType === expected.scopeType
    && sameValue(current.scopeId, expected.scopeId)
    && ids(current.overridePermissions || []).join(',') === ids(expected.overridePermissions || []).join(',')
  ));
}

async function resolveAssignments(item) {
  const assignments = item.roleDecision?.assignments || [];
  const roleCodes = [...new Set(assignments.map((entry) => entry.roleCode))];
  const roles = await Promise.all(roleCodes.map((code) => roleRepository.findByCode(code)));
  const roleByCode = new Map(roles.filter(Boolean).map((role) => [role.code, role]));
  const missingRole = roleCodes.find((code) => !roleByCode.has(code));
  if (missingRole) return { error: { reasonCode: 'TARGET_ROLE_NOT_FOUND', detail: missingRole } };

  const permissionCodes = [...new Set(assignments.flatMap((entry) => entry.overridePermissionCodes || []))];
  const permissions = await permissionRepository.listByCodes(permissionCodes);
  const permissionByCode = new Map(permissions.map((permission) => [permission.code, permission]));
  const missingPermission = permissionCodes.find((code) => !permissionByCode.has(code));
  if (missingPermission) return { error: { reasonCode: 'TARGET_PERMISSION_NOT_FOUND', detail: missingPermission } };

  return {
    assignments: assignments.map((entry) => ({
      roleId: roleByCode.get(entry.roleCode)._id,
      roleCode: entry.roleCode,
      scopeType: entry.scopeType,
      scopeId: entry.scopeId || null,
      overridePermissions: entry.overridePermissionCodes
        ? entry.overridePermissionCodes.map((code) => permissionByCode.get(code)._id)
        : undefined,
    })),
  };
}

async function inspectIdentity(item, expectedAssignments) {
  const account = await accountRepository.findByNormalizedEmail(item.email);
  const accountId = account?._id || item.accountId;
  const [profile, profileByEmail, profileByCode, assignmentResult] = await Promise.all([
    account ? userProfileRepository.findByAccountId(accountId) : null,
    userProfileRepository.findByEmail(item.email),
    item.employeeCode ? userProfileRepository.findByEmployeeCode(item.employeeCode) : null,
    account ? accessAssignmentRepository.list({ accountId, status: accessAssignmentStatuses.ACTIVE, page: 1, limit: 100 }) : { items: [] },
  ]);
  if (profileByEmail && String(profileByEmail.accountId) !== String(accountId)) {
    return { error: { reasonCode: 'USER_PROFILE_EMAIL_CONFLICT' } };
  }
  if (profileByCode && String(profileByCode.accountId) !== String(accountId)) {
    return { error: { reasonCode: 'EMPLOYEE_CODE_CONFLICT' } };
  }
  const payload = profilePayload(item);
  const unchanged = Boolean(account)
    && profileMatches(profile, payload)
    && expectedAssignments.every((expected) => assignmentMatches(assignmentResult.items, expected));
  return { account, accountId, profile, payload, unchanged };
}

async function persistIdentity(item, state, assignments) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      let account = state.account;
      if (!account) {
        const { passwordHash, passwordSalt } = await hashPassword(generateRandomToken(48));
        account = await accountRepository.create({
          _id: state.accountId,
          email: item.email,
          normalizedEmail: item.email,
          passwordHash,
          passwordSalt,
          sessions: [],
          tokenVersion: 0,
          status: accountStatuses.INACTIVE,
        }, { session });
      }
      if (state.profile) {
        await userProfileRepository.updateByAccountId(account._id, state.payload, { session });
      } else {
        await userProfileRepository.create({ accountId: account._id, ...state.payload }, { session });
      }
      for (const assignment of assignments) {
        await accessAssignmentRepository.upsertActiveScopedRole({
          accountId: account._id,
          ...assignment,
        }, { session });
      }
    });
  } finally {
    await session.endSession();
  }
}

async function migrateLegacyIdentities(items = [], { apply = false } = {}) {
  const migrated = [];
  const skippedRows = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const item of items) {
    const resolved = await resolveAssignments(item);
    if (resolved.error) {
      skippedRows.push({ sourceId: item.sourceId, sourceAccountId: item.sourceAccountId, legacyRole: item.roleDecision?.legacyRole || null, ...resolved.error });
      continue;
    }
    const state = await inspectIdentity(item, resolved.assignments);
    if (state.error) {
      skippedRows.push({ sourceId: item.sourceId, sourceAccountId: item.sourceAccountId, legacyRole: item.roleDecision?.legacyRole || null, ...state.error });
      continue;
    }
    const wouldCreate = !state.account;
    const outcome = state.unchanged ? 'UNCHANGED' : wouldCreate ? 'WOULD_CREATE' : 'WOULD_UPDATE';
    if (apply && !state.unchanged) {
      try {
        await persistIdentity(item, state, resolved.assignments);
        if (wouldCreate) inserted += 1;
        else updated += 1;
      } catch (error) {
        failed += 1;
        skippedRows.push({
          sourceId: item.sourceId,
          sourceAccountId: item.sourceAccountId,
          legacyRole: item.roleDecision?.legacyRole || null,
          reasonCode: 'IDENTITY_WRITE_FAILED',
          detail: error.code === 11000 ? 'DUPLICATE_KEY' : error.message,
        });
        continue;
      }
    } else if (state.unchanged) {
      unchanged += 1;
    }
    migrated.push({
      sourceId: item.sourceId,
      sourceAccountId: item.sourceAccountId,
      accountId: String(state.accountId),
      email: item.email,
      roleDecision: item.roleDecision,
      outcome: apply && !state.unchanged ? (wouldCreate ? 'CREATED' : 'UPDATED') : outcome,
    });
  }

  return {
    read: items.length,
    mapped: migrated.length,
    inserted,
    updated,
    unchanged,
    skipped: skippedRows.length,
    failed,
    skippedRows,
    items: migrated,
  };
}

module.exports = { migrateLegacyIdentities };
