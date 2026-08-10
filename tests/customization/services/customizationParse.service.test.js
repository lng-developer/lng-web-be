jest.mock('../../../src/modules/customization/repositories/customizationPayload.repository', () => ({
  findByOrderItem: jest.fn(),
  updateParsedData: jest.fn(),
}));

const fs = require('fs');
const path = require('path');
const repository = require('../../../src/modules/customization/repositories/customizationPayload.repository');
const service = require('../../../src/modules/customization/services/customizationParse.service');
const { customizationStatuses } = require('../../../src/modules/customization/constants/customizationStatuses');
const { customizationErrorCodes } = require('../../../src/modules/customization/constants/customizationErrorCodes');
const { customizationAssetTypes } = require('../../../src/modules/customization/constants/customizationAssetTypes');

describe('customizationParse.service', () => {
  const payloadId = '660000000000000000000601';
  const orderItemId = '660000000000000000000401';
  const shopId = '660000000000000000000201';

  beforeEach(() => {
    jest.clearAllMocks();
    repository.updateParsedData.mockImplementation(async (id, parsedData, patch) => ({
      _id: id,
      orderItemId,
      shopId,
      parsedData,
      ...patch,
    }));
  });

  test('parseForOrderItem marks valid raw customization parsed and saves assets', async () => {
    repository.findByOrderItem.mockResolvedValue({
      _id: payloadId,
      orderItemId,
      shopId,
      rawCustomization: {
        hasCustomization: true,
        customizedUrl: 'https://example.test/custom.zip',
        customizedPage: 'https://a.co/example',
        itemExtensionsData: '{"name":"Jane"}',
      },
      status: customizationStatuses.PENDING,
      errorCode: customizationErrorCodes.MANUAL_REVIEW_REQUIRED,
      errorMessage: 'old error',
      assets: [{ type: 'OLD', sourceUrl: 'https://old.test', status: customizationStatuses.FAILED }],
    });

    const result = await service.parseForOrderItem(orderItemId);

    expect(repository.updateParsedData).toHaveBeenCalledWith(payloadId, {
      amazonCustomization: {
        hasCustomization: true,
        customizedUrl: 'https://example.test/custom.zip',
        customizedPage: 'https://a.co/example',
        itemExtensionsData: '{"name":"Jane"}',
      },
    }, expect.objectContaining({
      status: customizationStatuses.PARSED,
      errorCode: null,
      errorMessage: null,
      assets: [
        {
          type: customizationAssetTypes.CUSTOMIZED_URL,
          sourceUrl: 'https://example.test/custom.zip',
          status: customizationStatuses.PENDING,
          metadata: {},
        },
        {
          type: customizationAssetTypes.CUSTOMIZED_PAGE,
          sourceUrl: 'https://a.co/example',
          status: customizationStatuses.PENDING,
          metadata: {},
        },
      ],
      lastTriedAt: expect.any(Date),
    }));
    expect(result.status).toBe(customizationStatuses.PARSED);
    expect(result.errorCode).toBeNull();
    expect(result.errorMessage).toBeNull();
  });

  test('parseForOrderItem routes Etsy variation payloads to Etsy parser', async () => {
    repository.findByOrderItem.mockResolvedValue({
      _id: payloadId,
      orderItemId,
      shopId,
      rawCustomization: {
        hasCustomization: true,
        variations: 'Quantity:Pack 30pcs,Sizes:4.8x4.8 INCHES,Custom Name:Erica',
      },
      status: customizationStatuses.PENDING,
    });

    const result = await service.parseForOrderItem(orderItemId);

    expect(repository.updateParsedData).toHaveBeenCalledWith(payloadId, {
      amazonCustomization: expect.objectContaining({
        hasCustomization: true,
        customerInputs: {
          texts: [{ label: 'Custom Name', name: 'Custom Name', value: 'Erica' }],
          options: [
            { label: 'Quantity', name: 'Quantity', value: 'Pack 30pcs' },
            { label: 'Sizes', name: 'Sizes', value: '4.8x4.8 INCHES' },
          ],
          images: [],
        },
      }),
    }, expect.objectContaining({
      status: customizationStatuses.PARSED,
      errorCode: null,
      errorMessage: null,
      assets: [],
      lastTriedAt: expect.any(Date),
    }));
    expect(result.status).toBe(customizationStatuses.PARSED);
  });

  test('parseForOrderItem preserves commas inside Etsy personalization values', async () => {
    repository.findByOrderItem.mockResolvedValue({
      _id: payloadId,
      orderItemId,
      shopId,
      rawCustomization: {
        hasCustomization: true,
        variations: 'Select Size:6.5 x 6.5,Select Pack:50 pcs,Personalization:Gigi&#39;s\nAva, Blake',
      },
      status: customizationStatuses.PENDING,
    });

    await service.parseForOrderItem(orderItemId);

    expect(repository.updateParsedData).toHaveBeenCalledWith(payloadId, {
      amazonCustomization: expect.objectContaining({
        customerInputs: expect.objectContaining({
          texts: [
            {
              label: 'Personalization',
              name: 'Personalization',
              value: "Gigi's\nAva, Blake",
            },
          ],
          options: [
            { label: 'Select Size', name: 'Select Size', value: '6.5 x 6.5' },
            { label: 'Select Pack', name: 'Select Pack', value: '50 pcs' },
          ],
        }),
      }),
    }, expect.any(Object));
  });

  test.each([
    ['invalid URL', { hasCustomization: true, customizedUrl: 'javascript:alert(1)' }, customizationErrorCodes.INVALID_RAW_CUSTOMIZATION],
    ['missing customization evidence', { hasCustomization: false }, customizationErrorCodes.MANUAL_REVIEW_REQUIRED],
  ])('parseForOrderItem marks needs review for %s', async (name, rawCustomization, expectedCode) => {
    repository.findByOrderItem.mockResolvedValue({
      _id: payloadId,
      orderItemId,
      shopId,
      rawCustomization,
      status: customizationStatuses.PENDING,
    });

    const result = await service.parseForOrderItem(orderItemId);

    expect(repository.updateParsedData).toHaveBeenCalledWith(payloadId, expect.objectContaining({
      amazonCustomization: expect.any(Object),
    }), expect.objectContaining({
      status: customizationStatuses.NEEDS_REVIEW,
      assets: [],
      errorCode: expectedCode,
      errorMessage: expect.any(String),
      lastTriedAt: expect.any(Date),
    }));
    expect(result.status).toBe(customizationStatuses.NEEDS_REVIEW);
  });

  test('parseForOrderItem is idempotent and rebuilds assets deterministically', async () => {
    const payload = {
      _id: payloadId,
      orderItemId,
      shopId,
      rawCustomization: {
        hasCustomization: true,
        customizedUrl: 'https://example.test/custom.zip',
      },
      status: customizationStatuses.PARSED,
      assets: [
        { type: customizationAssetTypes.CUSTOMIZED_URL, sourceUrl: 'https://example.test/custom.zip', status: customizationStatuses.PENDING },
      ],
    };
    repository.findByOrderItem.mockResolvedValue(payload);

    await service.parseForOrderItem(orderItemId);
    await service.parseForOrderItem(orderItemId);

    const firstPatch = repository.updateParsedData.mock.calls[0][2];
    const secondPatch = repository.updateParsedData.mock.calls[1][2];
    expect(secondPatch.assets).toEqual(firstPatch.assets);
    expect(secondPatch.assets).toHaveLength(1);
  });

  test('parseForOrderItem parses the latest payload returned by repository', async () => {
    const latestPayloadId = '660000000000000000000602';
    repository.findByOrderItem.mockResolvedValue({
      _id: latestPayloadId,
      orderItemId,
      shopId,
      rawCustomization: {
        hasCustomization: true,
        customizedUrl: 'https://example.test/latest.zip',
      },
      status: customizationStatuses.PENDING,
    });

    await service.parseForOrderItem(orderItemId);

    expect(repository.findByOrderItem).toHaveBeenCalledWith(orderItemId);
    expect(repository.updateParsedData).toHaveBeenCalledWith(latestPayloadId, expect.any(Object), expect.any(Object));
  });

  test('parse service has no top-level order public import or timeline append', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/modules/customization/services/customizationParse.service.js'), 'utf8');

    expect(source).not.toContain("require('../../order/public')");
    expect(source).not.toMatch(/appendTimeline/);
  });
});
