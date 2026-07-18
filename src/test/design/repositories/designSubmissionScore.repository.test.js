const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const repository = require('../../../modules/design/repositories/designSubmissionScore.repository');
const DesignSubmissionScore = require('../../../modules/design/models/designSubmissionScore.model');

describe('designSubmissionScore.repository', () => {
  beforeAll(async () => {
    await connectDatabase();
    await DesignSubmissionScore.deleteMany({});
  });

  afterEach(async () => {
    await DesignSubmissionScore.deleteMany({});
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  test('upserts one score per task submission without overwriting an override', async () => {
    const taskId = new mongoose.Types.ObjectId();
    const submissionId = new mongoose.Types.ObjectId();
    const payload = {
      taskId,
      submissionId,
      taskType: 'PSD_TEMPLATE',
      submissionVersion: 1,
      designerId: new mongoose.Types.ObjectId(),
      designerName: 'Designer A',
      basePoints: 3,
      finalPoints: 3,
      scoreLevel: 'STANDARD',
      status: 'ACTIVE',
      scoredAt: new Date('2026-07-18T00:00:00Z'),
      ruleSnapshot: { taskType: 'PSD_TEMPLATE', points: 3 },
    };

    await repository.upsertAutoScore(payload);
    await DesignSubmissionScore.updateOne(
      { taskId, submissionId },
      { $set: { finalPoints: 7, override: { points: 7, reason: 'Complex exception' } } },
    );
    await repository.upsertAutoScore({ ...payload, finalPoints: 3 });

    const rows = await DesignSubmissionScore.find({ taskId, submissionId }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].finalPoints).toBe(7);
    expect(rows[0].override.reason).toBe('Complex exception');
  });

  test('returns no rows without querying for empty submission ids', async () => {
    await expect(repository.findBySubmissionIds([])).resolves.toEqual([]);
  });

  test('summarizes active scores through the inclusive end of dateTo', async () => {
    const designerId = new mongoose.Types.ObjectId();
    await DesignSubmissionScore.create([
      {
        taskId: new mongoose.Types.ObjectId(),
        submissionId: new mongoose.Types.ObjectId(),
        taskType: 'PSD_TEMPLATE',
        submissionVersion: 1,
        designerId,
        designerName: 'Designer A',
        basePoints: 3,
        finalPoints: 3,
        scoreLevel: 'STANDARD',
        status: 'ACTIVE',
        scoredAt: new Date('2026-07-31T23:59:59.999Z'),
      },
      {
        taskId: new mongoose.Types.ObjectId(),
        submissionId: new mongoose.Types.ObjectId(),
        taskType: 'PSD_TEMPLATE',
        submissionVersion: 2,
        designerId,
        designerName: 'Designer A',
        basePoints: 3,
        finalPoints: 3,
        scoreLevel: 'STANDARD',
        status: 'VOIDED',
        scoredAt: new Date('2026-07-31T12:00:00Z'),
      },
    ]);

    const result = await repository.summarize({
      designerId,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });

    expect(result).toMatchObject({ totalPoints: 3, totalFiles: 1 });
    expect(result.byDesigner).toHaveLength(1);
    expect(result.byTaskType).toEqual([
      expect.objectContaining({ taskType: 'PSD_TEMPLATE', totalPoints: 3, totalFiles: 1 }),
    ]);
  });

  test('voids only an active score and leaves an already voided score unchanged', async () => {
    const taskId = new mongoose.Types.ObjectId();
    const submissionId = new mongoose.Types.ObjectId();
    await DesignSubmissionScore.create({
      taskId,
      submissionId,
      taskType: 'IDEA',
      submissionVersion: 1,
      designerId: new mongoose.Types.ObjectId(),
      basePoints: 2,
      finalPoints: 2,
      scoreLevel: 'STANDARD',
      status: 'ACTIVE',
      scoredAt: new Date(),
    });

    const voided = await repository.voidByTaskSubmission(taskId, submissionId, {
      voidReason: 'Submission removed',
    });
    const repeated = await repository.voidByTaskSubmission(taskId, submissionId, {
      voidReason: 'Changed reason',
    });

    expect(voided.status).toBe('VOIDED');
    expect(repeated).toBeNull();
  });
});
