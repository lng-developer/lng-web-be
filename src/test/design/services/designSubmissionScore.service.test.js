const mongoose = require('mongoose');

jest.mock('../../../modules/auth/public', () => ({
  listProfilesByAccountIds: jest.fn(),
}));

jest.mock('../../../modules/organization/public', () => ({
  listAccountOrganizationSummaries: jest.fn(),
}));

jest.mock('../../../modules/design/repositories/designSubmissionScore.repository', () => ({
  upsertAutoScore: jest.fn(),
  overrideScore: jest.fn(),
  voidByTaskSubmission: jest.fn(),
  summarize: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const organizationPublic = require('../../../modules/organization/public');
const repository = require('../../../modules/design/repositories/designSubmissionScore.repository');
const service = require('../../../modules/design/services/designSubmissionScore.service');

const id = () => new mongoose.Types.ObjectId();

describe('designSubmissionScore.service', () => {
  const taskId = id();
  const submissionId = id();
  const designerId = id();
  const reviewerId = id();
  const teamId = id();
  const departmentId = id();
  const task = { _id: taskId, taskType: 'PSD_TEMPLATE', priority: 'NORMAL' };
  const submission = { _id: submissionId, version: 1, submittedBy: designerId, status: 'APPROVED' };

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.listProfilesByAccountIds.mockResolvedValue([{ accountId: designerId, fullName: 'Designer A' }]);
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([{
      accountId: String(designerId),
      team: { id: String(teamId), name: 'Team A' },
      department: { id: String(departmentId), name: 'Design' },
    }]);
    repository.upsertAutoScore.mockImplementation(async (payload) => ({ _id: id(), ...payload }));
  });

  test.each([
    ['PSD_TEMPLATE', 'NORMAL', 3, 3, 'STANDARD'],
    ['PNG_ASSET', 'NORMAL', 1, 1, 'STANDARD'],
    ['MOCKUP', 'NORMAL', 1, 1, 'STANDARD'],
    ['IDEA', 'NORMAL', 2, 2, 'STANDARD'],
    ['CLONE', 'NORMAL', 1, 1, 'STANDARD'],
    ['IDEA', 'HIGH', 2, 2.5, 'HARD'],
    ['PNG_ASSET', 'URGENT', 1, 1.5, 'HARD'],
  ])('computes %s with %s priority', (taskType, priority, basePoints, finalPoints, scoreLevel) => {
    expect(service.computeDefaultScore({ taskType, priority })).toMatchObject({
      basePoints,
      finalPoints,
      scoreLevel,
    });
  });

  test('scores an approved submission with profile and first organization snapshots', async () => {
    const result = await service.scoreApprovedSubmission(task, submission, { accountId: reviewerId });

    expect(authPublic.listProfilesByAccountIds).toHaveBeenCalledWith([String(designerId)]);
    expect(organizationPublic.listAccountOrganizationSummaries).toHaveBeenCalledWith([String(designerId)]);
    expect(repository.upsertAutoScore).toHaveBeenCalledWith(expect.objectContaining({
      taskId: String(taskId),
      submissionId: String(submissionId),
      taskType: 'PSD_TEMPLATE',
      submissionVersion: 1,
      designerId: String(designerId),
      designerName: 'Designer A',
      teamId: String(teamId),
      teamName: 'Team A',
      departmentId: String(departmentId),
      departmentName: 'Design',
      basePoints: 3,
      finalPoints: 3,
      scoreLevel: 'STANDARD',
      scoredBy: reviewerId,
    }));
    expect(result).toMatchObject({
      taskId: String(taskId),
      submissionId: String(submissionId),
      designer: { id: String(designerId), name: 'Designer A' },
      team: { id: String(teamId), name: 'Team A' },
      department: { id: String(departmentId), name: 'Design' },
    });
  });

  test.each([
    [{ ...submission, status: 'SUBMITTED' }, task],
    [{ ...submission, submittedBy: null }, task],
    [{ ...submission, _id: null }, task],
    [submission, { ...task, _id: null }],
  ])('does not persist invalid or inactive submissions', async (candidateSubmission, candidateTask) => {
    await expect(service.scoreApprovedSubmission(candidateTask, candidateSubmission, {})).resolves.toBeNull();
    expect(repository.upsertAutoScore).not.toHaveBeenCalled();
  });

  test('accepts zero override points and maps override ids', async () => {
    const scoreId = id();
    repository.overrideScore.mockImplementation(async (ignoredScoreId, patch) => ({
      _id: scoreId,
      taskId,
      submissionId,
      taskType: 'PSD_TEMPLATE',
      designerId,
      basePoints: 3,
      finalPoints: patch.finalPoints,
      scoreLevel: patch.scoreLevel,
      status: 'ACTIVE',
      override: patch.override,
    }));

    const result = await service.overrideSubmissionScore(scoreId, {
      points: 0,
      overrideReason: 'Quality issue',
    }, { accountId: reviewerId });

    expect(repository.overrideScore).toHaveBeenCalledWith(scoreId, expect.objectContaining({
      finalPoints: 0,
      scoreLevel: 'BONUS',
      override: expect.objectContaining({ points: 0, reason: 'Quality issue', overriddenBy: reviewerId }),
    }));
    expect(result.override).toMatchObject({
      points: 0,
      reason: 'Quality issue',
      overriddenBy: String(reviewerId),
    });
  });

  test.each([
    [{ points: -1, overrideReason: 'Quality issue' }, 'points must be a non-negative number'],
    [{ points: null, overrideReason: 'Quality issue' }, 'points must be a non-negative number'],
    [{ points: '', overrideReason: 'Quality issue' }, 'points must be a non-negative number'],
    [{ points: '   ', overrideReason: 'Quality issue' }, 'points must be a non-negative number'],
    [{ points: 1 }, 'overrideReason is required'],
  ])('rejects invalid overrides', async (payload, message) => {
    await expect(service.overrideSubmissionScore(id(), payload, {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message,
    });
    expect(repository.overrideScore).not.toHaveBeenCalled();
  });

  test('fails override for a missing or inactive score', async () => {
    repository.overrideScore.mockResolvedValue(null);

    await expect(service.overrideSubmissionScore(id(), {
      points: 1,
      overrideReason: 'Correction',
    }, {})).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 });
  });

  test('voids an active score without changing final points', async () => {
    repository.voidByTaskSubmission.mockResolvedValue({
      _id: id(), taskId, submissionId, taskType: 'IDEA', designerId, basePoints: 2,
      finalPoints: 2.5, scoreLevel: 'HARD', status: 'VOIDED', voidedBy: reviewerId,
      voidedAt: new Date('2026-07-18T00:00:00.000Z'), voidReason: 'Duplicate',
    });

    const result = await service.voidSubmissionScore(taskId, submissionId, {
      voidReason: 'Duplicate',
    }, { accountId: reviewerId });

    expect(repository.voidByTaskSubmission).toHaveBeenCalledWith(taskId, submissionId, expect.objectContaining({
      voidedBy: reviewerId,
      voidReason: 'Duplicate',
    }));
    expect(repository.voidByTaskSubmission.mock.calls[0][2]).not.toHaveProperty('finalPoints');
    expect(result).toMatchObject({ finalPoints: 2.5, status: 'VOIDED', voidReason: 'Duplicate' });
  });

  test.each([
    [{}, 'voidReason is required'],
    [{ voidReason: '   ' }, 'voidReason is required'],
  ])('requires a void reason', async (payload, message) => {
    await expect(service.voidSubmissionScore(taskId, submissionId, payload, {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message,
    });
    expect(repository.voidByTaskSubmission).not.toHaveBeenCalled();
  });

  test('fails void for a missing or inactive score', async () => {
    repository.voidByTaskSubmission.mockResolvedValue(null);

    await expect(service.voidSubmissionScore(taskId, submissionId, {
      voidReason: 'Duplicate',
    }, {})).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', statusCode: 404 });
  });

  test('maps score summaries without leaking raw ids', async () => {
    repository.summarize.mockResolvedValue({
      totalPoints: 5.5,
      totalFiles: 2,
      byDesigner: [{
        designerId,
        designerName: 'Designer A',
        teamId,
        teamName: 'Team A',
        departmentId,
        departmentName: 'Design',
        totalPoints: 5.5,
        totalFiles: 2,
      }],
      byTaskType: [{ taskType: 'IDEA', totalPoints: 2.5, totalFiles: 1 }],
    });

    await expect(service.summarizeScores({ taskType: 'IDEA' })).resolves.toEqual({
      totalPoints: 5.5,
      totalFiles: 2,
      byDesigner: [{
        designerId: String(designerId),
        designerName: 'Designer A',
        teamId: String(teamId),
        teamName: 'Team A',
        departmentId: String(departmentId),
        departmentName: 'Design',
        totalPoints: 5.5,
        totalFiles: 2,
      }],
      byTaskType: [{ taskType: 'IDEA', totalPoints: 2.5, totalFiles: 1 }],
    });
    expect(repository.summarize).toHaveBeenCalledWith({ taskType: 'IDEA' });
  });
});
