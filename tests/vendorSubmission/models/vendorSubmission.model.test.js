const VendorSubmission = require('../../../src/modules/vendorSubmission/models/vendorSubmission.model');

describe('VendorSubmission model indexes', () => {
  test('indexes latest lookup by production task id and update time', () => {
    expect(VendorSubmission.schema.indexes()).toEqual(expect.arrayContaining([
      [
        { productionTaskId: 1, updatedAt: -1, _id: -1 },
        expect.any(Object),
      ],
    ]));
  });
});
