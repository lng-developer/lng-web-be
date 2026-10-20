const { toDesignTaskDto } = require('../../../src/modules/design/dtos/designTask.dto');

describe('design task listing image', () => {
  test.each([
    ['current.jpg', 'snapshot.jpg', 'current.jpg'],
    [null, 'snapshot.jpg', 'snapshot.jpg'],
    [null, null, 'order.jpg'],
  ])('prefers current image %s over snapshot %s', (current, snapshot, expected) => {
    const task = {
      _id: 'task', taskType: 'PSD_TEMPLATE', listingId: 'listing',
      listingSnapshot: { id: 'listing', productImageUrl: snapshot },
    };
    const dto = toDesignTaskDto(task, {
      listingsById: { listing: { productImageUrl: current } },
      orderContextByListingId: { listing: { productImageUrl: 'order.jpg' } },
    });
    expect(dto.listing.productImageUrl).toBe(expected);
    expect(task.listingSnapshot.productImageUrl).toBe(snapshot);
  });

  test('includes the persisted task and submission timeline', () => {
    const dto = toDesignTaskDto({
      _id: 'task',
      taskType: 'PSD_TEMPLATE',
      listingId: 'listing',
      createdAt: new Date('2026-10-20T01:00:00.000Z'),
      assignedAt: new Date('2026-10-20T02:00:00.000Z'),
      startedAt: new Date('2026-10-20T03:00:00.000Z'),
      submissions: [{
        version: 1,
        status: 'APPROVED',
        submittedAt: new Date('2026-10-20T04:00:00.000Z'),
        approvedAt: new Date('2026-10-20T05:00:00.000Z'),
      }],
    });

    expect(dto.history).toEqual([
      { action: 'Approved (v1)', at: new Date('2026-10-20T05:00:00.000Z') },
      { action: 'Submitted (v1)', at: new Date('2026-10-20T04:00:00.000Z') },
      { action: 'Started', at: new Date('2026-10-20T03:00:00.000Z') },
      { action: 'Assigned', at: new Date('2026-10-20T02:00:00.000Z') },
      { action: 'Created', at: new Date('2026-10-20T01:00:00.000Z') },
    ]);
  });
});
