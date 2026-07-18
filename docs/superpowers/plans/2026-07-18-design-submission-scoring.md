# Design Submission Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add KPI scoring for design files so approved design submissions receive automatic points, leaders can override exceptions, and reports can aggregate points by designer/team/period.

**Architecture:** Keep scoring inside the `design` module because the scored unit is a design task submission. Store immutable-ish score entries in a separate `DesignSubmissionScore` collection keyed by `taskId + submissionId`; snapshot designer/team/rule data at scoring time so historical KPI reports do not change when organization membership changes. Reuse `organization.public` and `auth.public`; do not create a broad KPI module in this slice.

**Tech Stack:** Node.js, Express, CommonJS, Mongoose, Joi, Jest, existing auth/organization/design module patterns.

## Global Constraints

- No new dependencies.
- Do not change existing design task submit/approve/reject flow except to create/update score entries after approval.
- Score is computed by BE only; FE displays and sends override requests.
- Default scoring must handle bulk approval without manual per-file input.
- Only approved submissions count toward KPI totals.
- Rejected, removed, and voided scores do not count toward KPI totals.
- Score reports must use score-entry snapshots for designer/team/department names and IDs.
- Cross-module calls must go through module `public.js` files.
- Do not add negative points in V1.

---

## File Structure

- Create `src/modules/design/models/designSubmissionScore.model.js`
  - Stores one score entry per scored submission.
- Create `src/modules/design/repositories/designSubmissionScore.repository.js`
  - Owns Mongoose queries for upsert, override, void, and aggregation.
- Create `src/modules/design/services/designSubmissionScore.service.js`
  - Computes default score, snapshots organization/profile data, handles override/void/report rules.
- Create `src/modules/design/dtos/designSubmissionScore.dto.js`
  - Shapes score entries and summary responses.
- Modify `src/modules/design/constants/design.constants.js`
  - Adds scoring levels/statuses and permission constant reuse.
- Modify `src/modules/design/validators/designTask.validator.js`
  - Adds score override and score summary query validators.
- Modify `src/modules/design/controllers/designTask.controller.js`
  - Adds score override, void, and summary handlers.
- Modify `src/modules/design/routes/index.js`
  - Mounts score endpoints before `/:taskId` dynamic routes.
- Modify `src/modules/design/services/designTask.service.js`
  - Calls scoring service after approval and voids score when approved submission is removed/cancelled where allowed.
- Modify `src/modules/design/dtos/designTask.dto.js`
  - Includes score data in submission DTOs when detail is requested.
- Modify `src/modules/organization/public.js`
  - Add a small helper to get active organization summary for one account if needed.
- Add focused tests under `src/test/design/`.

---

### Task 1: Add Score Model And Repository

**Files:**
- Create: `src/modules/design/models/designSubmissionScore.model.js`
- Create: `src/modules/design/repositories/designSubmissionScore.repository.js`
- Test: `src/test/design/repositories/designSubmissionScore.repository.test.js`

**Interfaces:**
- Produces: `upsertAutoScore(payload)`, `findBySubmissionIds(submissionIds)`, `overrideScore(scoreId, patch)`, `voidByTaskSubmission(taskId, submissionId, patch)`, `summarize(query)`.
- Consumes: Mongoose only.

- [ ] **Step 1: Write repository tests**

