const {
  FIXTURE_SIZES,
  createFixtureBuffer,
  summarizeSamples,
  classifyBottleneck,
  runUploadBenchmark,
} = require('../../../../tools/scripts/benchmarks/uploadBenchmark');
const { validatePreflight } = require('../../../../tools/scripts/benchmarks/benchmarkUploads');

describe('upload benchmark helpers', () => {
  test('creates exact deterministic non-secret fixtures', () => {
    expect(FIXTURE_SIZES).toEqual([
      { label: '1MiB', bytes: 1024 * 1024 },
      { label: '5MiB', bytes: 5 * 1024 * 1024 },
      { label: '9MiB', bytes: 9 * 1024 * 1024 },
    ]);
    expect(createFixtureBuffer(64, 'a')).toEqual(createFixtureBuffer(64, 'a'));
    expect(createFixtureBuffer(64, 'a')).not.toEqual(createFixtureBuffer(64, 'b'));
  });

  test('summarizes latency with nearest-rank p95 and median throughput', () => {
    expect(summarizeSamples([100, 200, 300], 1024 * 1024)).toEqual({
      count: 3,
      medianMs: 200,
      p95Ms: 300,
      throughputMiBPerSecond: 5,
      variationPercent: 100,
    });
  });

  test.each([
    [{ medianMs: 1000, variationPercent: 10 }, { medianMs: 1600, variationPercent: 10 }, 'post-actions'],
    [{ medianMs: 1000, variationPercent: 10 }, { medianMs: 1250, variationPercent: 10 }, 'post-actions'],
    [{ medianMs: 1000, variationPercent: 10 }, { medianMs: 1100, variationPercent: 10 }, 'storage-network'],
    [{ medianMs: 1000, variationPercent: 21 }, { medianMs: 1100, variationPercent: 10 }, 'increase-samples'],
  ])('classifies the measured bottleneck', (media, listing, decision) => {
    expect(classifyBottleneck(media, listing).decision).toBe(decision);
  });

  test('warms once, alternates measured uploads, restores, then cleans in reverse order', async () => {
    const calls = [];
    let assetNumber = 0;
    const upload = (endpoint) => async ({ measured }) => {
      calls.push(`${endpoint}:${measured ? 'measure' : 'warm'}`);
      assetNumber += 1;
      return { durationMs: endpoint === 'media' ? 100 : 150, asset: { id: `asset-${assetNumber}` } };
    };

    const report = await runUploadBenchmark({
      sizes: [{ label: 'tiny', bytes: 32 }],
      sampleCount: 2,
      uploadMedia: upload('media'),
      uploadListing: upload('listing'),
      restoreListing: async () => calls.push('restore'),
      cleanup: async ({ id }) => calls.push(`cleanup:${id}`),
    });

    expect(report.results[0]).toMatchObject({ label: 'tiny', decision: { decision: 'post-actions' } });
    expect(calls).toEqual([
      'media:warm', 'listing:warm',
      'media:measure', 'listing:measure',
      'media:measure', 'listing:measure',
      'restore',
      'cleanup:asset-6', 'cleanup:asset-5', 'cleanup:asset-4',
      'cleanup:asset-3', 'cleanup:asset-2', 'cleanup:asset-1',
    ]);
  });

  test('restores and exposes uncleaned asset ids when cleanup fails', async () => {
    const calls = [];
    let assetNumber = 0;
    const upload = async () => ({ durationMs: 10, asset: { id: `asset-${++assetNumber}` } });

    await expect(runUploadBenchmark({
      sizes: [{ label: 'tiny', bytes: 32 }],
      sampleCount: 1,
      uploadMedia: upload,
      uploadListing: upload,
      restoreListing: async () => calls.push('restore'),
      cleanup: async ({ id }) => {
        calls.push(`cleanup:${id}`);
        if (id === 'asset-3') throw new Error('cleanup unavailable');
      },
    })).rejects.toMatchObject({
      code: 'UPLOAD_BENCHMARK_CLEANUP_FAILED',
      orphanAssetIds: ['asset-3', 'asset-2', 'asset-1'],
    });

    expect(calls).toEqual(['restore', 'cleanup:asset-4', 'cleanup:asset-3']);
  });

  test('preflight requires credentials, Atlas database name, and Cloudinary', () => {
    expect(() => validatePreflight({ identifier: '', password: '', databaseName: 'other', provider: 'local' }))
      .toThrow('UPLOAD_BENCHMARK_IDENTIFIER');
    expect(() => validatePreflight({ identifier: 'bench', password: 'secret', databaseName: 'other', provider: 'cloudinary' }))
      .toThrow('lng_web_be');
    expect(() => validatePreflight({ identifier: 'bench', password: 'secret', databaseName: 'lng_web_be', provider: 'local' }))
      .toThrow('cloudinary');
    expect(validatePreflight({ identifier: 'bench', password: 'secret', databaseName: 'lng_web_be', provider: 'cloudinary' }))
      .toBe(true);
  });
});
