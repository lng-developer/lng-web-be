const { buildAssetIdBackfill } = require('../../../modules/design/scripts/migrateSubmissionScoreAssetIds');

describe('migrateSubmissionScoreAssetIds', () => {
  test('backfills the approved asset from the matching submission', () => {
    expect(buildAssetIdBackfill(
      { _id: 'score-1', submissionId: 'submission-1' },
      { submissions: [{ _id: 'submission-1', approvedAssetId: 'asset-1' }] },
    )).toEqual({ assetId: 'asset-1' });
  });

  test('reports a score without a matching approved asset as unresolved', () => {
    expect(buildAssetIdBackfill({ _id: 'score-1', submissionId: 'submission-1' }, { submissions: [] }))
      .toEqual({ unresolved: 'score-1' });
  });
});
