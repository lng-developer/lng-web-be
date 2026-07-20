const mongoose = require('mongoose');
const config = require('../../../config');
const logger = require('../../../shared/utils/logger');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const {
  buildCaseInsensitivePrefixRegex,
  buildPrefixRegex,
  normalizeSearchTerm,
} = require('../../../shared/utils/search');
const { getRedisClient } = require('../../../config/redis');
const Account = require('../models/account.model');
const UserProfile = require('../models/userProfile.model');
const AccessAssignment = require('../models/accessAssignment.model');
const Role = require('../models/role.model');
const {
  accessAssignmentStatuses,
  accessScopeTypes,
  accountStatuses,
} = require('../constants/auth.constants');

const PERMISSION_CACHE_TTL_SECONDS = 300;
const MAX_REFRESH_SESSIONS_PER_ACCOUNT = 50;

function getPermissionCacheKey(accountId) {
  return `auth:permissions:${accountId}`;
}

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  return new mongoose.Types.ObjectId(value);
}

function hasAssignmentPermissionOverrideExpression() {
  return {
    $and: [
      { $ne: [{ $type: '$$assignment.overridePermissions' }, 'missing'] },
      { $ne: ['$$assignment.overridePermissions', null] },
    ],
  };
}

function permissionCodesExpression(permissionIdsExpression) {
  return {
    $map: {
      input: {
        $filter: {
          input: '$permissionDocs',
          as: 'permission',
          cond: {
            $in: ['$$permission._id', permissionIdsExpression],
          },
        },
      },
      as: 'permission',
      in: { $toUpper: '$$permission.code' },
    },
  };
}

function buildAccountProjection({ includePassword = true } = {}) {
  return {
    _id: '$_id',
    email: '$email',
    normalizedEmail: '$normalizedEmail',
    ...(includePassword ? {
      passwordHash: '$passwordHash',
      passwordSalt: '$passwordSalt',
    } : {}),
    tokenVersion: '$tokenVersion',
    status: '$status',
    lastLoginAt: '$lastLoginAt',
    lastLoginIp: '$lastLoginIp',
    createdAt: '$createdAt',
    updatedAt: '$updatedAt',
  };
}

