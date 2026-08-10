const {
  auditCollectionFields,
  auditMongoFields,
  buildTopLevelFieldPipeline,
  normalizeFieldMetrics,
} = require('../../../../tools/scripts/audit/mongoFieldAudit');

describe('mongoFieldAudit field metrics', () => {
  test('builds one read-only aggregation for top-level BSON field sizes', () => {
    const pipeline = buildTopLevelFieldPipeline();

    expect(pipeline).toEqual([
      { $project: { fields: { $objectToArray: '$$ROOT' } } },
      { $unwind: '$fields' },
      expect.objectContaining({
        $group: expect.objectContaining({
          _id: '$fields.k',
          presenceCount: { $sum: 1 },
          estimatedBytes: expect.any(Object),
          types: { $addToSet: { $type: '$fields.v' } },
        }),
      }),
      { $sort: { estimatedBytes: -1, _id: 1 } },
    ]);
    expect(JSON.stringify(pipeline)).not.toMatch(/\$(out|merge|set|unset)/i);
    expect(pipeline[2].$group.estimatedBytes).toEqual({
      $sum: { $bsonSize: { value: '$fields.v' } },
    });
  });

  test('normalizes field bytes and handles an empty collection', () => {
    const rows = [{
      _id: 'payload', presenceCount: 10, estimatedBytes: 500, types: ['object'],
    }];

    expect(normalizeFieldMetrics(rows, 2000)[0]).toEqual({
      field: 'payload',
      presenceCount: 10,
      estimatedBytes: 500,
      percentOfCollectionData: 25,
      types: ['object'],
    });
    expect(normalizeFieldMetrics(rows, 0)[0].percentOfCollectionData).toBe(0);
  });
});

describe('mongoFieldAudit collection inventory', () => {
  test('collects collection stats, field metrics, and index definitions read-only', async () => {
    const aggregate = jest.fn().mockResolvedValue([
      { _id: 'status', presenceCount: 72, estimatedBytes: 1200, types: ['string'] },
    ]);
    const listIndexes = jest.fn().mockResolvedValue([{ name: 'status_1', key: { status: 1 } }]);
    const collection = {
      aggregate: jest.fn(() => ({ toArray: aggregate })),
      listIndexes: jest.fn(() => ({ toArray: listIndexes })),
    };
    const db = {
      command: jest.fn().mockResolvedValue({ count: 72, size: 285048, avgObjSize: 3959 }),
      collection: jest.fn(() => collection),
    };

    const result = await auditCollectionFields(db, 'productiontasks');

    expect(result).toMatchObject({
      name: 'productiontasks',
      documentCount: 72,
      dataBytes: 285048,
      averageDocumentBytes: 3959,
      fields: [expect.objectContaining({ field: 'status' })],
      indexes: [{ name: 'status_1', key: { status: 1 } }],
    });
    expect(db.command).toHaveBeenCalledWith({ collStats: 'productiontasks' });
    expect(collection.aggregate).toHaveBeenCalledWith(buildTopLevelFieldPipeline(), { allowDiskUse: true });
    expect(collection).not.toHaveProperty('updateMany');
    expect(collection).not.toHaveProperty('drop');
  });

  test('audits collections in the requested order', async () => {
    const db = {
      command: jest.fn(async ({ collStats }) => ({ count: 0, size: 0, avgObjSize: 0, ns: `lng_web_be.${collStats}` })),
      collection: jest.fn(() => ({
        aggregate: () => ({ toArray: async () => [] }),
        listIndexes: () => ({ toArray: async () => [] }),
      })),
    };

    const report = await auditMongoFields(db, ['one', 'two']);

    expect(report.collections.map(({ name }) => name)).toEqual(['one', 'two']);
  });
});

describe('auditMongoFields CLI', () => {
  test('delegates exactly five collections and disconnects', async () => {
    const { main } = require('../../../../tools/scripts/audit/auditMongoFields');
    const db = { databaseName: 'lng_web_be' };
    const audit = jest.fn().mockResolvedValue({ database: 'lng_web_be', collections: [] });
    const output = { write: jest.fn() };
    const disconnectDatabase = jest.fn();

    await main({
      connectDatabase: jest.fn().mockResolvedValue(db),
      disconnectDatabase,
      audit,
      output,
    });

    expect(audit).toHaveBeenCalledWith(db, [
      'vendorcostcenters',
      'hrattendancedailies',
      'externalorderrawrecords',
      'productiontasks',
      'vendorsubmissions',
    ]);
    expect(JSON.parse(output.write.mock.calls[0][0])).toMatchObject({ database: 'lng_web_be' });
    expect(disconnectDatabase).toHaveBeenCalledTimes(1);
  });
});
