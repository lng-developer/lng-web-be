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
});
