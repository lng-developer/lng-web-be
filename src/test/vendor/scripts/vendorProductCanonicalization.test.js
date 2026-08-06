const {
  applyVendorProductCanonicalization,
  auditVendorProductCanonicalization,
} = require('../../../modules/vendor/scripts/vendorProductCanonicalization');

const ids = {
  vendor: '660000000000000000000001',
  legacyGroup: '660000000000000000000002',
  canonicalGroup: '660000000000000000000003',
  legacyProduct: '660000000000000000000004',
  canonicalProduct: '660000000000000000000005',
  legacyCostCenter: '660000000000000000000006',
  thirdGroup: '660000000000000000000007',
  thirdProduct: '660000000000000000000008',
};

function collection(rows = []) {
  const documents = rows.map((row) => ({ ...row }));
  return {
    documents,
    find: jest.fn(() => ({ toArray: async () => documents.map((row) => ({ ...row })) })),
    countDocuments: jest.fn(async (query) => documents.filter((row) => {
      const idsToMatch = query.vendorProductId?.$in?.map(String) || [];
      return idsToMatch.includes(String(row.vendorProductId));
    }).length),
    insertOne: jest.fn(async (row) => {
      documents.push({ _id: `inserted-${documents.length + 1}`, ...row });
      return { insertedId: documents.at(-1)._id };
    }),
    updateOne: jest.fn(async (query, update) => {
      const row = documents.find((item) => String(item._id) === String(query._id));
      if (!row) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(row, update.$set || {});
      return { matchedCount: 1, modifiedCount: 1 };
    }),
  };
}

function input(overrides = {}) {
  return {
    collections: {
      vendorProducts: collection([
        {
          _id: ids.legacyProduct,
          vendorId: ids.vendor,
          productTypeGroupId: ids.legacyGroup,
          externalProductId: 'LFCG760',
          status: 'ACTIVE',
        },
        {
          _id: ids.canonicalProduct,
          vendorId: ids.vendor,
          productTypeGroupId: ids.canonicalGroup,
          externalProductId: 'LFCG760',
          status: 'ACTIVE',
        },
      ]),
      vendorCostCenters: collection([
        {
          _id: ids.legacyCostCenter,
          vendorProductId: ids.legacyProduct,
          vendorId: ids.vendor,
          code: '8CM-BASE',
          standardSize: '8cm',
          standardColor: 'Base Engraving',
          baseCostAmount: 230,
          currency: 'USD',
          status: 'ACTIVE',
        },
      ]),
      fulfillmentPlans: collection([]),
      financeSnapshots: collection([]),
      vendorSubmissions: collection([]),
    },
    canonicalMap: [{
      legacyProductTypeGroupId: ids.legacyGroup,
      canonicalProductTypeGroupId: ids.canonicalGroup,
    }],
    ...overrides,
  };
}

