const mongoose = require('mongoose');
const { generateRandomToken, hashPassword } = require('../../../shared/utils/crypto');
const accountRepository = require('../repositories/account.repository');
const accessAssignmentRepository = require('../repositories/accessAssignment.repository');
const permissionRepository = require('../repositories/permission.repository');
const roleRepository = require('../repositories/role.repository');
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

function assignmentMatches(existing, expected) {
  return existing.some((current) => (
    String(current.roleId) === String(expected.roleId)
    && current.scopeType === expected.scopeType
    && sameValue(current.scopeId, expected.scopeId)
    && ids(current.overridePermissions || []).join(',') === ids(expected.overridePermissions || []).join(',')
  ));
}

async function resolveAssignments(item) {
  if (item.isActiveOrProbation === false) return { assignments: [] };
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
  const [account, plannedIdOwner] = await Promise.all([
    accountRepository.findByEmail(item.email),
    accountRepository.findById(item.accountId),
  ]);
  if (plannedIdOwner && (!account || String(plannedIdOwner._id) !== String(account._id))) {
    return { error: { reasonCode: 'SOURCE_ACCOUNT_ID_COLLISION' } };
  }
  const accountId = account?._id || item.accountId;
  const assignmentResult = account
    ? await accessAssignmentRepository.list({ accountId, status: accessAssignmentStatuses.ACTIVE, page: 1, limit: 100 })
    : { items: [] };
  const unchanged = Boolean(account)
    && (item.isActiveOrProbation === false
      ? assignmentResult.items.length === 0
      : expectedAssignments.every((expected) => assignmentMatches(assignmentResult.items, expected)));
  return { account, accountId, unchanged };
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
          passwordHash,
          passwordSalt,
          sessions: [],
          tokenVersion: 0,
          status: accountStatuses.INACTIVE,
        }, { session });
      }
      if (item.isActiveOrProbation === false) {
        await accessAssignmentRepository.deactivateActiveByAccountId(account._id, { session });
      } else {
        for (const assignment of assignments) {
          await accessAssignmentRepository.upsertActiveScopedRole({
            accountId: account._id,
            ...assignment,
          }, { session });
        }
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
