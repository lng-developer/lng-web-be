const orderTrackingDeadlineScanner = require('../../src/modules/order/services/orderTrackingDeadlineScanner.service');
const orderRepository = require('../../src/modules/order/repositories/order.repository');
const notificationPublic = require('../../src/modules/notification/public');
const organizationPublic = require('../../src/modules/organization/public');

jest.mock('../../src/modules/order/repositories/order.repository');
jest.mock('../../src/modules/notification/public');
jest.mock('../../src/modules/organization/public');

describe('OrderTrackingDeadlineScanner', () => {
  const baseTime = new Date('2026-11-17T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scans candidate orders and sends 48h alert to sellers only', async () => {
    const orderIn36h = {
      _id: 'order-48h',
      externalOrderId: 'AMZ-48H',
      status: 'IN_PRODUCTION',
      shipByDate: new Date('2026-11-18T20:00:00.000Z'), // ~32 hours ahead (between 24h and 48h)
      assignedStaffIds: ['staff-1'],
      orderItems: [{ fulfillmentStatus: 'PENDING' }],
    };

    orderRepository.findTrackingDeadlineCandidates.mockResolvedValue([orderIn36h]);
    notificationPublic.notify.mockResolvedValue({ delivered: true, id: 'noti-1' });

    const result = await orderTrackingDeadlineScanner.scanOrderTrackingDeadlines({ now: baseTime });

    expect(result.scanned).toBe(1);
    expect(result.due48h).toBe(1);
    expect(result.due24h).toBe(0);
    expect(result.overdue).toBe(0);
    expect(result.notified).toBe(1);

    // Organization leaders should NOT be resolved for 48h alert
    expect(organizationPublic.listLeadersForAccountIds).not.toHaveBeenCalled();

    expect(notificationPublic.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientAccountId: 'staff-1',
        type: 'ORDER_TRACKING_DUE_48H',
        title: expect.stringContaining('due in 48h'),
        deduplicationKey: expect.stringContaining('ORDER_TRACKING_DUE_48H:order-48h:staff-1:2026-11-17'),
      }),
    );
  });

  it('scans candidate orders and sends 24h alert to both sellers and their team leaders', async () => {
    const orderIn12h = {
      _id: 'order-24h',
      externalOrderId: 'AMZ-24H',
      status: 'IN_PRODUCTION',
      shipByDate: new Date('2026-11-18T00:00:00.000Z'), // 12 hours ahead (< 24h)
      assignedStaffIds: ['staff-1'],
      orderItems: [{ fulfillmentStatus: 'PENDING' }],
    };

    orderRepository.findTrackingDeadlineCandidates.mockResolvedValue([orderIn12h]);
    organizationPublic.listLeadersForAccountIds.mockResolvedValue(['leader-1']);
    notificationPublic.notify.mockResolvedValue({ delivered: true, id: 'noti-1' });

    const result = await orderTrackingDeadlineScanner.scanOrderTrackingDeadlines({ now: baseTime });

    expect(result.due24h).toBe(1);
    expect(result.notified).toBe(2);

    expect(organizationPublic.listLeadersForAccountIds).toHaveBeenCalledWith(['staff-1']);

    expect(notificationPublic.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientAccountId: 'staff-1',
        type: 'ORDER_TRACKING_DUE_24H',
        title: expect.stringContaining('due in 24h'),
      }),
    );

    expect(notificationPublic.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientAccountId: 'leader-1',
        type: 'ORDER_TRACKING_DUE_24H',
        title: expect.stringContaining('due in 24h'),
      }),
    );
  });

  it('scans candidate orders and sends OVERDUE alert to both sellers and leaders', async () => {
    const overdueOrder = {
      _id: 'order-overdue',
      externalOrderId: 'AMZ-OVERDUE',
      status: 'IN_PRODUCTION',
      shipByDate: new Date('2026-11-16T10:00:00.000Z'), // Past shipByDate
      assignedStaffIds: ['staff-2'],
      orderItems: [{ fulfillmentStatus: 'PENDING' }],
    };

    orderRepository.findTrackingDeadlineCandidates.mockResolvedValue([overdueOrder]);
    organizationPublic.listLeadersForAccountIds.mockResolvedValue(['leader-2']);
    notificationPublic.notify.mockResolvedValue({ delivered: true, id: 'noti-1' });

    const result = await orderTrackingDeadlineScanner.scanOrderTrackingDeadlines({ now: baseTime });

    expect(result.overdue).toBe(1);
    expect(result.notified).toBe(2);

    expect(notificationPublic.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientAccountId: 'staff-2',
        type: 'ORDER_TRACKING_OVERDUE',
        title: expect.stringContaining('overdue'),
        deduplicationKey: expect.stringContaining('ORDER_TRACKING_OVERDUE:order-overdue:staff-2:2026-11-17'),
      }),
    );

    expect(notificationPublic.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientAccountId: 'leader-2',
        type: 'ORDER_TRACKING_OVERDUE',
        title: expect.stringContaining('overdue'),
      }),
    );
  });

  it('skips orders where all items are already fulfilled', async () => {
    const fulfilledOrder = {
      _id: 'order-fulfilled',
      externalOrderId: 'AMZ-FULFILLED',
      status: 'IN_PRODUCTION',
      shipByDate: new Date('2026-11-16T10:00:00.000Z'),
      assignedStaffIds: ['staff-1'],
      orderItems: [{ fulfillmentStatus: 'FULFILLED' }, { fulfillmentStatus: 'FULFILLED' }],
    };

    orderRepository.findTrackingDeadlineCandidates.mockResolvedValue([fulfilledOrder]);

    const result = await orderTrackingDeadlineScanner.scanOrderTrackingDeadlines({ now: baseTime });

    expect(result.scanned).toBe(1);
    expect(result.notified).toBe(0);
    expect(notificationPublic.notify).not.toHaveBeenCalled();
  });
});
