const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const logger = require('../../../shared/utils/logger');
const Vendor = require('../models/vendor.model');
const VendorIntegrationConfig = require('../models/vendorIntegrationConfig.model');

function idOf(value) {
  return String(value?._id || value?.id || value || '');
}

function buildMigrationPlan(vendors = [], integrations = []) {
  const existingByVendorId = new Map(integrations.map((integration) => [idOf(integration.vendorId), integration]));
  const plans = [];
  const normalizations = [];
  const skipped = [];

  for (const vendor of vendors) {
    const vendorId = idOf(vendor);
    const providerKey = String(vendor.providerKey || '').trim().toUpperCase();
    if (!vendorId || !providerKey) continue;
    const existing = existingByVendorId.get(vendorId);
    if (existing) {
      const mode = existing.mode || (providerKey === 'CUSTOM' ? 'GENERIC_API' : 'NATIVE');
      const adapterKey = existing.adapterKey
        || (mode === 'NATIVE' ? existing.providerKey || providerKey : null);
      if (!existing.mode || (mode === 'NATIVE' && !existing.adapterKey && adapterKey)) {
        normalizations.push({ vendorId, providerKey, mode, adapterKey });
      } else {
        skipped.push({ vendorId, providerKey, reason: 'INTEGRATION_EXISTS' });
      }
      continue;
    }
    if (providerKey === 'CUSTOM') {
      skipped.push({ vendorId, providerKey, reason: 'GENERIC_PROVIDER_REQUIRES_CONFIGURATION' });
      continue;
    }
    plans.push({ vendorId, providerKey, mode: 'NATIVE', adapterKey: providerKey });
  }

  return { plans, normalizations, skipped };
}

async function migrateVendorProviderKeysToIntegrations({ dryRun = true, defaultsByProvider = {} } = {}) {
  const [vendors, integrations] = await Promise.all([
    Vendor.find({ providerKey: { $nin: [null, ''] } }).select('_id providerKey').lean(),
    VendorIntegrationConfig.find({}).select('vendorId providerKey mode adapterKey').lean(),
  ]);
  const plan = buildMigrationPlan(vendors, integrations);
  const result = {
    dryRun,
    scanned: vendors.length,
    planned: plan.plans.length,
    normalizations: plan.normalizations.length,
    skipped: plan.skipped.length,
    created: 0,
    normalized: 0,
    blocked: 0,
  };
  if (dryRun) return {
    ...result,
    plans: plan.plans,
    normalizationRows: plan.normalizations,
    skippedRows: plan.skipped,
  };

  for (const entry of plan.normalizations) {
    await VendorIntegrationConfig.updateOne(
      { vendorId: entry.vendorId },
      { $set: { mode: entry.mode, adapterKey: entry.adapterKey } },
      { runValidators: true },
    );
    result.normalized += 1;
  }

  for (const entry of plan.plans) {
    const defaults = defaultsByProvider[entry.providerKey];
    if (!defaults?.baseUrl || !defaults?.authType) {
      result.blocked += 1;
      continue;
    }
    await VendorIntegrationConfig.updateOne(
      { vendorId: entry.vendorId },
      {
        $setOnInsert: {
          vendorId: entry.vendorId,
          mode: entry.mode,
          adapterKey: entry.adapterKey,
          providerKey: entry.providerKey,
          baseUrl: defaults.baseUrl,
          authType: defaults.authType,
          status: 'DISCONNECTED',
          metadata: {
            migratedFromVendorProviderKey: true,
            migrationMode: entry.mode,
            adapterKey: entry.adapterKey,
          },
        },
      },
      { upsert: true, runValidators: true },
    );
    result.created += 1;
  }
  return result;
}

async function main() {
  await connectDatabase();
  try {
    const rawDefaults = process.env.VENDOR_INTEGRATION_DEFAULTS_JSON;
    const defaultsByProvider = rawDefaults ? JSON.parse(rawDefaults) : {};
    const result = await migrateVendorProviderKeysToIntegrations({
      dryRun: !process.argv.includes('--apply'),
      defaultsByProvider,
    });
    logger.info('vendor_provider_key_migration_complete', result);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('vendor_provider_key_migration_failed', error);
    process.exitCode = 1;
  });
}

module.exports = { buildMigrationPlan, migrateVendorProviderKeysToIntegrations };
