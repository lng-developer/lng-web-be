const mongoose = require('mongoose');
const { isDeepStrictEqual } = require('node:util');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const canonicalMap = require('../data/vendorProductCanonicalMap.json');

function idOf(value) {
  return String(value?._id || value || '');
}

async function rowsOf(collection) {
  return collection.find({}).toArray();
}

function identityKey(product) {
  return `${idOf(product.vendorId)}:${product.externalProductId}`;
}

function validateCanonicalMap(canonicalMap) {
  const legacyIds = new Set();
  canonicalMap.forEach((row) => {
    if (row.ignoredVendorProductIds) {
      if (!Array.isArray(row.ignoredVendorProductIds) || row.ignoredVendorProductIds.length < 2) {
        throw new Error('ignoredVendorProductIds must contain at least two IDs');
      }
      row.ignoredVendorProductIds.forEach((value) => {
        if (!mongoose.isValidObjectId(idOf(value))) throw new Error(`Invalid ignoredVendorProductId: ${idOf(value)}`);
      });
      return;
    }
    if (row.legacyVendorProductId || row.canonicalVendorProductId) {
      const legacyProductId = idOf(row.legacyVendorProductId);
      const canonicalProductId = idOf(row.canonicalVendorProductId);
      if (!mongoose.isValidObjectId(legacyProductId)) throw new Error(`Invalid legacyVendorProductId: ${legacyProductId}`);
      if (!mongoose.isValidObjectId(canonicalProductId)) throw new Error(`Invalid canonicalVendorProductId: ${canonicalProductId}`);
      if (legacyIds.has(legacyProductId)) throw new Error(`Duplicate legacyVendorProductId: ${legacyProductId}`);
      legacyIds.add(legacyProductId);
      return;
    }
    const legacyId = idOf(row.legacyProductTypeGroupId);
    const canonicalId = idOf(row.canonicalProductTypeGroupId);
    if (!mongoose.isValidObjectId(legacyId)) throw new Error(`Invalid legacyProductTypeGroupId: ${legacyId}`);
    if (!mongoose.isValidObjectId(canonicalId)) throw new Error(`Invalid canonicalProductTypeGroupId: ${canonicalId}`);
    if (legacyIds.has(legacyId)) throw new Error(`Duplicate legacyProductTypeGroupId: ${legacyId}`);
    legacyIds.add(legacyId);
  });
}

const comparedCostCenterFields = [
  'vendorId',
  'standardSize',
  'standardColor',
  'baseCostAmount',
  'currency',
  'domesticShipping',
  'internationalShipping',
  'priorityShipping',
  'importTaxAmount',
  'additionalCosts',
  'status',
];

function differingCostCenterFields(legacy, canonical) {
  return comparedCostCenterFields.filter((field) => (
    !isDeepStrictEqual(
      field === 'vendorId' ? idOf(legacy[field]) : legacy[field],
      field === 'vendorId' ? idOf(canonical[field]) : canonical[field],
    )
  ));
}

async function historicalReferenceCounts(collections, legacyProductId) {
  const query = { vendorProductId: { $in: [new mongoose.Types.ObjectId(legacyProductId)] } };
  const [fulfillmentPlans, financeSnapshots, vendorSubmissions] = await Promise.all([
    collections.fulfillmentPlans.countDocuments(query),
    collections.financeSnapshots.countDocuments(query),
    collections.vendorSubmissions.countDocuments(query),
  ]);
  return { fulfillmentPlans, financeSnapshots, vendorSubmissions };
}

