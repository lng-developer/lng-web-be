const mongoose = require('mongoose');
const config = require('../../../config');
const logger = require('../../../shared/utils/logger');
const { getRedisClient } = require('../../../config/redis');
const Account = require('../models/account.model');

const PERMISSION_CACHE_TTL_SECONDS = 300;

function getPermissionCacheKey(accountId) {
  return `auth:permissions:${accountId}`;
}

function toObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) {
    return value;
  }

  return new mongoose.Types.ObjectId(value);
}

function buildAuthAggregation(matchStage) {
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
    {
      $lookup: {
        from: 'roles',
        localField: 'roles',
        foreignField: '_id',
        as: 'roleDocs',
      },
    },
    {
      $addFields: {
        rolePermissionIds: {
          $reduce: {
            input: '$roleDocs.permissions',
            initialValue: [],
            in: { $setUnion: ['$$value', '$$this'] },
          },
        },
      },
    },
    {
      $lookup: {
        from: 'permissions',
        localField: 'rolePermissionIds',
        foreignField: '_id',
        as: 'rolePermissionDocs',
      },
    },
    {
      $lookup: {
        from: 'permissions',
        localField: 'customPermissions',
        foreignField: '_id',
        as: 'customPermissionDocs',
      },
    },
    {
      $project: {
        account: {
          _id: '$_id',
          email: '$email',
          normalizedEmail: '$normalizedEmail',
          passwordHash: '$passwordHash',
          passwordSalt: '$passwordSalt',
          status: '$status',
          lastLoginAt: '$lastLoginAt',
          lastLoginIp: '$lastLoginIp',
          createdAt: '$createdAt',
          updatedAt: '$updatedAt',
        },
        profile: '$profile',
        roleCodes: {
          $map: {
            input: '$roleDocs',
            as: 'role',
            in: { $toUpper: '$$role.code' },
          },
        },
        rolePermissionCodes: {
          $map: {
            input: '$rolePermissionDocs',
            as: 'permission',
            in: { $toUpper: '$$permission.code' },
          },
        },
        customPermissionCodes: {
          $map: {
            input: '$customPermissionDocs',
            as: 'permission',
            in: { $toUpper: '$$permission.code' },
          },
        },
      },
    },
    {
      $project: {
        account: 1,
        profile: 1,
        roles: '$roleCodes',
        permissions: {
          $setUnion: ['$rolePermissionCodes', '$customPermissionCodes'],
        },
      },
    },
  ];
}

async function readCachedPermissions(accountId) {
  if (!config.redis.enabled) {
    return null;
  }

  try {
    const redis = getRedisClient();
    const cachedValue = await redis.get(getPermissionCacheKey(accountId));
    return cachedValue ? JSON.parse(cachedValue) : null;
  } catch (error) {
    logger.warn('auth_permission_cache_read_failed', { accountId: String(accountId), error });
    return null;
  }
}

async function writeCachedPermissions(accountId, permissions) {
  if (!config.redis.enabled) {
    return;
  }

  try {
    const redis = getRedisClient();
    await redis.set(getPermissionCacheKey(accountId), JSON.stringify(permissions), 'EX', PERMISSION_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.warn('auth_permission_cache_write_failed', { accountId: String(accountId), error });
  }
}

async function deleteCachedPermissions(accountId) {
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

async function findAuthAccountByEmail(normalizedEmail) {
  const results = await Account.aggregate(buildAuthAggregation({ normalizedEmail }));
  return results[0] || null;
}

async function findMinimalAuthStateById(accountId) {
  return Account.aggregate([
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
      $lookup: {
        from: 'roles',
        localField: 'roles',
        foreignField: '_id',
        as: 'roleDocs',
      },
    },
    {
      $project: {
        account: {
          _id: '$_id',
          email: '$email',
          normalizedEmail: '$normalizedEmail',
          status: '$status',
          lastLoginAt: '$lastLoginAt',
          lastLoginIp: '$lastLoginIp',
          createdAt: '$createdAt',
          updatedAt: '$updatedAt',
        },
        profile: '$profile',
        roles: {
          $map: {
            input: '$roleDocs',
            as: 'role',
            in: { $toUpper: '$$role.code' },
          },
        },
      },
    },
  ]).then((results) => results[0] || null);
}

async function findAuthAccountById(accountId) {
  const cachedPermissions = await readCachedPermissions(accountId);

  if (cachedPermissions) {
    const authState = await findMinimalAuthStateById(accountId);
    return authState ? { ...authState, permissions: cachedPermissions } : null;
  }

  const results = await Account.aggregate(buildAuthAggregation({ _id: toObjectId(accountId) }));
  const authModel = results[0] || null;

  if (authModel) {
    await writeCachedPermissions(accountId, authModel.permissions);
  }

  return authModel;
}

async function appendSession(accountId, sessionData, { session } = {}) {
  return Account.updateOne(
    { _id: accountId },
    { $push: { sessions: sessionData } },
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
    {
      $set: {
        'sessions.$.revokedAt': now,
        'sessions.$.replacedBySessionId': nextSessionData.sessionId,
      },
      $push: {
        sessions: nextSessionData,
      },
    },
    { new: true },
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

module.exports = {
  PERMISSION_CACHE_TTL_SECONDS,
  getPermissionCacheKey,
  buildAuthAggregation,
  create,
  findByNormalizedEmail,
  findAuthAccountByEmail,
  findAuthAccountById,
  appendSession,
  rotateRefreshSession,
  revokeRefreshSession,
  updateLastLogin,
  findAccountByActiveRefreshToken,
  invalidatePermissionCache: deleteCachedPermissions,
};
