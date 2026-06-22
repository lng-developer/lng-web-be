const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Role = require('../models/role.model');
const Permission = require('../models/permission.model');
const UserProfile = require('../models/userProfile.model');

const profileMetadataFields = [
  'phone',
  'avatarUrl',
  'personalEmail',
  'dateOfBirth',
  'gender',
  'address',
];

function toTitleCase(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildPermissionName(code) {
  const [resource, action] = String(code || '').split(':');
  return `${toTitleCase(action || 'Access')} ${toTitleCase(resource || 'Resource')}`;
}

function buildRoleDescription(role) {
  return `${role.name || toTitleCase(role.code)} role.`;
}

function getWriteCount(result = {}) {
  return Number(result.modifiedCount || 0) + Number(result.upsertedCount || 0);
}

async function migrateRoles() {
  const roles = await Role.find({
    $or: [
      { description: { $exists: false } },
      { description: null },
      { description: '' },
    ],
  }).select('_id code name').lean();

  if (roles.length === 0) {
    return { scanned: 0, updated: 0 };
  }

  const result = await Role.bulkWrite(roles.map((role) => ({
    updateOne: {
      filter: { _id: role._id },
      update: { $set: { description: buildRoleDescription(role) } },
    },
  })));

  return { scanned: roles.length, updated: getWriteCount(result) };
}

async function migratePermissions() {
  const permissions = await Permission.find({
    $or: [
      { name: { $exists: false } },
      { name: null },
      { name: '' },
    ],
  }).select('_id code').lean();

  if (permissions.length === 0) {
    return { scanned: 0, updated: 0 };
  }

  const result = await Permission.bulkWrite(permissions.map((permission) => ({
    updateOne: {
      filter: { _id: permission._id },
      update: { $set: { name: buildPermissionName(permission.code) } },
    },
  })));

  return { scanned: permissions.length, updated: getWriteCount(result) };
}

async function migrateUserProfiles() {
  const results = await Promise.all(profileMetadataFields.map((field) => (
    UserProfile.updateMany(
      { [field]: { $exists: false } },
      { $set: { [field]: null } },
    )
  )));

  return {
    fields: profileMetadataFields,
    updated: results.reduce((total, result) => total + getWriteCount(result), 0),
  };
}

async function migrateAuthMetadataFields() {
  const [roles, permissions, userProfiles] = await Promise.all([
    migrateRoles(),
    migratePermissions(),
    migrateUserProfiles(),
  ]);

  return {
    roles,
    permissions,
    userProfiles,
  };
}

async function main() {
  await connectDatabase();

  try {
    const result = await migrateAuthMetadataFields();
    logger.info('auth_metadata_fields_migration_complete', result);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('auth_metadata_fields_migration_failed', error);
    process.exitCode = 1;
  });
}

module.exports = {
  migrateAuthMetadataFields,
  buildPermissionName,
  buildRoleDescription,
};