```js
const mongoose = require('mongoose');
const repository = require('../../../modules/design/repositories/designSubmissionScore.repository');
const DesignSubmissionScore = require('../../../modules/design/models/designSubmissionScore.model');

describe('designSubmissionScore.repository', () => {
  afterEach(async () => {
    await DesignSubmissionScore.deleteMany({});
  });

  it('upserts one score per task submission', async () => {
    const taskId = new mongoose.Types.ObjectId();
    const submissionId = new mongoose.Types.ObjectId();

    await repository.upsertAutoScore({
      taskId,
      submissionId,
      taskType: 'PSD_TEMPLATE',
      submissionVersion: 1,
      designerId: new mongoose.Types.ObjectId(),
      designerName: 'Designer A',
      teamId: new mongoose.Types.ObjectId(),
      teamName: 'Design Team',
      departmentId: new mongoose.Types.ObjectId(),
      departmentName: 'Design',
      basePoints: 3,
      finalPoints: 3,
      scoreLevel: 'STANDARD',
      status: 'ACTIVE',
      scoredBy: new mongoose.Types.ObjectId(),
      scoredAt: new Date('2026-07-18T00:00:00Z'),
      ruleSnapshot: { taskType: 'PSD_TEMPLATE', points: 3 },
    });

    await repository.upsertAutoScore({
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
      scoredBy: new mongoose.Types.ObjectId(),
      scoredAt: new Date('2026-07-18T00:00:00Z'),
      ruleSnapshot: { taskType: 'PSD_TEMPLATE', points: 3 },
    });

    const rows = await DesignSubmissionScore.find({ taskId, submissionId }).lean();
    expect(rows).toHaveLength(1);
  });

  it('summarizes only active scores in date range', async () => {
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
        scoredAt: new Date('2026-07-18T00:00:00Z'),
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
        scoredAt: new Date('2026-07-18T00:00:00Z'),
      },
    ]);

    const result = await repository.summarize({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
    });

    expect(result.totalPoints).toBe(3);
    expect(result.totalFiles).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/test/design/repositories/designSubmissionScore.repository.test.js --runInBand`

Expected: FAIL because model/repository files do not exist.

- [ ] **Step 3: Create model**

```js
const mongoose = require('mongoose');
const {
  designScoreLevels,
  designScoreStatuses,
} = require('../constants/design.constants');

const { Schema } = mongoose;

const designSubmissionScoreSchema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: 'DesignTask', required: true, index: true },
  submissionId: { type: Schema.Types.ObjectId, required: true, index: true },
  taskType: { type: String, required: true, index: true },
  submissionVersion: { type: Number, required: true, min: 1 },
  designerId: { type: Schema.Types.ObjectId, required: true, index: true },
  designerName: { type: String, trim: true, default: null },
  teamId: { type: Schema.Types.ObjectId, default: null, index: true },
  teamName: { type: String, trim: true, default: null },
  departmentId: { type: Schema.Types.ObjectId, default: null, index: true },
  departmentName: { type: String, trim: true, default: null },
  basePoints: { type: Number, required: true, min: 0 },
  finalPoints: { type: Number, required: true, min: 0 },
  scoreLevel: {
    type: String,
    enum: Object.values(designScoreLevels),
    required: true,
  },
  status: {
    type: String,
    enum: Object.values(designScoreStatuses),
    required: true,
    default: designScoreStatuses.ACTIVE,
    index: true,
  },
  ruleSnapshot: { type: Schema.Types.Mixed, default: null },
  override: {
    points: { type: Number, min: 0, default: null },
    reason: { type: String, trim: true, default: null },
    overriddenBy: { type: Schema.Types.ObjectId, default: null },
    overriddenAt: { type: Date, default: null },
  },
  scoredBy: { type: Schema.Types.ObjectId, default: null },
  scoredAt: { type: Date, default: Date.now, index: true },
  voidedBy: { type: Schema.Types.ObjectId, default: null },
  voidedAt: { type: Date, default: null },
  voidReason: { type: String, trim: true, default: null },
}, { timestamps: true });

designSubmissionScoreSchema.index({ taskId: 1, submissionId: 1 }, { unique: true });
designSubmissionScoreSchema.index({ status: 1, scoredAt: -1 });
designSubmissionScoreSchema.index({ designerId: 1, status: 1, scoredAt: -1 });
designSubmissionScoreSchema.index({ teamId: 1, status: 1, scoredAt: -1 });
designSubmissionScoreSchema.index({ departmentId: 1, status: 1, scoredAt: -1 });

module.exports = mongoose.model('DesignSubmissionScore', designSubmissionScoreSchema);
```

- [ ] **Step 4: Add constants**

In `src/modules/design/constants/design.constants.js`, add:

```js
const designScoreLevels = Object.freeze({
  BASIC: 'BASIC',
  STANDARD: 'STANDARD',
  HARD: 'HARD',
  BONUS: 'BONUS',
});

const designScoreStatuses = Object.freeze({
  ACTIVE: 'ACTIVE',
  VOIDED: 'VOIDED',
});
```

And export both.

- [ ] **Step 5: Create repository**