describe('vendor product canonicalization audit', () => {
  test('reports a mapped duplicate with a canonical target as safe', async () => {
    await expect(auditVendorProductCanonicalization(input())).resolves.toMatchObject({
      identityGroups: [{
        vendorId: ids.vendor,
        externalProductId: 'LFCG760',
        productCount: 2,
      }],
      missingMappings: [],
      costCenterConflicts: [],
      safeGroups: [{
        vendorId: ids.vendor,
        externalProductId: 'LFCG760',
        legacyProductId: ids.legacyProduct,
        canonicalProductId: ids.canonicalProduct,
      }],
    });
  });

  test('reports unmapped products and a missing canonical product without guessing by name', async () => {
    const data = input();
    data.collections.vendorProducts = collection([
      {
        _id: ids.legacyProduct,
        vendorId: ids.vendor,
        productTypeGroupId: ids.legacyGroup,
        externalProductId: 'LFCG760',
        name: 'Same display name',
      },
      {
        _id: ids.thirdProduct,
        vendorId: ids.vendor,
        productTypeGroupId: ids.thirdGroup,
        externalProductId: 'LFCG760',
        name: 'Same display name',
      },
    ]);

    const result = await auditVendorProductCanonicalization(data);

    expect(result.missingMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        legacyProductId: ids.legacyProduct,
        reason: 'CANONICAL_PRODUCT_NOT_FOUND',
      }),
      expect.objectContaining({
        legacyProductId: ids.thirdProduct,
        reason: 'PRODUCT_TYPE_GROUP_NOT_MAPPED',
      }),
    ]));
    expect(result.safeGroups).toEqual([]);
  });

  test('reports cost center value conflicts and immutable historical references', async () => {
    const data = input();
    data.collections.vendorCostCenters = collection([
      {
        vendorProductId: ids.legacyProduct,
        code: '8CM-BASE',
        standardSize: '8cm',
        standardColor: 'Base Engraving',
        baseCostAmount: 230,
        currency: 'USD',
        domesticShipping: { economyAmount: 100, additionalAmount: 20 },
        status: 'ACTIVE',
      },
      {
        vendorProductId: ids.canonicalProduct,
        code: '8CM-BASE',
        standardSize: '8cm',
        standardColor: 'Base Engraving',
        baseCostAmount: 230,
        currency: 'USD',
        domesticShipping: { economyAmount: 125, additionalAmount: 20 },
        status: 'ACTIVE',
      },
    ]);
    data.collections.fulfillmentPlans = collection([{ vendorProductId: ids.legacyProduct }]);
    data.collections.financeSnapshots = collection([{ vendorProductId: ids.legacyProduct }]);
    data.collections.vendorSubmissions = collection([{ vendorProductId: ids.legacyProduct }]);

    const result = await auditVendorProductCanonicalization(data);

    expect(result.costCenterConflicts).toEqual([
      expect.objectContaining({ code: '8CM-BASE', differingFields: ['domesticShipping'] }),
    ]);
    expect(result.historicalReferences).toEqual([
      expect.objectContaining({
        legacyProductId: ids.legacyProduct,
        fulfillmentPlans: 1,
        financeSnapshots: 1,
        vendorSubmissions: 1,
      }),
    ]);
    expect(result.safeGroups).toEqual([]);
  });

  test('rejects an invalid or duplicate legacy group in the canonical map', async () => {
    await expect(auditVendorProductCanonicalization(input({
      canonicalMap: [{
        legacyProductTypeGroupId: 'invalid',
        canonicalProductTypeGroupId: ids.canonicalGroup,
      }],
    }))).rejects.toThrow('Invalid legacyProductTypeGroupId');

    await expect(auditVendorProductCanonicalization(input({
      canonicalMap: [
        {
          legacyProductTypeGroupId: ids.legacyGroup,
          canonicalProductTypeGroupId: ids.canonicalGroup,
        },
        {
          legacyProductTypeGroupId: ids.legacyGroup,
          canonicalProductTypeGroupId: ids.thirdGroup,
        },
      ],
    }))).rejects.toThrow('Duplicate legacyProductTypeGroupId');
  });

  test('reports products that cannot participate because externalProductId is missing', async () => {
    const data = input();
    data.collections.vendorProducts = collection([{
      _id: ids.legacyProduct,
      vendorId: ids.vendor,
      productTypeGroupId: ids.legacyGroup,
      externalProductId: null,
    }]);

    await expect(auditVendorProductCanonicalization(data)).resolves.toMatchObject({
      missingExternalProductIds: [{ vendorProductId: ids.legacyProduct }],
    });
  });

  test('audits duplicate identities containing more than two products', async () => {
    const data = input();
    const products = await data.collections.vendorProducts.find({}).toArray();
    data.collections.vendorProducts = collection([
      ...products,
      {
        _id: ids.thirdProduct,
        vendorId: ids.vendor,
        productTypeGroupId: ids.thirdGroup,
        externalProductId: 'LFCG760',
      },
    ]);

    const result = await auditVendorProductCanonicalization(data);

    expect(result.identityGroups).toEqual([
      expect.objectContaining({ externalProductId: 'LFCG760', productCount: 3 }),
    ]);
    expect(result.missingMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        legacyProductId: ids.thirdProduct,
        reason: 'PRODUCT_TYPE_GROUP_NOT_MAPPED',
      }),
    ]));
  });

  test('supports an explicit product pair when product type groups cannot identify direction', async () => {
    const data = input({
      canonicalMap: [{
        legacyVendorProductId: ids.legacyProduct,
        canonicalVendorProductId: ids.canonicalProduct,
      }],
    });
    data.collections.vendorProducts.documents[1].productTypeGroupId = ids.legacyGroup;

    await expect(auditVendorProductCanonicalization(data)).resolves.toMatchObject({
      missingMappings: [],
      safeGroups: [{
        legacyProductId: ids.legacyProduct,
        canonicalProductId: ids.canonicalProduct,
      }],
    });
  });

  test('records a reviewed identity collision without making it eligible for migration', async () => {
    const data = input({
      canonicalMap: [{
        ignoredVendorProductIds: [ids.legacyProduct, ids.canonicalProduct],
        reason: 'DISTINCT_PRODUCTS_SHARE_EXTERNAL_ID',
      }],
    });

    await expect(auditVendorProductCanonicalization(data)).resolves.toMatchObject({
      missingMappings: [],
      safeGroups: [],
      ignoredIdentityGroups: [{
        vendorProductIds: [ids.legacyProduct, ids.canonicalProduct],
        reason: 'DISTINCT_PRODUCTS_SHARE_EXTERNAL_ID',
      }],
    });
  });

  test('rejects ignored product IDs that do not belong to the same vendor identity', async () => {
    const data = input({
      canonicalMap: [{
        ignoredVendorProductIds: [ids.legacyProduct, ids.thirdProduct],
        reason: 'DISTINCT_PRODUCTS_SHARE_EXTERNAL_ID',
      }],
    });
    data.collections.vendorProducts.documents.push({
      _id: ids.thirdProduct,
      vendorId: ids.vendor,
      productTypeGroupId: ids.thirdGroup,
      externalProductId: 'OTHER',
      status: 'ACTIVE',
    });

    await expect(auditVendorProductCanonicalization(data))
      .rejects.toThrow('ignoredVendorProductIds must share one vendor identity');

    data.canonicalMap = [{
      legacyVendorProductId: ids.legacyProduct,
      canonicalVendorProductId: ids.thirdProduct,
    }];
    await expect(auditVendorProductCanonicalization(data))
      .rejects.toThrow('Vendor product mapping must share one vendor identity');
  });
});