async function auditVendorProductCanonicalization({ collections, canonicalMap }) {
  validateCanonicalMap(canonicalMap);
  const [products, costCenters] = await Promise.all([
    rowsOf(collections.vendorProducts),
    rowsOf(collections.vendorCostCenters),
  ]);
  const mappings = new Map(canonicalMap.map((row) => [
    idOf(row.legacyProductTypeGroupId), idOf(row.canonicalProductTypeGroupId),
  ]).filter(([legacyId]) => legacyId));
  const productMappings = new Map(canonicalMap
    .filter((row) => row.legacyVendorProductId)
    .map((row) => [idOf(row.legacyVendorProductId), idOf(row.canonicalVendorProductId)]));
  const canonicalGroupIds = new Set(mappings.values());
  const canonicalProductIds = new Set(productMappings.values());
  const ignoredRows = canonicalMap.filter((row) => row.ignoredVendorProductIds);
  for (const row of ignoredRows) {
    const ignoredProducts = products.filter((product) => row.ignoredVendorProductIds.map(idOf).includes(idOf(product)));
    if (ignoredProducts.length !== row.ignoredVendorProductIds.length
      || new Set(ignoredProducts.map(identityKey)).size !== 1) {
      throw new Error('ignoredVendorProductIds must share one vendor identity');
    }
  }
  for (const [legacyProductId, canonicalProductId] of productMappings) {
    const pair = products.filter((product) => [legacyProductId, canonicalProductId].includes(idOf(product)));
    if (pair.length !== 2 || new Set(pair.map(identityKey)).size !== 1) {
      throw new Error('Vendor product mapping must share one vendor identity');
    }
  }
  const ignoredProductIds = new Set(ignoredRows.flatMap((row) => row.ignoredVendorProductIds.map(idOf)));
  const grouped = new Map();

  products.filter((product) => product.externalProductId && product.status !== 'INACTIVE').forEach((product) => {
    const key = identityKey(product);
    grouped.set(key, [...(grouped.get(key) || []), product]);
  });

  const report = {
    identityGroups: [],
    missingMappings: [],
    costCenterConflicts: [],
    historicalReferences: [],
    ignoredIdentityGroups: ignoredRows.map((row) => ({
      vendorProductIds: row.ignoredVendorProductIds.map(idOf),
      reason: row.reason,
    })),
    missingExternalProductIds: products
      .filter((product) => !product.externalProductId)
      .map((product) => ({ vendorProductId: idOf(product) })),
    safeGroups: [],
  };

  for (const group of [...grouped.values()].filter((rows) => rows.length > 1)) {
    const { vendorId, externalProductId } = group[0];
    report.identityGroups.push({
      vendorId: idOf(vendorId),
      externalProductId,
      productCount: group.length,
    });

    for (const legacyProduct of group) {
      if (ignoredProductIds.has(idOf(legacyProduct))) continue;
      const explicitCanonicalProductId = productMappings.get(idOf(legacyProduct));
      const canonicalGroupId = mappings.get(idOf(legacyProduct.productTypeGroupId));
      if (!explicitCanonicalProductId && !canonicalGroupId) {
        if (canonicalProductIds.has(idOf(legacyProduct))) continue;
        if (!canonicalGroupIds.has(idOf(legacyProduct.productTypeGroupId))) {
          report.missingMappings.push({
            vendorId: idOf(vendorId),
            externalProductId,
            legacyProductId: idOf(legacyProduct),
            reason: 'PRODUCT_TYPE_GROUP_NOT_MAPPED',
          });
        }
        continue;
      }
      const canonicalProduct = explicitCanonicalProductId
        ? group.find((product) => idOf(product) === explicitCanonicalProductId && product.status === 'ACTIVE')
        : group.find((product) => (
          idOf(product.productTypeGroupId) === canonicalGroupId && product.status === 'ACTIVE'
        ));
      if (!canonicalProduct) {
        report.missingMappings.push({
          vendorId: idOf(vendorId),
          externalProductId,
          legacyProductId: idOf(legacyProduct),
          canonicalProductTypeGroupId: canonicalGroupId,
          canonicalProductId: explicitCanonicalProductId,
          reason: explicitCanonicalProductId
            ? 'CANONICAL_VENDOR_PRODUCT_NOT_FOUND'
            : 'CANONICAL_PRODUCT_NOT_FOUND',
        });
        continue;
      }

      const legacyCostCenters = costCenters.filter((row) => (
        idOf(row.vendorProductId) === idOf(legacyProduct) && row.status === 'ACTIVE'
      ));
      const canonicalCostCenters = costCenters.filter((row) => (
        idOf(row.vendorProductId) === idOf(canonicalProduct)
      ));
      const conflicts = legacyCostCenters.filter((legacy) => {
        const target = canonicalCostCenters.find((row) => row.code === legacy.code);
        return target && differingCostCenterFields(legacy, target).length;
      });
      report.costCenterConflicts.push(...conflicts.map((row) => ({
        vendorId: idOf(vendorId),
        externalProductId,
        legacyProductId: idOf(legacyProduct),
        canonicalProductId: idOf(canonicalProduct),
        code: row.code,
        differingFields: differingCostCenterFields(
          row,
          canonicalCostCenters.find((target) => target.code === row.code),
        ),
      })));
      const references = await historicalReferenceCounts(collections, idOf(legacyProduct));
      if (Object.values(references).some(Boolean)) {
        report.historicalReferences.push({
          legacyProductId: idOf(legacyProduct),
          ...references,
        });
      }
      if (!conflicts.length) {
        report.safeGroups.push({
          vendorId: idOf(vendorId),
          externalProductId,
          legacyProductId: idOf(legacyProduct),
          canonicalProductId: idOf(canonicalProduct),
        });
      }
    }
  }

  return report;
}