```js
const DesignSubmissionScore = require('../models/designSubmissionScore.model');
const { designScoreStatuses } = require('../constants/design.constants');

function normalizeDateEnd(value) {
  if (!value) return null;
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function buildMatch(query = {}) {
  const match = {
    status: query.status || designScoreStatuses.ACTIVE,
  };
  if (query.designerId) match.designerId = query.designerId;
  if (query.teamId) match.teamId = query.teamId;
  if (query.departmentId) match.departmentId = query.departmentId;
  if (query.taskType) match.taskType = query.taskType;
  if (query.dateFrom || query.dateTo) {
    match.scoredAt = {};
    if (query.dateFrom) match.scoredAt.$gte = new Date(query.dateFrom);
    if (query.dateTo) match.scoredAt.$lte = normalizeDateEnd(query.dateTo);
  }
  return match;
}

async function upsertAutoScore(payload) {
  return DesignSubmissionScore.findOneAndUpdate(
    { taskId: payload.taskId, submissionId: payload.submissionId },
    { $setOnInsert: payload },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
}

async function findBySubmissionIds(submissionIds = []) {
  if (!submissionIds.length) return [];
  return DesignSubmissionScore.find({ submissionId: { $in: submissionIds } }).lean();
}

async function overrideScore(scoreId, patch) {
  return DesignSubmissionScore.findByIdAndUpdate(scoreId, { $set: patch }, { new: true }).lean();
}

async function voidByTaskSubmission(taskId, submissionId, patch) {
  return DesignSubmissionScore.findOneAndUpdate(
    { taskId, submissionId, status: designScoreStatuses.ACTIVE },
    { $set: { ...patch, status: designScoreStatuses.VOIDED } },
    { new: true },
  ).lean();
}

async function summarize(query = {}) {
  const match = buildMatch(query);
  const [summary] = await DesignSubmissionScore.aggregate([
    { $match: match },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              totalPoints: { $sum: '$finalPoints' },
              totalFiles: { $sum: 1 },
            },
          },
        ],
        byDesigner: [
          {
            $group: {
              _id: '$designerId',
              designerId: { $first: '$designerId' },
              designerName: { $first: '$designerName' },
              teamId: { $first: '$teamId' },
              teamName: { $first: '$teamName' },
              departmentId: { $first: '$departmentId' },
              departmentName: { $first: '$departmentName' },
              totalPoints: { $sum: '$finalPoints' },
              totalFiles: { $sum: 1 },
            },
          },
          { $sort: { totalPoints: -1, designerName: 1 } },
        ],
        byTaskType: [
          {
            $group: {
              _id: '$taskType',
              taskType: { $first: '$taskType' },
              totalPoints: { $sum: '$finalPoints' },
              totalFiles: { $sum: 1 },
            },
          },
          { $sort: { taskType: 1 } },
        ],
      },
    },
  ]);

  const totals = summary?.totals?.[0] || { totalPoints: 0, totalFiles: 0 };
  return {
    totalPoints: totals.totalPoints || 0,
    totalFiles: totals.totalFiles || 0,
    byDesigner: summary?.byDesigner || [],
    byTaskType: summary?.byTaskType || [],
  };
}

module.exports = {
  findBySubmissionIds,
  overrideScore,
  summarize,
  upsertAutoScore,
  voidByTaskSubmission,
};
```

- [ ] **Step 6: Run repository test**

Run: `npm test -- src/test/design/repositories/designSubmissionScore.repository.test.js --runInBand`

Expected: PASS.

---

### Task 2: Add Scoring Service And Default Rules

**Files:**
- Create: `src/modules/design/services/designSubmissionScore.service.js`
- Create: `src/modules/design/dtos/designSubmissionScore.dto.js`
- Modify: `src/modules/organization/public.js`
- Test: `src/test/design/services/designSubmissionScore.service.test.js`

**Interfaces:**
- Consumes: repository from Task 1, `organization.public.listAccountOrganizationSummaries`, `auth.public.listProfilesByAccountIds`.
- Produces: `scoreApprovedSubmission(task, submission, authContext)`, `overrideSubmissionScore(scoreId, payload, authContext)`, `voidSubmissionScore(taskId, submissionId, payload, authContext)`, `summarizeScores(query, authContext)`.

- [ ] **Step 1: Write service tests**

