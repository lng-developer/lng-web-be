jest.mock('../../../modules/customization/services/customizationPayload.service', () => ({
  listPayloads: jest.fn(),
  getByOrderItem: jest.fn(),
  createPendingPayload: jest.fn(),
  markFailed: jest.fn(),
}));

jest.mock('../../../modules/customization/services/customizationZipInspect.service', () => ({
  inspectDownloadedZipForOrderItem: jest.fn(),
  extractZipImagesForOrderItem: jest.fn(),
}));

const service = require('../../../modules/customization/services/customizationPayload.service');
const zipInspectService = require('../../../modules/customization/services/customizationZipInspect.service');
const controller = require('../../../modules/customization/controllers/customizationPayload.controller');

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('customizationPayload.controller', () => {
  const auth = { accountId: 'account-id', permissions: ['ORDERS:WRITE'], scopes: [] };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('passes auth context to list service', async () => {
    service.listPayloads.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    const res = mockResponse();

    await controller.listPayloads({ query: { page: '1', limit: '20' }, auth }, res);

    expect(service.listPayloads).toHaveBeenCalledWith({ page: 1, limit: 20 }, auth);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('passes auth context to create service', async () => {
    service.createPendingPayload.mockResolvedValue({
      created: true,
      payload: {
        _id: '660000000000000000000601',
        orderItemId: '660000000000000000000401',
        orderId: '660000000000000000000301',
        shopId: '660000000000000000000201',
        source: 'AMAZON_EXTENSION_REPORT',
        status: 'PENDING',
      },
    });
    const body = {
      orderItemId: '660000000000000000000401',
      orderId: '660000000000000000000301',
      shopId: '660000000000000000000201',
      source: 'AMAZON_EXTENSION_REPORT',
      rawCustomization: { name: 'Jane' },
    };
    const res = mockResponse();

    await controller.createPendingPayload({ body, auth }, res);

    expect(service.createPendingPayload).toHaveBeenCalledWith({
      ...body,
      createdBy: auth.accountId,
    }, auth);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('get by order item returns extracted images from DTO', async () => {
    service.getByOrderItem.mockResolvedValue({
      _id: '660000000000000000000601',
      orderItemId: '660000000000000000000401',
      orderId: '660000000000000000000301',
      shopId: '660000000000000000000201',
      source: 'MANUAL_EXCEL',
      status: 'PARSED',
      assets: [
        {
          type: 'CUSTOMIZED_URL',
          status: 'DOWNLOADED',
          assetId: '660000000000000000000901',
          sourceUrl: 'https://zme-caps.amazon.com/t/token/file.zip?secret=do-not-leak',
          metadata: {
            zipImageExtractionStatus: 'EXTRACTED',
            extractedImages: [
              {
                assetId: '660000000000000000000902',
                secureUrl: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
                mimeType: 'image/jpeg',
                size: 69071,
                sha256: 'b'.repeat(64),
                originalPath: 'front.jpg',
                normalizedPath: 'front.jpg',
                filename: 'front.jpg',
              },
            ],
          },
        },
      ],
    });
    const res = mockResponse();

    await controller.getByOrderItem({
      params: { orderItemId: '660000000000000000000401' },
      auth,
    }, res);

    expect(service.getByOrderItem).toHaveBeenCalledWith('660000000000000000000401', auth);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.extractedImages).toEqual([
      expect.objectContaining({
        assetId: '660000000000000000000902',
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
      }),
    ]);
    expect(res.json.mock.calls[0][0].data.downloadedZip.sourceUrlRedacted).not.toContain('secret=do-not-leak');
  });

  test('passes auth context to mutation service', async () => {
    service.markFailed.mockResolvedValue({
      _id: '660000000000000000000601',
      status: 'FAILED',
    });
    const res = mockResponse();

    await controller.markFailed({
      params: { payloadId: '660000000000000000000601' },
      body: { errorCode: 'INVALID_RAW_CUSTOMIZATION' },
      auth,
    }, res);

    expect(service.markFailed).toHaveBeenCalledWith(
      '660000000000000000000601',
      { errorCode: 'INVALID_RAW_CUSTOMIZATION' },
      auth,
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('inspect zip endpoint passes auth and does not expose local path', async () => {
    zipInspectService.inspectDownloadedZipForOrderItem.mockResolvedValue({
      payloadId: '660000000000000000000601',
      inspectedAssetId: '660000000000000000000901',
      zipInspectionStatus: 'INSPECTED',
      fileCount: 1,
      totalUncompressedBytes: 20,
      entries: [],
      warnings: [],
      errors: [],
      localPath: 'C:\\storage\\media\\asset.zip',
      payload: {
        _id: '660000000000000000000601',
        orderItemId: '660000000000000000000401',
        orderId: '660000000000000000000301',
        shopId: '660000000000000000000201',
        source: 'MANUAL_EXCEL',
        status: 'PARSED',
      },
    });
    const res = mockResponse();

    await controller.inspectZipForOrderItem({
      params: { orderItemId: '660000000000000000000401' },
      body: { maxEntries: 10 },
      auth,
    }, res);

    expect(zipInspectService.inspectDownloadedZipForOrderItem).toHaveBeenCalledWith(
      '660000000000000000000401',
      {
        maxEntries: 10,
        maxTotalUncompressedBytes: 52428800,
        maxSingleEntryUncompressedBytes: 20971520,
      },
      auth,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).not.toHaveProperty('localPath');
  });

  test('extract zip images endpoint passes auth and does not expose local path', async () => {
    zipInspectService.extractZipImagesForOrderItem.mockResolvedValue({
      payloadId: '660000000000000000000601',
      sourceAssetId: null,
      extractedCount: 2,
      skippedCount: 3,
      failedCount: 0,
      extractedImages: [
        { normalizedPath: 'front.png', assetId: '660000000000000000000901' },
      ],
      localPath: 'C:\\temp\\source.zip',
      payload: {
        _id: '660000000000000000000601',
        orderItemId: '660000000000000000000401',
        orderId: '660000000000000000000301',
        shopId: '660000000000000000000201',
        source: 'MANUAL_EXCEL',
        status: 'PARSED',
      },
    });
    const res = mockResponse();

    await controller.extractZipImagesForOrderItem({
      params: { orderItemId: '660000000000000000000401' },
      body: {},
      auth,
    }, res);

    expect(zipInspectService.extractZipImagesForOrderItem).toHaveBeenCalledWith(
      '660000000000000000000401',
      {
        maxEntries: 50,
        maxTotalUncompressedBytes: 52428800,
        maxSingleEntryUncompressedBytes: 20971520,
      },
      auth,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).not.toHaveProperty('localPath');
  });
});
