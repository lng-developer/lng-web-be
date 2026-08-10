const { toOrderTimelineDto } = require('../../../src/modules/order/dtos/orderTimeline.dto');

describe('orderTimeline.dto', () => {
  test('keeps actor display fields for timeline UI', () => {
    const dto = toOrderTimelineDto({
      _id: '660000000000000000000801',
      orderId: '660000000000000000000301',
      orderItemId: '660000000000000000000401',
      shopId: '660000000000000000000201',
      eventType: 'ORDER_ITEM_STATUS_CHANGED',
      source: 'USER',
      actorId: '660000000000000000000901',
      actor: {
        accountId: '660000000000000000000901',
        fullName: 'Nguyen Mai Phuong',
        employeeCode: 'J2508',
        displayName: 'Nguyen Mai Phuong',
      },
    });

    expect(dto.actor).toEqual({
      accountId: '660000000000000000000901',
      fullName: 'Nguyen Mai Phuong',
      employeeCode: 'J2508',
      displayName: 'Nguyen Mai Phuong',
    });
  });
});