```js
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

const mongoose = require('mongoose');
const authPublic = require('../../../modules/auth/public');
const organizationPublic = require('../../../modules/organization/public');
const repository = require('../../../modules/design/repositories/designSubmissionScore.repository');
const service = require('../../../modules/design/services/designSubmissionScore.service');

describe('designSubmissionScore.service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates default score from approved submission and snapshots org', async () => {
    const designerId = new mongoose.Types.ObjectId();
    const teamId = new mongoose.Types.ObjectId();
    const departmentId = new mongoose.Types.ObjectId();
    const task = {
      _id: new mongoose.Types.ObjectId(),
      taskType: 'PSD_TEMPLATE',
      priority: 'NORMAL',
    };
    const submission = {
      _id: new mongoose.Types.ObjectId(),
      version: 1,
      submittedBy: designerId,
      status: 'APPROVED',
    };

    authPublic.listProfilesByAccountIds.mockResolvedValue([{ accountId: designerId, fullName: 'Designer A' }]);
    organizationPublic.listAccountOrganizationSummaries.mockResolvedValue([{
      accountId: String(designerId),
      team: { id: String(teamId), name: 'Team A' },
      department: { id: String(departmentId), name: 'Design' },
    }]);
    repository.upsertAutoScore.mockImplementation(async (payload) => payload);

    const result = await service.scoreApprovedSubmission(task, submission, { accountId: new mongoose.Types.ObjectId() });

    expect(result.finalPoints).toBe(3);
    expect(result.designerName).toBe('Designer A');
    expect(result.teamName).toBe('Team A');
    expect(repository.upsertAutoScore).toHaveBeenCalledWith(expect.objectContaining({
      taskType: 'PSD_TEMPLATE',
      basePoints: 3,
      finalPoints: 3,
      scoreLevel: 'STANDARD',
    }));
  });

  it('requires override reason when changing points', async () => {
    await expect(service.overrideSubmissionScore(
      new mongoose.Types.ObjectId(),
      { points: 5 },
      { accountId: new mongoose.Types.ObjectId() },
    )).rejects.toThrow('overrideReason is required');
  });
});
```

- [ ] **Step 2: Run service test to verify it fails**

Run: `npm test -- src/test/design/services/designSubmissionScore.service.test.js --runInBand`

Expected: FAIL because service/DTO do not exist.

- [ ] **Step 3: Create DTO**

```js
function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toScoreDto(score) {
  if (!score) return null;
  return {
    id: toId(score._id || score.id),
    taskId: toId(score.taskId),
    submissionId: toId(score.submissionId),
    taskType: score.taskType,
    submissionVersion: score.submissionVersion,
    designer: {
      id: toId(score.designerId),
      name: score.designerName || null,
    },
    team: score.teamId ? {
      id: toId(score.teamId),
      name: score.teamName || null,
    } : null,
    department: score.departmentId ? {
      id: toId(score.departmentId),
      name: score.departmentName || null,
    } : null,
    basePoints: score.basePoints,
    finalPoints: score.finalPoints,
    scoreLevel: score.scoreLevel,
    status: score.status,
    override: score.override || null,
    scoredBy: toId(score.scoredBy),
    scoredAt: score.scoredAt || null,
    voidedBy: toId(score.voidedBy),
    voidedAt: score.voidedAt || null,
    voidReason: score.voidReason || null,
  };
}

function toScoreSummaryDto(summary = {}) {
  return {
    totalPoints: summary.totalPoints || 0,
    totalFiles: summary.totalFiles || 0,
    byDesigner: (summary.byDesigner || []).map((row) => ({
      designerId: toId(row.designerId),
      designerName: row.designerName || null,
      teamId: toId(row.teamId),
      teamName: row.teamName || null,
      departmentId: toId(row.departmentId),
      departmentName: row.departmentName || null,
      totalPoints: row.totalPoints || 0,
      totalFiles: row.totalFiles || 0,
    })),
    byTaskType: (summary.byTaskType || []).map((row) => ({
      taskType: row.taskType,
      totalPoints: row.totalPoints || 0,
      totalFiles: row.totalFiles || 0,
    })),
  };
}

module.exports = {
  toScoreDto,
  toScoreSummaryDto,
};
```

- [ ] **Step 4: Create scoring service**

