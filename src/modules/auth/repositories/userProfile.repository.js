const mongoose = require('mongoose');
const Account = require('../models/account.model');
const AccessAssignment = require('../models/accessAssignment.model');
const Permission = require('../models/permission.model');
const Role = require('../models/role.model');
const ScopedRolePermission = require('../models/scopedRolePermission.model');
const UserProfile = require('../models/userProfile.model');
const {
  accountStatuses,
  accessAssignmentStatuses,
} = require('../constants/auth.constants');
const {
  buildPrefixRegex,
  normalizeSearchTerm,
} = require('../../../shared/utils/search');

async function create(profileData, { session } = {}) {
  const profiles = await UserProfile.create([profileData], { session });
  return profiles[0].toObject();
}

async function findByAccountId(accountId) {
  return UserProfile.findOne({ accountId }).lean();
}

async function findByEmail(email) {
  return UserProfile.findOne({ email: email.toLowerCase() }).lean();
}

async function findByEmployeeCode(employeeCode) {
  return UserProfile.findOne({ employeeCode: String(employeeCode).toUpperCase() }).lean();
}

async function listByEmployeeCodes(employeeCodes = []) {
  const codes = [...new Set(employeeCodes
    .filter(Boolean)
    .map((code) => String(code).trim().toUpperCase())
    .filter(Boolean))];
  if (codes.length === 0) return [];
  return UserProfile.find({ employeeCode: { $in: codes } }).lean();
}

async function listByAccountIds(accountIds = []) {
  const ids = [...new Set(accountIds.filter(Boolean).map(String))];
  if (ids.length === 0) return [];
  return UserProfile.find({ accountId: { $in: ids } }).lean();
}

async function listAssignableProfiles({
  accountIds = [],
  excludedAccountIds = [],
  search,
  limit = 50,
  requiredPermission,
} = {}) {
  const filter = {};
  const normalizedSearch = normalizeSearchTerm(search);
  const normalizedRequiredPermission = normalizeSearchTerm(requiredPermission).toUpperCase();
  const includedAccountObjectIds = accountIds
    .filter((accountId) => mongoose.Types.ObjectId.isValid(accountId))
    .map((accountId) => new mongoose.Types.ObjectId(accountId));
  const excludedAccountObjectIds = excludedAccountIds
    .filter((accountId) => mongoose.Types.ObjectId.isValid(accountId))
    .map((accountId) => new mongoose.Types.ObjectId(accountId));

  if (includedAccountObjectIds.length > 0 || accountIds.length > 0) {
    filter.accountId = { ...(filter.accountId || {}), $in: includedAccountObjectIds };
  }

  if (excludedAccountObjectIds.length > 0) {
    filter.accountId = { ...(filter.accountId || {}), $nin: excludedAccountObjectIds };
  }

  if (normalizedSearch) {
    const employeeCodeRegex = buildPrefixRegex(normalizedSearch.toUpperCase());
    const emailRegex = buildPrefixRegex(normalizedSearch.toLowerCase());

    filter.$or = [
      { employeeCode: employeeCodeRegex },
      { email: emailRegex },
    ];
  }

  const permissionStages = normalizedRequiredPermission ? [
    {
      $lookup: {
        from: AccessAssignment.collection.name,
        let: { accountId: '$accountId' },
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
      $lookup: {
        from: ScopedRolePermission.collection.name,
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
      $lookup: {
        from: Permission.collection.name,
        pipeline: [
          { $match: { code: normalizedRequiredPermission } },
          { $project: { _id: 1 } },
        ],
        as: 'requiredPermissionDocs',
      },
    },
    {
      $addFields: {
        requiredPermissionId: { $first: '$requiredPermissionDocs._id' },
        assignablePermissionIds: {
          $reduce: {
            input: '$accessAssignments',
            initialValue: [],
            in: {
              $setUnion: [
                '$$value',
                {
                  $let: {
                    vars: {
                      role: {
                        $first: {
                          $filter: {
                            input: '$roleDocs',
                            as: 'role',
                            cond: { $eq: ['$$role._id', '$$this.roleId'] },
                          },
                        },
                      },
                      scopedPermissionEntry: {
                        $first: {
                          $filter: {
                            input: '$scopedRolePermissionDocs',
                            as: 'scopedPermission',
                            cond: {
                              $and: [
                                { $eq: ['$$scopedPermission.roleId', '$$this.roleId'] },
                                { $eq: ['$$scopedPermission.scopeType', '$$this.scopeType'] },
                                { $eq: ['$$scopedPermission.scopeId', '$$this.scopeId'] },
                              ],
                            },
                          },
                        },
                      },
                      hasPermissionOverride: {
                        $and: [
                          { $ne: [{ $type: '$$this.overridePermissions' }, 'missing'] },
                          { $ne: ['$$this.overridePermissions', null] },
                        ],
                      },
                    },
                    in: {
                      $cond: [
                        '$$hasPermissionOverride',
                        { $ifNull: ['$$this.overridePermissions', []] },
                        {
                          $setUnion: [
                            {
                              $cond: [
                                { $ne: [{ $ifNull: ['$$scopedPermissionEntry._id', null] }, null] },
                                { $ifNull: ['$$scopedPermissionEntry.permissions', []] },
                                { $ifNull: ['$$role.permissions', []] },
                              ],
                            },
                            { $ifNull: ['$$this.customPermissions', []] },
                          ],
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    {
      $match: {
        $expr: {
          $and: [
            { $ne: ['$requiredPermissionId', null] },
            { $in: ['$requiredPermissionId', '$assignablePermissionIds'] },
          ],
        },
      },
    },
  ] : [];

  return UserProfile.aggregate([
    { $match: filter },
    {
      $lookup: {
        from: Account.collection.name,
        localField: 'accountId',
        foreignField: '_id',
        as: 'account',
      },
    },
    { $unwind: '$account' },
    { $match: { 'account.status': accountStatuses.ACTIVE } },
    ...permissionStages,
    { $sort: { employeeCode: 1, fullName: 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        accountId: 1,
        email: 1,
        fullName: 1,
        employeeCode: 1,
        avatarUrl: 1,
      },
    },
  ]);
}

async function updateByAccountId(accountId, update, { session } = {}) {
  return UserProfile.findOneAndUpdate(
    { accountId },
    { $set: update },
    { returnDocument: 'after', session },
  ).lean();
}

module.exports = {
  create,
  findByAccountId,
  findByEmail,
  findByEmployeeCode,
  listByAccountIds,
  listByEmployeeCodes,
  listAssignableProfiles,
  updateByAccountId,
};
