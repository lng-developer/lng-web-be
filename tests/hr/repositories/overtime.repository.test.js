jest.mock('../../../src/modules/hr/models/overtimeRequest.model', () => ({
  find: jest.fn(),
}));

const OvertimeRequest = require('../../../src/modules/hr/models/overtimeRequest.model');
const repository = require('../../../src/modules/hr/repositories/overtime.repository');

describe('overtime repository', () => {
  test('queries overlap by absolute range without restricting workDateKey', async () => {
    const lean = jest.fn().mockResolvedValue([]);
    OvertimeRequest.find.mockReturnValue({ lean });
    const profileId = '660000000000000000000001';
    const plannedStartAt = new Date('2026-07-20T18:00:00.000Z');
    const plannedEndAt = new Date('2026-07-20T19:00:00.000Z');

    await repository.findOverlappingRequests(profileId, plannedStartAt, plannedEndAt);

    expect(OvertimeRequest.find).toHaveBeenCalledWith({
      profileId,
      status: { $in: ['PENDING', 'APPROVED'] },
      plannedStartAt: { $lt: plannedEndAt },
      plannedEndAt: { $gt: plannedStartAt },
    });
    expect(lean).toHaveBeenCalledTimes(1);
  });
});
