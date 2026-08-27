const { buildMergePlan } = require('../../../src/modules/vendor/scripts/mergeLegacyVendorProductDuplicates');

describe('buildMergePlan', () => {
  test('keeps the imported PRODUCT row and moves variants from its duplicate', () => {
    const plan = buildMergePlan({
      products: [
        { _id: 'a', vendorId: 'vendor-1', code: 'PRODUCT_1717', metadata: { legacyId: 'legacy-1' } },
        { _id: 'b', vendorId: 'vendor-1', code: '1717', metadata: { legacyId: 'legacy-1' } },
      ],
      costCenters: [
        { _id: 'cost-a', vendorProductId: 'a', code: 'PRODUCT_1717_M_BLACK' },
        { _id: 'cost-b', vendorProductId: 'b', code: '1717_M_BLACK' },
      ],
    });

    expect(plan.pairs).toEqual([{ canonicalProductId: 'a', duplicateProductId: 'b' }]);
    expect(plan.costCenterMoves).toEqual([{ costCenterId: 'cost-b', vendorProductId: 'a' }]);
    expect(plan.codeConflicts).toEqual([]);
  });

  test('blocks the merge when moving a variant would violate the product code index', () => {
    const plan = buildMergePlan({
      products: [
        { _id: 'a', vendorId: 'vendor-1', code: 'PRODUCT_1717', metadata: { legacyId: 'legacy-1' } },
        { _id: 'b', vendorId: 'vendor-1', code: '1717', metadata: { legacyId: 'legacy-1' } },
      ],
      costCenters: [
        { _id: 'cost-a', vendorProductId: 'a', code: 'S_BLACK' },
        { _id: 'cost-b', vendorProductId: 'b', code: 'S_BLACK' },
      ],
    });

    expect(plan.codeConflicts).toEqual([{ canonicalProductId: 'a', duplicateProductId: 'b', code: 'S_BLACK' }]);
  });
});