```js
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const authPublic = require('../../auth/public');
const organizationPublic = require('../../organization/public');
const {
  designScoreLevels,
  designScoreStatuses,
  designTaskPriorities,
  designTaskTypes,
} = require('../constants/design.constants');
const repository = require('../repositories/designSubmissionScore.repository');
const { toScoreDto, toScoreSummaryDto } = require('../dtos/designSubmissionScore.dto');

const DEFAULT_POINTS_BY_TASK_TYPE = Object.freeze({
  [designTaskTypes.PSD_TEMPLATE]: 3,
  [designTaskTypes.PNG_ASSET]: 1,
  [designTaskTypes.MOCKUP]: 1,
  [designTaskTypes.IDEA]: 2,
  [designTaskTypes.CLONE]: 1,
});

const PRIORITY_MULTIPLIER = Object.freeze({
  [designTaskPriorities.LOW]: 1,
  [designTaskPriorities.NORMAL]: 1,
  [designTaskPriorities.HIGH]: 1.25,
  [designTaskPriorities.URGENT]: 1.5,
});

function validationError(message) {
  return new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
}

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function computeDefaultScore(task = {}) {
  const taskType = task.taskType || designTaskTypes.PSD_TEMPLATE;
  const base = DEFAULT_POINTS_BY_TASK_TYPE[taskType] || 1;
  const multiplier = PRIORITY_MULTIPLIER[task.priority] || 1;
  const finalPoints = Math.round(base * multiplier * 100) / 100;
  return {
    basePoints: base,
    finalPoints,
    scoreLevel: multiplier > 1 ? designScoreLevels.HARD : designScoreLevels.STANDARD,
    ruleSnapshot: {
      taskType,
      priority: task.priority || designTaskPriorities.NORMAL,
      basePoints: base,
      multiplier,
    },
  };
}

async function snapshotDesigner(designerId) {
  const [profiles, organizations] = await Promise.all([
    authPublic.listProfilesByAccountIds([designerId]),
    organizationPublic.listAccountOrganizationSummaries([designerId]),
  ]);
  const profile = profiles?.[0] || {};
  const organization = organizations?.[0] || {};
  return {
    designerName: profile.fullName || null,
    teamId: organization.team?.id || null,
    teamName: organization.team?.name || null,
    departmentId: organization.department?.id || null,
    departmentName: organization.department?.name || null,
  };
}

async function scoreApprovedSubmission(task, submission, authContext = {}) {
  const designerId = toId(submission?.submittedBy);
  const submissionId = toId(submission?._id || submission?.id);
  if (!designerId || !submissionId) return null;

  const score = computeDefaultScore(task);
  const designer = await snapshotDesigner(designerId);
  const saved = await repository.upsertAutoScore({
    taskId: toId(task._id || task.id),
    submissionId,
    taskType: task.taskType,
    submissionVersion: submission.version,
    designerId,
    ...designer,
    ...score,
    status: designScoreStatuses.ACTIVE,
    scoredBy: authContext.accountId || null,
    scoredAt: new Date(),
  });
  return toScoreDto(saved);
}

async function overrideSubmissionScore(scoreId, payload = {}, authContext = {}) {
  const points = Number(payload.points);
  const reason = String(payload.overrideReason || '').trim();
  if (!Number.isFinite(points) || points < 0) throw validationError('points must be a non-negative number');
  if (!reason) throw validationError('overrideReason is required');
  const saved = await repository.overrideScore(scoreId, {
    finalPoints: points,
    scoreLevel: payload.scoreLevel || designScoreLevels.BONUS,
    override: {
      points,
      reason,
      overriddenBy: authContext.accountId || null,
      overriddenAt: new Date(),
    },
  });
  return toScoreDto(saved);
}

async function voidSubmissionScore(taskId, submissionId, payload = {}, authContext = {}) {
  const reason = String(payload.voidReason || '').trim();
  if (!reason) throw validationError('voidReason is required');
  const saved = await repository.voidByTaskSubmission(taskId, submissionId, {
    voidedBy: authContext.accountId || null,
    voidedAt: new Date(),
    voidReason: reason,
  });
  return toScoreDto(saved);
}

async function summarizeScores(query = {}) {
  return toScoreSummaryDto(await repository.summarize(query));
}

module.exports = {
  computeDefaultScore,
  overrideSubmissionScore,
  scoreApprovedSubmission,
  summarizeScores,
  voidSubmissionScore,
};
```

