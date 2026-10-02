const DesignRequest = require('../../../src/modules/design/models/designRequest.model');

describe('DesignRequest model', () => {
  test('has a partial unique index for active order-item PSD requests', () => {
    expect(DesignRequest.schema.indexes()).toContainEqual([
      { orderItemId: 1, requestType: 1 },
      expect.objectContaining({ unique: true, partialFilterExpression: { status: { $in: ['PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_PROGRESS'] } } }),
    ]);
  });
});