describe('vendor product canonicalization apply', () => {
  test('copies missing cost centers, deactivates equivalent legacy products, and rechecks blocked plans', async () => {
    const data = input();
    data.collections.fulfillmentPlans = collection([{
      vendorProductId: ids.legacyProduct,
      listingId: '660000000000000000000009',
      productTypeGroupId: ids.canonicalGroup,
      status: 'BLOCKED',
    }]);
    const recheckBlockedPlans = jest.fn().mockResolvedValue({ checked: 1 });

    const result = await applyVendorProductCanonicalization({
      ...data,
      now: new Date('2026-08-06T00:00:00.000Z'),
      recheckBlockedPlans,
    });

    expect(result).toMatchObject({
      copiedCostCenters: 1,
      skippedIdenticalCostCenters: 0,
      conflicts: [],
      deactivatedProducts: 1,
      rewrittenFinanceSnapshots: 0,
      rewrittenVendorSubmissions: 0,
      recheckedBlockedPlanGroups: 1,
    });
    expect(data.collections.vendorCostCenters.documents).toContainEqual(expect.objectContaining({
      vendorProductId: ids.canonicalProduct,
      code: '8CM-BASE',
    }));
    expect(data.collections.vendorProducts.documents.find((row) => row._id === ids.legacyProduct))
      .toMatchObject({ status: 'INACTIVE' });
    expect(recheckBlockedPlans).toHaveBeenCalledWith(
      '660000000000000000000009',
      ids.canonicalGroup,
    );
  });

  test('is idempotent when the canonical cost center already exists', async () => {
    const data = input();
    const legacy = data.collections.vendorCostCenters.documents[0];
    data.collections.vendorCostCenters.documents.push({
      ...legacy,
      _id: '660000000000000000000010',
      vendorProductId: ids.canonicalProduct,
    });

    const result = await applyVendorProductCanonicalization(data);

    expect(result).toMatchObject({
      copiedCostCenters: 0,
      skippedIdenticalCostCenters: 1,
      conflicts: [],
      deactivatedProducts: 1,
    });
  });

  test('does not copy, deactivate, or rewrite history when cost center values conflict', async () => {
    const data = input();
    const legacy = data.collections.vendorCostCenters.documents[0];
    data.collections.vendorCostCenters.documents.push({
      ...legacy,
      _id: '660000000000000000000010',
      vendorProductId: ids.canonicalProduct,
      baseCostAmount: 999,
    });
    const financeBefore = [...data.collections.financeSnapshots.documents];
    const submissionsBefore = [...data.collections.vendorSubmissions.documents];

    const result = await applyVendorProductCanonicalization(data);

    expect(result).toMatchObject({
      copiedCostCenters: 0,
      deactivatedProducts: 0,
      conflicts: [expect.objectContaining({ code: '8CM-BASE' })],
      rewrittenFinanceSnapshots: 0,
      rewrittenVendorSubmissions: 0,
    });
    expect(data.collections.vendorProducts.documents.find((row) => row._id === ids.legacyProduct))
      .toMatchObject({ status: 'ACTIVE' });
    expect(data.collections.financeSnapshots.documents).toEqual(financeBefore);
    expect(data.collections.vendorSubmissions.documents).toEqual(submissionsBefore);
  });

  test('does not migrate into an inactive canonical product', async () => {
    const data = input();
    data.collections.vendorProducts.documents.find((row) => row._id === ids.canonicalProduct).status = 'INACTIVE';

    const result = await applyVendorProductCanonicalization(data);

    expect(result).toMatchObject({ copiedCostCenters: 0, deactivatedProducts: 0 });
    expect(data.collections.vendorProducts.documents.find((row) => row._id === ids.legacyProduct))
      .toMatchObject({ status: 'ACTIVE' });
  });

  test('does no work on a second run after the legacy product was deactivated', async () => {
    const data = input();

    await applyVendorProductCanonicalization(data);
    const rerun = await applyVendorProductCanonicalization(data);

    expect(rerun).toMatchObject({
      copiedCostCenters: 0,
      deactivatedProducts: 0,
      rewrittenFinanceSnapshots: 0,
      rewrittenVendorSubmissions: 0,
    });
  });

  test('treats a duplicate-key insert race as an idempotent skip', async () => {
    const data = input();
    data.collections.vendorCostCenters.insertOne.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), { code: 11000 }),
    );

    const result = await applyVendorProductCanonicalization(data);

    expect(result).toMatchObject({
      copiedCostCenters: 0,
      skippedIdenticalCostCenters: 1,
      deactivatedProducts: 1,
    });
  });
});