- [ ] **Step 5: Run service test**

Run: `npm test -- src/test/design/services/designSubmissionScore.service.test.js --runInBand`

Expected: PASS.

---

### Task 3: Score Automatically On Approval And Expose Scores In Task Detail

**Files:**
- Modify: `src/modules/design/services/designTask.service.js`
- Modify: `src/modules/design/dtos/designTask.dto.js`
- Test: `src/test/design/services/designTask.service.test.js`

**Interfaces:**
- Consumes: `scoreApprovedSubmission(task, submission, authContext)` from Task 2.
- Produces: design task detail submission DTO includes `score`.

- [ ] **Step 1: Add failing approval scoring test**

In `src/test/design/services/designTask.service.test.js`, add or update a test around `approveTask`:

```js
jest.mock('../../../modules/design/services/designSubmissionScore.service', () => ({
  scoreApprovedSubmission: jest.fn(),
}));

const scoreService = require('../../../modules/design/services/designSubmissionScore.service');

it('creates score for approved submission', async () => {
  scoreService.scoreApprovedSubmission.mockResolvedValue({
    id: 'score-1',
    finalPoints: 3,
  });

  const result = await service.approveTask(taskId, {
    approvedAssetId: String(assetId),
    submissionId: String(submissionId),
  }, authContext);

  expect(scoreService.scoreApprovedSubmission).toHaveBeenCalledWith(
    expect.objectContaining({ _id: expect.anything() }),
    expect.objectContaining({ status: 'APPROVED' }),
    authContext,
  );
  expect(result.status).toBe('APPROVED');
});
```

- [ ] **Step 2: Run approval test to verify it fails**

Run: `npm test -- src/test/design/services/designTask.service.test.js --runInBand`

Expected: FAIL because `approveTask` does not call scoring service.

- [ ] **Step 3: Modify approval flow**

In `src/modules/design/services/designTask.service.js`:

```js
const scoreService = require('./designSubmissionScore.service');
```

Inside `approveTask`, after `updated` is saved and before returning DTO:

```js
const approvedSubmission = updateSubmission(submissions, submission, {
  status: designTaskSubmissionStatuses.APPROVED,
  approvedAssetId,
  approvedBy: authContext?.accountId || null,
  approvedAt,
}).find((item) => String(item._id || item.id) === String(submission._id || submission.id)
  || Number(item.version) === Number(submission.version));

const score = await scoreService.scoreApprovedSubmission(updated, approvedSubmission, authContext);
const dto = toDesignTaskDto(updated, { detail: true, ...(await buildDtoOptions([updated])) });
if (score && dto.approvedSubmission) dto.approvedSubmission.score = score;
```

Keep the existing production recheck behavior unchanged.

- [ ] **Step 4: Add scores to submission DTOs**

In `src/modules/design/dtos/designTask.dto.js`, update detail DTO options to accept `scoresBySubmissionId = {}` and include:

```js
score: scoresBySubmissionId[toId(submission._id || submission.id)] || null,
```

In `buildDtoOptions`, load scores for task submissions through the score repository or score service. Use the repository directly inside design module:

```js
const scoreRepository = require('../repositories/designSubmissionScore.repository');
```

Collect submission IDs and map scores by `submissionId`.

- [ ] **Step 5: Run design service tests**

Run: `npm test -- src/test/design/services/designTask.service.test.js --runInBand`

Expected: PASS.

---

### Task 4: Add Score Override, Void, And Summary Endpoints

**Files:**
- Modify: `src/modules/design/validators/designTask.validator.js`
- Modify: `src/modules/design/controllers/designTask.controller.js`
- Modify: `src/modules/design/routes/index.js`
- Test: `src/test/design/routes/index.test.js`

**Interfaces:**
- Consumes: score service from Task 2.
- Produces:
  - `PATCH /api/design/submission-scores/:scoreId/override`
  - `PATCH /api/design/tasks/:taskId/submissions/:submissionId/score/void`
  - `GET /api/design/score-summary`

- [ ] **Step 1: Add route tests**

```js
it('mounts score routes before dynamic task routes', () => {
  const stack = router.stack
    .filter((layer) => layer.route)
    .map((layer) => Object.keys(layer.route.methods)[0].toUpperCase() + ' ' + layer.route.path);

  expect(stack).toContain('GET /score-summary');
  expect(stack).toContain('PATCH /submission-scores/:scoreId/override');
  expect(stack.indexOf('GET /score-summary')).toBeLessThan(stack.indexOf('GET /tasks/:taskId'));
});
```