function buildScopedAccessStages() {
  return [
    {
      $lookup: {
        from: 'accessassignments',
        let: { accountId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$accountId', '$$accountId'] },
                  { $eq: ['$status', accessAssignmentStatuses.ACTIVE] },
                ],
              },
            },
          },
        ],
        as: 'accessAssignments',
      },
    },
    {
      $lookup: {
        from: 'roles',
        localField: 'accessAssignments.roleId',
        foreignField: '_id',
        as: 'roleDocs',
      },
    },
    {
      $lookup: {
        from: 'scopedrolepermissions',
        let: { assignments: '$accessAssignments' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  {
                    $in: [
                      '$roleId',
                      {
                        $map: {
                          input: '$$assignments',
                          as: 'assignment',
                          in: '$$assignment.roleId',
                        },
                      },
                    ],
                  },
                  {
                    $in: [
                      '$scopeId',
                      {
                        $map: {
                          input: '$$assignments',
                          as: 'assignment',
                          in: '$$assignment.scopeId',
                        },
                      },
                    ],
                  },
                  {
                    $in: [
                      '$scopeType',
                      {
                        $map: {
                          input: '$$assignments',
                          as: 'assignment',
                          in: '$$assignment.scopeType',
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
        as: 'scopedRolePermissionDocs',
      },
    },
    {
      $addFields: {
        rolePermissionIds: {
          $reduce: {
            input: { $ifNull: ['$roleDocs.permissions', []] },
            initialValue: [],
            in: { $setUnion: ['$$value', '$$this'] },
          },
        },
        scopedRolePermissionIds: {
          $reduce: {
            input: { $ifNull: ['$scopedRolePermissionDocs.permissions', []] },
            initialValue: [],
            in: { $setUnion: ['$$value', '$$this'] },
          },
        },
        assignmentCustomPermissionIds: {
          $reduce: {
            input: { $ifNull: ['$accessAssignments.customPermissions', []] },
            initialValue: [],
            in: { $setUnion: ['$$value', '$$this'] },
          },
        },
        assignmentOverridePermissionIds: {
          $reduce: {
            input: { $ifNull: ['$accessAssignments.overridePermissions', []] },
            initialValue: [],
            in: { $setUnion: ['$$value', '$$this'] },
          },
        },
      },
    },
    {
      $addFields: {
        allPermissionIds: {
          $setUnion: [
            '$rolePermissionIds',
            '$scopedRolePermissionIds',
            '$assignmentCustomPermissionIds',
            '$assignmentOverridePermissionIds',
          ],
        },
      },
    },
    {
      $lookup: {
        from: 'permissions',
        localField: 'allPermissionIds',
        foreignField: '_id',
        as: 'permissionDocs',
      },
    },
    {
      $addFields: {
        scopes: {
          $map: {
            input: '$accessAssignments',
            as: 'assignment',
            in: {
              $let: {
                vars: {
                  role: {
                    $first: {
                      $filter: {
                        input: '$roleDocs',
                        as: 'role',
                        cond: { $eq: ['$$role._id', '$$assignment.roleId'] },
                      },
                    },
                  },
                },
                in: {
                  $let: {
                    vars: {
                      scopedPermissionEntry: {
                        $first: {
                          $filter: {
                            input: { $ifNull: ['$scopedRolePermissionDocs', []] },
                            as: 'scopedPermission',
                            cond: {
                              $and: [
                                { $eq: ['$$scopedPermission.roleId', '$$assignment.roleId'] },
                                { $eq: ['$$scopedPermission.scopeType', '$$assignment.scopeType'] },
                                { $eq: ['$$scopedPermission.scopeId', '$$assignment.scopeId'] },
                              ],
                            },
                          },
                        },
                      },
                    },
                    in: {
                      $let: {
                        vars: {
                          inheritedPermissionIds: {
                            $cond: [
                              { $ne: [{ $ifNull: ['$$scopedPermissionEntry.scopeId', null] }, null] },
                              { $ifNull: ['$$scopedPermissionEntry.permissions', []] },
                              { $ifNull: ['$$role.permissions', []] },
                            ],
                          },
                          hasPermissionOverride: hasAssignmentPermissionOverrideExpression(),
                        },
                        in: {
                          $let: {
                            vars: {
                              effectivePermissionIds: {
                                $cond: [
                                  '$$hasPermissionOverride',
                                  { $ifNull: ['$$assignment.overridePermissions', []] },
                                  {
                                    $setUnion: [
                                      '$$inheritedPermissionIds',
                                      { $ifNull: ['$$assignment.customPermissions', []] },
                                    ],
                                  },
                                ],
                              },
                            },
                            in: {
                              assignmentId: '$$assignment._id',
                              roleId: '$$assignment.roleId',
                              scopeType: '$$assignment.scopeType',
                              scopeId: '$$assignment.scopeId',
                              customPermissionIds: { $ifNull: ['$$assignment.customPermissions', []] },
                              overridePermissionIds: {
                                $cond: [
                                  '$$hasPermissionOverride',
                                  { $ifNull: ['$$assignment.overridePermissions', []] },
                                  null,
                                ],
                              },
                              inheritedPermissionIds: '$$inheritedPermissionIds',
                              effectivePermissionIds: '$$effectivePermissionIds',
                              isPermissionOverridden: '$$hasPermissionOverride',
                              roles: {
                                $cond: [
                                  { $ifNull: ['$$role.code', false] },
                                  [{ $toUpper: '$$role.code' }],
                                  [],
                                ],
                              },
                              permissions: permissionCodesExpression('$$effectivePermissionIds'),
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      $addFields: {
        globalScopes: {
          $filter: {
            input: '$scopes',
            as: 'scope',
            cond: { $eq: ['$$scope.scopeType', accessScopeTypes.GLOBAL] },
          },
        },
      },
    },
  ];
}

function buildAuthAggregation(matchStage, { includePassword = true } = {}) {
  return [
    { $match: matchStage },
    {
      $lookup: {
        from: 'userprofiles',
        localField: '_id',
        foreignField: 'accountId',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    ...buildScopedAccessStages(),
    {
      $project: {
        account: buildAccountProjection({ includePassword }),
        profile: '$profile',
        scopes: 1,
        roles: {
          $reduce: {
            input: '$globalScopes.roles',
            initialValue: [],
            in: { $setUnion: ['$$value', '$$this'] },
          },
        },
        permissions: {
          $reduce: {
            input: '$globalScopes.permissions',
            initialValue: [],
            in: { $setUnion: ['$$value', '$$this'] },
          },
        },
      },
    },
  ];
}

function buildMinimalAuthStateAggregation(accountId) {
  return [
    { $match: { _id: toObjectId(accountId) } },
    {
      $lookup: {
        from: 'userprofiles',
        localField: '_id',
        foreignField: 'accountId',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        account: buildAccountProjection({ includePassword: false }),
        profile: '$profile',
      },
    },
  ];
}

function normalizeCachedAuthorization(cachedValue) {
  const parsedValue = JSON.parse(cachedValue);

  if (Array.isArray(parsedValue)) {
    return {
      roles: [],
      permissions: parsedValue,
      scopes: [],
    };
  }

  return {
    roles: Array.isArray(parsedValue.roles) ? parsedValue.roles : [],
    permissions: Array.isArray(parsedValue.permissions) ? parsedValue.permissions : [],
    scopes: Array.isArray(parsedValue.scopes) ? parsedValue.scopes : [],
  };
}

async function readCachedAuthorization(accountId) {
  if (!config.redis.enabled) {
    return null;
  }

  try {
    const redis = getRedisClient();
    const cachedValue = await redis.get(getPermissionCacheKey(accountId));
    return cachedValue ? normalizeCachedAuthorization(cachedValue) : null;
  } catch (error) {
    logger.warn('auth_permission_cache_read_failed', { accountId: String(accountId), error });
    return null;
  }
}

async function writeCachedAuthorization(accountId, authorization) {
  if (!config.redis.enabled) {
    return;
  }

  try {
    const redis = getRedisClient();
    await redis.set(
      getPermissionCacheKey(accountId),
      JSON.stringify({
        roles: authorization.roles || [],
        permissions: authorization.permissions || [],
        scopes: authorization.scopes || [],
      }),
      'EX',
      PERMISSION_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logger.warn('auth_permission_cache_write_failed', { accountId: String(accountId), error });
  }
}

async function deleteCachedAuthorization(accountId) {
  if (!config.redis.enabled) {
    return;
  }

  try {
    const redis = getRedisClient();
    await redis.del(getPermissionCacheKey(accountId));
  } catch (error) {
    logger.warn('auth_permission_cache_delete_failed', { accountId: String(accountId), error });
  }
}

async function create(accountData, { session } = {}) {
  const accounts = await Account.create([accountData], { session });
  return accounts[0].toObject();
}

async function findByNormalizedEmail(normalizedEmail) {
  return Account.findOne({ normalizedEmail }).lean();
}

async function findById(accountId) {
  return Account.findById(accountId).select('-passwordHash -passwordSalt -sessions').lean();
}

async function list({
  status,
  search,
  roleId,
  roleCode,
  departmentId,
  teamId,
  page = 1,
  limit = 20,
} = {}) {
  const filter = {};

  if (status) {
    filter.status = status;
  }

  const normalizedSearch = normalizeSearchTerm(search);
  const emailRegex = buildPrefixRegex(normalizedSearch.toLowerCase());
  const profileRegex = buildCaseInsensitivePrefixRegex(normalizedSearch);
  const postLookupMatches = [];

  if (emailRegex || profileRegex) {
    postLookupMatches.push({
      $or: [
        ...(emailRegex ? [{ normalizedEmail: emailRegex }] : []),
        ...(profileRegex ? [
          { 'profile.fullName': profileRegex },
          { 'profile.employeeCode': profileRegex },
        ] : []),
      ],
    });
  }

  if (roleId) {
    postLookupMatches.push({ 'roleAssignments.roleId': toObjectId(roleId) });
  }

  if (roleCode) {
    postLookupMatches.push({ 'roleAssignments.roleCode': normalizeSearchTerm(roleCode).toUpperCase() });
  }

  if (departmentId) {
    postLookupMatches.push({
      roleAssignments: {
        $elemMatch: {
          scopeType: accessScopeTypes.DEPARTMENT,
          scopeId: toObjectId(departmentId),
        },
      },
    });
  }

  if (teamId) {
    postLookupMatches.push({
      roleAssignments: {
        $elemMatch: {
          scopeType: accessScopeTypes.TEAM,
          scopeId: toObjectId(teamId),
        },
      },
    });
  }

  const basePipeline = [
    { $match: filter },
    {
      $lookup: {
        from: UserProfile.collection.name,
        localField: '_id',
        foreignField: 'accountId',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: AccessAssignment.collection.name,
        let: { accountId: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$accountId', '$$accountId'] },
                  { $eq: ['$status', accessAssignmentStatuses.ACTIVE] },
                ],
              },
            },
          },
        ],
        as: 'accessAssignments',
      },
    },
    {
      $lookup: {
        from: Role.collection.name,
        localField: 'accessAssignments.roleId',
        foreignField: '_id',
        as: 'roleDocs',
      },
    },
    {
      $addFields: {
        roleAssignments: {
          $map: {
            input: '$accessAssignments',
            as: 'assignment',
            in: {
              $let: {
                vars: {
                  role: {
                    $first: {
                      $filter: {
                        input: '$roleDocs',
                        as: 'role',
                        cond: { $eq: ['$$role._id', '$$assignment.roleId'] },
                      },
                    },
                  },
                },
                in: {
                  assignmentId: '$$assignment._id',
                  roleId: '$$assignment.roleId',
                  roleCode: '$$role.code',
                  roleName: '$$role.name',
                  scopeType: '$$assignment.scopeType',
                  scopeId: '$$assignment.scopeId',
                  customPermissionIds: '$$assignment.customPermissions',
                  overridePermissionIds: {
                    $cond: [
                      {
                        $and: [
                          { $ne: [{ $type: '$$assignment.overridePermissions' }, 'missing'] },
                          { $ne: ['$$assignment.overridePermissions', null] },
                        ],
                      },
                      '$$assignment.overridePermissions',
                      null,
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      $addFields: {
        roles: {
          $reduce: {
            input: '$roleAssignments.roleCode',
            initialValue: [],
            in: {
              $cond: [
                { $ifNull: ['$$this', false] },
                { $setUnion: ['$$value', ['$$this']] },
                '$$value',
              ],
            },
          },
        },
      },
    },
    ...(postLookupMatches.length ? [{ $match: { $and: postLookupMatches } }] : []),
  ];

  const [items, totalResult] = await Promise.all([
    Account.aggregate([
      ...basePipeline,
      { $sort: { createdAt: -1 } },
      { $skip: getPaginationOffset({ page, limit }) },
      { $limit: limit },
      {
        $project: {
          passwordHash: 0,
          passwordSalt: 0,
          sessions: 0,
          'profile.__v': 0,
          accessAssignments: 0,
          roleDocs: 0,
        },
      },
    ]),
    Account.aggregate([
      ...basePipeline,
      { $count: 'total' },
    ]),
  ]);
  const total = totalResult[0]?.total || 0;

  return toPaginatedResult({
    items,
    total,
    page,
    limit,
  });
}

async function updateStatus(accountId, status) {
  return Account.findByIdAndUpdate(
    accountId,
    { $set: { status } },
    { returnDocument: 'after' },
  ).select('-passwordHash -passwordSalt -sessions').lean();
}

async function updateEmail(accountId, { email, normalizedEmail }, { session } = {}) {
  const now = new Date();

  return Account.findByIdAndUpdate(
    accountId,
    {
      $inc: { tokenVersion: 1 },
      $set: {
        email,
        normalizedEmail,
        'sessions.$[activeSession].revokedAt': now,
      },
    },
    {
      returnDocument: 'after',
      session,
      arrayFilters: [{
        'activeSession.revokedAt': null,
        'activeSession.expiresAt': { $gt: now },
      }],
    },
  ).select('-passwordHash -passwordSalt -sessions').lean();
}

async function updatePassword(accountId, { passwordHash, passwordSalt }) {
  const now = new Date();

  return Account.findByIdAndUpdate(
    accountId,
    {
      $inc: { tokenVersion: 1 },
      $set: {
        passwordHash,
        passwordSalt,
        'sessions.$[activeSession].revokedAt': now,
      },
    },
    {
      returnDocument: 'after',
      arrayFilters: [{
        'activeSession.revokedAt': null,
        'activeSession.expiresAt': { $gt: now },
      }],
    },
  ).select('-passwordHash -passwordSalt -sessions').lean();
}

async function revokeActiveSessions(accountId) {
  const now = new Date();

  return Account.findByIdAndUpdate(
    accountId,
    {
      $inc: { tokenVersion: 1 },
      $set: {
        'sessions.$[activeSession].revokedAt': now,
      },
    },
    {
      returnDocument: 'after',
      arrayFilters: [{
        'activeSession.revokedAt': null,
        'activeSession.expiresAt': { $gt: now },
      }],
    },
  ).select('-passwordHash -passwordSalt -sessions').lean();
}

async function archive(accountId) {
  const now = new Date();

  return Account.findByIdAndUpdate(
    accountId,
    {
      $inc: { tokenVersion: 1 },
      $set: {
        status: accountStatuses.ARCHIVED,
        'sessions.$[activeSession].revokedAt': now,
      },
    },
    {
      returnDocument: 'after',
      arrayFilters: [{
        'activeSession.revokedAt': null,
        'activeSession.expiresAt': { $gt: now },
      }],
    },
  ).select('-passwordHash -passwordSalt -sessions').lean();
}

async function findAuthAccountByEmail(normalizedEmail) {
  const results = await Account.aggregate(buildAuthAggregation({ normalizedEmail }, { includePassword: true }));
  return results[0] || null;
}

async function findMinimalAuthStateById(accountId) {
  const results = await Account.aggregate(buildMinimalAuthStateAggregation(accountId));
  return results[0] || null;
}

async function findAuthAccountById(accountId) {
  const cachedAuthorization = await readCachedAuthorization(accountId);

  if (cachedAuthorization) {
    const authState = await findMinimalAuthStateById(accountId);
    return authState ? { ...authState, ...cachedAuthorization } : null;
  }

  const results = await Account.aggregate(
    buildAuthAggregation({ _id: toObjectId(accountId) }, { includePassword: false }),
  );
  const authModel = results[0] || null;

  if (authModel) {
    await writeCachedAuthorization(accountId, {
      roles: authModel.roles,
      permissions: authModel.permissions,
      scopes: authModel.scopes,
    });
  }

  return authModel;
}

async function appendSession(accountId, sessionData, { session } = {}) {
  return Account.updateOne(
    { _id: accountId },
    {
      $push: {
        sessions: {
          $each: [sessionData],
          $slice: -MAX_REFRESH_SESSIONS_PER_ACCOUNT,
        },
      },
    },
    { session },
  );
}

async function rotateRefreshSession(refreshTokenHash, nextSessionData) {
  const now = new Date();

  return Account.findOneAndUpdate(
    {
      sessions: {
        $elemMatch: {
          refreshTokenHash,
          revokedAt: null,
          expiresAt: { $gt: now },
        },
      },
    },
    [
      {
        $set: {
          sessions: {
            $slice: [
              {
                $concatArrays: [
                  {
                    $map: {
                      input: '$sessions',
                      as: 'session',
                      in: {
                        $cond: [
                          {
                            $and: [
                              { $eq: ['$$session.refreshTokenHash', refreshTokenHash] },
                              { $eq: ['$$session.revokedAt', null] },
                              { $gt: ['$$session.expiresAt', now] },
                            ],
                          },
                          {
                            $mergeObjects: [
                              '$$session',
                              {
                                revokedAt: now,
                                replacedBySessionId: nextSessionData.sessionId,
                              },
                            ],
                          },
                          '$$session',
                        ],
                      },
                    },
                  },
                  [nextSessionData],
                ],
              },
              -MAX_REFRESH_SESSIONS_PER_ACCOUNT,
            ],
          },
        },
      },
    ],
    { returnDocument: 'after', updatePipeline: true },
  ).lean();
}

async function revokeRefreshSession(refreshTokenHash) {
  return Account.updateOne(
    {
      sessions: {
        $elemMatch: {
          refreshTokenHash,
          revokedAt: null,
        },
      },
    },
    {
      $set: {
        'sessions.$.revokedAt': new Date(),
      },
    },
  );
}

async function updateLastLogin(accountId, ipAddress) {
  return Account.updateOne(
    { _id: accountId },
    {
      $set: {
        lastLoginAt: new Date(),
        lastLoginIp: ipAddress || null,
      },
    },
  );
}

async function findAccountByActiveRefreshToken(refreshTokenHash) {
  return Account.findOne({
    sessions: {
      $elemMatch: {
        refreshTokenHash,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
    },
  }).lean();
}

async function purgeExpiredSessions(accountId, beforeDate = new Date()) {
  return Account.updateOne(
    { _id: accountId },
    {
      $pull: {
        sessions: {
          expiresAt: { $lte: beforeDate },
        },
      },
    },
  );
}

module.exports = {
  PERMISSION_CACHE_TTL_SECONDS,
  MAX_REFRESH_SESSIONS_PER_ACCOUNT,
  getPermissionCacheKey,
  buildAuthAggregation,
  create,
  findByNormalizedEmail,
  findById,
  list,
  updateStatus,
  updateEmail,
  updatePassword,
  revokeActiveSessions,
  archive,
  findAuthAccountByEmail,
  findAuthAccountById,
  appendSession,
  rotateRefreshSession,
  revokeRefreshSession,
  updateLastLogin,
  findAccountByActiveRefreshToken,
  purgeExpiredSessions,
  invalidatePermissionCache: deleteCachedAuthorization,
};