function canonicalCostCenterCopy(source, canonicalProduct, now) {
  const copy = { ...source };
  delete copy._id;
  delete copy.createdAt;
  delete copy.updatedAt;
  return {
    ...copy,
    vendorProductId: canonicalProduct._id,
    vendorId: canonicalProduct.vendorId,
    createdAt: now,
    updatedAt: now,
  };
}

async function applyVendorProductCanonicalization({
  collections,
  canonicalMap: map,
  now = new Date(),
  recheckBlockedPlans,
}) {
  const audit = await auditVendorProductCanonicalization({ collections, canonicalMap: map });
  const [products, costCenters, plans] = await Promise.all([
    rowsOf(collections.vendorProducts),
    rowsOf(collections.vendorCostCenters),
    rowsOf(collections.fulfillmentPlans),
  ]);
  const result = {
    copiedCostCenters: 0,
    skippedIdenticalCostCenters: 0,
    conflicts: audit.costCenterConflicts,
    deactivatedProducts: 0,
    rewrittenFinanceSnapshots: 0,
    rewrittenVendorSubmissions: 0,
    recheckedBlockedPlanGroups: 0,
  };
  const migratedLegacyIds = new Set();

  for (const safe of audit.safeGroups) {
    const legacyProduct = products.find((row) => idOf(row) === safe.legacyProductId);
    const canonicalProduct = products.find((row) => idOf(row) === safe.canonicalProductId);
    if (!legacyProduct || legacyProduct.status !== 'ACTIVE' || !canonicalProduct) continue;
    const legacyRows = costCenters.filter((row) => (
      idOf(row.vendorProductId) === safe.legacyProductId && row.status === 'ACTIVE'
    ));
    const canonicalRows = costCenters.filter((row) => idOf(row.vendorProductId) === safe.canonicalProductId);

    for (const legacyRow of legacyRows) {
      const target = canonicalRows.find((row) => row.code === legacyRow.code);
      if (target) {
        result.skippedIdenticalCostCenters += 1;
        continue;
      }
      try {
        await collections.vendorCostCenters.insertOne(
          canonicalCostCenterCopy(legacyRow, canonicalProduct, now),
        );
        result.copiedCostCenters += 1;
      } catch (error) {
        if (error?.code !== 11000) throw error;
        result.skippedIdenticalCostCenters += 1;
      }
    }

    await collections.vendorProducts.updateOne(
      { _id: legacyProduct._id },
      { $set: { status: 'INACTIVE', updatedAt: now } },
    );
    result.deactivatedProducts += 1;
    migratedLegacyIds.add(safe.legacyProductId);
  }

  if (recheckBlockedPlans && migratedLegacyIds.size) {
    const groups = new Map();
    plans.filter((plan) => (
      plan.status === 'BLOCKED' && migratedLegacyIds.has(idOf(plan.vendorProductId))
    )).forEach((plan) => {
      if (!plan.listingId || !plan.productTypeGroupId) return;
      groups.set(
        `${idOf(plan.listingId)}:${idOf(plan.productTypeGroupId)}`,
        [idOf(plan.listingId), idOf(plan.productTypeGroupId)],
      );
    });
    for (const [listingId, productTypeGroupId] of groups.values()) {
      await recheckBlockedPlans(listingId, productTypeGroupId);
      result.recheckedBlockedPlanGroups += 1;
    }
  }

  return result;
}

async function runCli() {
  await connectDatabase();
  try {
    const db = mongoose.connection.db;
    const collections = {
      vendorProducts: db.collection('vendorproducts'),
      vendorCostCenters: db.collection('vendorcostcenters'),
      fulfillmentPlans: db.collection('fulfillmentplans'),
      financeSnapshots: db.collection('financesnapshots'),
      vendorSubmissions: db.collection('vendorsubmissions'),
    };
    const report = await auditVendorProductCanonicalization({ collections, canonicalMap });
    if (!process.argv.includes('--apply')) {
      process.stdout.write(`${JSON.stringify({ database: db.databaseName, ...report }, null, 2)}\n`);
      return;
    }
    if (report.missingMappings.length || report.costCenterConflicts.length) {
      throw new Error('Apply blocked: canonical map is incomplete or has cost center conflicts');
    }
    const mappingPublic = require('../../mapping/public');
    const applied = await applyVendorProductCanonicalization({
      collections,
      canonicalMap,
      recheckBlockedPlans: mappingPublic.recheckBlockedFulfillmentPlansForListingVariant,
    });
    process.stdout.write(`${JSON.stringify({ database: db.databaseName, ...applied }, null, 2)}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  applyVendorProductCanonicalization,
  auditVendorProductCanonicalization,
  runCli,
};