- [ ] **Step 2: Run route test to verify it fails**

Run: `npm test -- src/test/design/routes/index.test.js --runInBand`

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Add validators**

In `src/modules/design/validators/designTask.validator.js`:

```js
const scoreOverrideSchema = Joi.object({
  points: Joi.number().min(0).required(),
  scoreLevel: Joi.string().valid('BASIC', 'STANDARD', 'HARD', 'BONUS').optional(),
  overrideReason: Joi.string().trim().min(2).max(500).required(),
});

const scoreVoidSchema = Joi.object({
  voidReason: Joi.string().trim().min(2).max(500).required(),
});

const scoreSummaryQuerySchema = Joi.object({
  designerId: objectId.optional(),
  teamId: objectId.optional(),
  departmentId: objectId.optional(),
  taskType: Joi.string().valid('PSD_TEMPLATE', 'MOCKUP', 'PNG_ASSET', 'IDEA', 'CLONE').optional(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().optional(),
});
```

Export all three.

- [ ] **Step 4: Add controller handlers**

In `src/modules/design/controllers/designTask.controller.js`:

```js
const scoreService = require('../services/designSubmissionScore.service');
```

Add:

```js
async function overrideSubmissionScore(req, res) {
  const payload = validateBody(scoreOverrideSchema, req.body);
  const data = await scoreService.overrideSubmissionScore(req.params.scoreId, payload, req.auth);
  res.status(200).json({ success: true, data });
}

async function voidSubmissionScore(req, res) {
  const payload = validateBody(scoreVoidSchema, req.body);
  const data = await scoreService.voidSubmissionScore(
    req.params.taskId,
    req.params.submissionId,
    payload,
    req.auth,
  );
  res.status(200).json({ success: true, data });
}

async function summarizeScores(req, res) {
  const query = validateQuery(scoreSummaryQuerySchema, req.query);
  const data = await scoreService.summarizeScores(query, req.auth);
  res.status(200).json({ success: true, data });
}
```

Export the three handlers.

- [ ] **Step 5: Add routes**

In `src/modules/design/routes/index.js`, before `/tasks/:taskId`:

```js
router.get(
  '/score-summary',
  authPublic.authenticate,
  requireRead,
  asyncHandler(controller.summarizeScores),
);

router.patch(
  '/submission-scores/:scoreId/override',
  authPublic.authenticate,
  requireReview,
  asyncHandler(controller.overrideSubmissionScore),
);

router.patch(
  '/tasks/:taskId/submissions/:submissionId/score/void',
  authPublic.authenticate,
  requireReview,
  asyncHandler(controller.voidSubmissionScore),
);
```

- [ ] **Step 6: Run route tests**

Run: `npm test -- src/test/design/routes/index.test.js --runInBand`

Expected: PASS.

---

### Task 5: FE Design Points UI

**Files:**
- Modify in `C:\Users\stack\Task\lng-web-fe`:
  - `src/services/endpoints.js`
  - `src/features/design-tasks/utils/designTasksApi.js`
  - `src/features/design-tasks/api/designTasks.queries.js`
  - `src/features/design-tasks/api/designTasks.mutations.js`
  - `src/features/design-tasks/pages/DesignTasksPage.jsx`
- Create if missing:
  - `src/features/design-tasks/components/DesignScoreSummary.jsx`
  - `src/features/design-tasks/components/SubmissionScoreEditor.jsx`

**Interfaces:**
- Consumes BE endpoints from Task 4.
- Produces UI for default score display, override, void, and score summary.

- [ ] **Step 1: Add endpoint constants**

```js
DESIGN_SCORE_SUMMARY: '/api/design/score-summary',
DESIGN_SCORE_OVERRIDE: (scoreId) => `/api/design/submission-scores/${scoreId}/override`,
DESIGN_SCORE_VOID: (taskId, submissionId) => `/api/design/tasks/${taskId}/submissions/${submissionId}/score/void`,
```

- [ ] **Step 2: Add API helpers**

```js
export async function fetchDesignScoreSummary(params) {
  const response = await apiClient.get(ENDPOINTS.DESIGN_SCORE_SUMMARY, { params });
  return response.data?.data || response.data;
}

export async function overrideDesignSubmissionScore(scoreId, payload) {
  const body = {
    points: Number(payload.points),
    ...(payload.scoreLevel ? { scoreLevel: payload.scoreLevel } : {}),
    overrideReason: payload.overrideReason,
  };
  const response = await apiClient.patch(ENDPOINTS.DESIGN_SCORE_OVERRIDE(scoreId), body);
  return response.data?.data || response.data;
}

export async function voidDesignSubmissionScore(taskId, submissionId, payload) {
  const response = await apiClient.patch(ENDPOINTS.DESIGN_SCORE_VOID(taskId, submissionId), {
    voidReason: payload.voidReason,
  });
  return response.data?.data || response.data;
}
```

- [ ] **Step 3: Add React Query hooks**

```js
export function useDesignScoreSummaryQuery(params) {
  return useQuery({
    queryKey: ['design-score-summary', params],
    queryFn: () => fetchDesignScoreSummary(params),
  });
}
```

Mutations invalidate:

```js
['design-tasks']
['design-score-summary']
```

- [ ] **Step 4: Add score display in task detail**

In submission history, show:

```jsx
<span>{submission.score ? `${submission.score.finalPoints} pts` : 'No score'}</span>
```

Only users with review permission see override/void controls.

- [ ] **Step 5: Add summary section**

Add a compact `DesignScoreSummary` above or beside the design task table:

```jsx
<DesignScoreSummary filters={{ dateFrom, dateTo, designerId, teamId, taskType }} />
```

Display:
- total points
- total files
- top designers
- points by task type

- [ ] **Step 6: Run FE checks**

Run in `C:\Users\stack\Task\lng-web-fe`:

```bash
node --test src/features/design-tasks/utils/designTasksApi.test.js
npm run build
```

Expected: PASS or only known unrelated dirty-worktree failures documented.

---

### Task 6: Verification

**Files:**
- No new files.

**Interfaces:**
- Verifies all previous tasks.

- [ ] **Step 1: Syntax check changed BE files**

Run:

```bash
node -c src/modules/design/models/designSubmissionScore.model.js
node -c src/modules/design/repositories/designSubmissionScore.repository.js
node -c src/modules/design/services/designSubmissionScore.service.js
node -c src/modules/design/dtos/designSubmissionScore.dto.js
node -c src/modules/design/services/designTask.service.js
node -c src/modules/design/dtos/designTask.dto.js
node -c src/modules/design/controllers/designTask.controller.js
node -c src/modules/design/validators/designTask.validator.js
node -c src/modules/design/routes/index.js
```

Expected: no syntax errors.

- [ ] **Step 2: Run focused BE tests**

Run:

```bash
npm test -- src/test/design/repositories/designSubmissionScore.repository.test.js --runInBand
npm test -- src/test/design/services/designSubmissionScore.service.test.js --runInBand
npm test -- src/test/design/services/designTask.service.test.js --runInBand
npm test -- src/test/design/routes/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run architecture tests**

Run:

```bash
npm run test:architecture -- --runInBand
```

Expected: PASS.

- [ ] **Step 4: Manual smoke**

1. Login as designer with `DESIGN:WORK`.
2. Submit a design task asset.
3. Login as leader/reviewer with `DESIGN:REVIEW`.
4. Approve the submitted asset.
5. Confirm response includes `approvedSubmission.score.finalPoints`.
6. Open score summary and confirm total points increments.
7. Override score with reason and confirm report uses override points.
8. Void score with reason and confirm report total removes that file.

---

## Self-Review

- Spec coverage: plan covers auto score, leader exception override, score snapshot, bulk-safe approval, report by designer/team/period, and void handling.
- Placeholder scan: no `TBD`, `TODO`, or unresolved placeholder steps.
- Type consistency: `scoreId`, `taskId`, `submissionId`, `finalPoints`, `scoreLevel`, and `overrideReason` names are consistent across BE and FE tasks.
- Scope choice: KPI period locking is intentionally excluded from V1. Add it when finance/admin actually closes monthly KPI periods.

Plan complete and saved to `docs/superpowers/plans/2026-07-18-design-submission-scoring.md`. Two execution options:

**1. Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
