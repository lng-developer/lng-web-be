jest.mock('../../../modules/customization/repositories/customizationPayload.repository', () => ({
  findById: jest.fn(),
  findByOrderItem: jest.fn(),
  updateAssets: jest.fn(),
  updateParsedData: jest.fn(),
}));

jest.mock('../../../modules/media/public', () => ({
  withAssetLocalReadFile: jest.fn(),
  storeAsset: jest.fn(),
}));

jest.mock('../../../shared/network/safeRemoteFetchStream', () => ({
  safeRemoteFetchStream: jest.fn(),
  redactUrl: jest.fn(() => 'https://example.test/[REDACTED_PATH]'),
}));

jest.mock('yauzl', () => ({
  open: jest.fn(),
}));

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const repository = require('../../../modules/customization/repositories/customizationPayload.repository');
const mediaPublic = require('../../../modules/media/public');
const { safeRemoteFetchStream } = require('../../../shared/network/safeRemoteFetchStream');
const yauzl = require('yauzl');
const service = require('../../../modules/customization/services/customizationZipInspect.service');
const { customizationStatuses } = require('../../../modules/customization/constants/customizationStatuses');
const { customizationAssetTypes } = require('../../../modules/customization/constants/customizationAssetTypes');
const { customizationZipInspectionStatuses } = require('../../../modules/customization/constants/customizationZipInspectionStatuses');

describe('customizationZipInspect.service', () => {
  const payloadId = '660000000000000000000601';
  const orderItemId = '660000000000000000000401';
  const shopId = '660000000000000000000201';
  const assetId = '660000000000000000000901';

  beforeEach(() => {
    jest.clearAllMocks();
    repository.updateAssets.mockImplementation(async (id, assets) => ({
      _id: id,
      orderItemId,
      shopId,
      status: customizationStatuses.PARSED,
      assets,
      parsedData: { amazonCustomization: { customizedUrl: 'https://example.test/file.zip' } },
    }));
    repository.updateParsedData.mockImplementation(async (id, parsedData, patch = {}) => ({
      _id: id,
      orderItemId,
      shopId,
      status: customizationStatuses.PARSED,
      parsedData,
      assets: patch.assets || [],
    }));
    mediaPublic.withAssetLocalReadFile.mockImplementation(async (id, callback) => callback({
      localPath: 'C:\\media\\file.zip',
      mediaAsset: {
        _id: assetId,
        mimeType: 'application/zip',
        size: 100,
        sha256: 'a'.repeat(64),
      },
    }));
    safeRemoteFetchStream.mockResolvedValue({
      stream: Readable.from([Buffer.from('zip-bytes')]),
      metadata: {
        contentType: 'application/zip',
        classification: 'zip',
      },
    });
    mediaPublic.storeAsset.mockResolvedValue({
      _id: '660000000000000000000902',
      provider: 'cloudinary',
      providerAssetId: 'lng-system/media/front',
      resourceType: 'image',
      secureUrl: 'https://res.cloudinary.com/demo/image/upload/front.png',
      mimeType: 'image/png',
      size: 5,
      sha256: 'b'.repeat(64),
    });
  });

  function payload(assetPatch = {}) {
    return {
      _id: payloadId,
      orderItemId,
      shopId,
      status: customizationStatuses.PARSED,
      parsedData: { amazonCustomization: { customizedUrl: 'https://example.test/file.zip' } },
      assets: [
        {
          type: customizationAssetTypes.CUSTOMIZED_URL,
          status: customizationStatuses.DOWNLOADED,
          sourceUrl: 'https://example.test/file.zip',
          assetId,
          metadata: { classification: 'zip', old: 'kept', zipManifest: { entries: [{ old: true }] } },
          ...assetPatch,
        },
        {
          type: customizationAssetTypes.CUSTOMIZED_PAGE,
          status: customizationStatuses.PENDING,
          sourceUrl: 'https://a.co/page',
          metadata: {},
        },
      ],
    };
  }

  function mockZip(entries) {
    yauzl.open.mockImplementation((localPath, options, callback) => {
      const zipfile = new EventEmitter();
      let index = 0;
      zipfile.readEntry = jest.fn(() => {
        process.nextTick(() => {
          if (index >= entries.length) {
            zipfile.emit('end');
            return;
          }
          zipfile.emit('entry', entries[index]);
          index += 1;
        });
      });
      zipfile.openReadStream = jest.fn((entry, done) => {
        done(null, Readable.from([Buffer.from(entry.content || `image:${entry.fileName}`)]));
      });
      zipfile.close = jest.fn();
      callback(null, zipfile);
    });
  }

  test('inspectDownloadedZipForOrderItem stores manifest and preserves payload and asset statuses', async () => {
    repository.findByOrderItem.mockResolvedValue(payload());
    mockZip([
      {
        fileName: 'design/front.png',
        compressedSize: 10,
        uncompressedSize: 20,
        generalPurposeBitFlag: 0,
        externalFileAttributes: 0,
      },
    ]);

    const result = await service.inspectDownloadedZipForOrderItem(orderItemId);

    expect(mediaPublic.withAssetLocalReadFile).toHaveBeenCalledWith(assetId, expect.any(Function));
    expect(yauzl.open).toHaveBeenCalledWith('C:\\media\\file.zip', {
      lazyEntries: true,
      validateEntrySizes: true,
    }, expect.any(Function));
    expect(mediaPublic.storeAsset).not.toHaveBeenCalled();
    expect(repository.updateAssets).toHaveBeenCalledWith(payloadId, [
      expect.objectContaining({
        status: customizationStatuses.DOWNLOADED,
        metadata: expect.objectContaining({
          old: 'kept',
          zipInspectionStatus: customizationZipInspectionStatuses.INSPECTED,
          zipManifest: expect.objectContaining({
            fileCount: 1,
            entries: [expect.objectContaining({
              normalizedPath: 'design/front.png',
              safe: true,
            })],
          }),
        }),
      }),
      expect.objectContaining({ type: customizationAssetTypes.CUSTOMIZED_PAGE }),
    ]);
    expect(result).toMatchObject({
      payloadId,
      inspectedAssetId: assetId,
      zipInspectionStatus: customizationZipInspectionStatuses.INSPECTED,
      fileCount: 1,
      errors: [],
    });
    expect(result).not.toHaveProperty('localPath');
    expect(result.payload.status).toBe(customizationStatuses.PARSED);
  });

  test('unsafe readable zip stores needs review manifest', async () => {
    repository.findByOrderItem.mockResolvedValue(payload());
    mockZip([
      {
        fileName: '../evil.ps1',
        compressedSize: 10,
        uncompressedSize: 20,
        generalPurposeBitFlag: 1,
        externalFileAttributes: 0,
      },
    ]);

    const result = await service.inspectDownloadedZipForOrderItem(orderItemId);

    expect(result.zipInspectionStatus).toBe(customizationZipInspectionStatuses.NEEDS_REVIEW);
    expect(result.entries[0].safe).toBe(false);
    expect(repository.updateAssets.mock.calls[0][1][0].status).toBe(customizationStatuses.DOWNLOADED);
  });

  test('zip open failure marks asset inspection failed', async () => {
    repository.findByOrderItem.mockResolvedValue(payload());
    yauzl.open.mockImplementation((localPath, options, callback) => {
      callback(new Error('not a zip'));
    });

    const result = await service.inspectDownloadedZipForOrderItem(orderItemId);

    expect(result.zipInspectionStatus).toBe(customizationZipInspectionStatuses.FAILED);
    expect(result.errors).toContain('ZIP_OPEN_FAILED');
    expect(repository.updateAssets.mock.calls[0][1][0]).toEqual(expect.objectContaining({
      status: customizationStatuses.DOWNLOADED,
      metadata: expect.objectContaining({
        zipInspectionStatus: customizationZipInspectionStatuses.FAILED,
        zipInspectionErrorCode: 'ZIP_OPEN_FAILED',
        zipInspectionErrorMessage: 'not a zip',
      }),
    }));
  });

  test('missing downloaded zip asset returns controlled error', async () => {
    repository.findByOrderItem.mockResolvedValue(payload({ status: customizationStatuses.PENDING, assetId: null }));

    await expect(service.inspectDownloadedZipForOrderItem(orderItemId))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  test('extractZipImagesForOrderItem uploads only jpg and png entries through media public', async () => {
    repository.findByOrderItem.mockResolvedValue(payload({
      status: customizationStatuses.FAILED,
      assetId: null,
      metadata: {
        zipManifest: {
          entries: [
            { normalizedPath: 'front.png' },
            { normalizedPath: 'skip.svg' },
            { normalizedPath: 'back.jpg' },
          ],
        },
      },
    }));
    mediaPublic.storeAsset
      .mockResolvedValueOnce({
        _id: '660000000000000000000902',
        provider: 'cloudinary',
        providerAssetId: 'front',
        resourceType: 'image',
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/front.png',
        mimeType: 'image/png',
        size: 5,
        sha256: 'c'.repeat(64),
      })
      .mockResolvedValueOnce({
        _id: '660000000000000000000903',
        provider: 'cloudinary',
        providerAssetId: 'back',
        resourceType: 'image',
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/back.jpg',
        mimeType: 'image/jpeg',
        size: 6,
        sha256: 'd'.repeat(64),
      });
    mockZip([
      { fileName: 'front.png', compressedSize: 5, uncompressedSize: 5, generalPurposeBitFlag: 0, externalFileAttributes: 0 },
      { fileName: 'skip.svg', compressedSize: 4, uncompressedSize: 4, generalPurposeBitFlag: 0, externalFileAttributes: 0 },
      { fileName: 'back.jpg', compressedSize: 6, uncompressedSize: 6, generalPurposeBitFlag: 0, externalFileAttributes: 0 },
    ]);

    const result = await service.extractZipImagesForOrderItem(orderItemId);

    expect(safeRemoteFetchStream).toHaveBeenCalledWith('https://example.test/file.zip', expect.objectContaining({
      maxBytes: 10485760,
    }));
    expect(mediaPublic.storeAsset).toHaveBeenCalledTimes(2);
    expect(mediaPublic.storeAsset).toHaveBeenNthCalledWith(1, expect.objectContaining({
      filename: 'front.png',
      mimeType: 'image/png',
      metadata: expect.objectContaining({
        zipEntryPath: 'front.png',
        sourceZipUrlRedacted: 'https://example.test/[REDACTED_PATH]',
      }),
    }));
    expect(mediaPublic.storeAsset).toHaveBeenNthCalledWith(2, expect.objectContaining({
      filename: 'back.jpg',
      mimeType: 'image/jpeg',
    }));
    expect(repository.updateParsedData).toHaveBeenCalledWith(
      payloadId,
      expect.objectContaining({
        amazonCustomization: expect.objectContaining({
          zipJsonFiles: [],
          zipJsonParseErrors: [],
        }),
      }),
      {
        assets: [
          expect.objectContaining({
            status: customizationStatuses.FAILED,
            metadata: expect.objectContaining({
              zipImageExtractionStatus: 'EXTRACTED',
              extractedImages: [
                expect.objectContaining({ normalizedPath: 'front.png', assetId: '660000000000000000000902' }),
                expect.objectContaining({ normalizedPath: 'back.jpg', assetId: '660000000000000000000903' }),
              ],
              zipManifest: expect.objectContaining({
                entries: [
                  expect.objectContaining({ normalizedPath: 'front.png', extractedAssetId: '660000000000000000000902' }),
                  expect.objectContaining({ normalizedPath: 'skip.svg' }),
                  expect.objectContaining({ normalizedPath: 'back.jpg', extractedAssetId: '660000000000000000000903' }),
                ],
              }),
            }),
          }),
          expect.objectContaining({ type: customizationAssetTypes.CUSTOMIZED_PAGE }),
        ],
      },
    );
    expect(result).toMatchObject({
      payloadId,
      extractedCount: 2,
      skippedCount: 1,
      failedCount: 0,
    });
    expect(result).not.toHaveProperty('localPath');
  });

  test('extractZipImagesForOrderItem parses json customer inputs and links image uploads', async () => {
    repository.findByOrderItem.mockResolvedValue(payload({
      metadata: {
        zipManifest: {
          entries: [
            { normalizedPath: '163223994462241.json' },
            { normalizedPath: 'accc2047.jpg' },
          ],
        },
      },
    }));
    mediaPublic.storeAsset.mockResolvedValueOnce({
      _id: '660000000000000000000902',
      provider: 'cloudinary',
      providerAssetId: 'image-asset',
      resourceType: 'image',
      secureUrl: 'https://res.cloudinary.com/demo/image/upload/accc2047.jpg',
      mimeType: 'image/jpeg',
      size: 5,
      sha256: 'c'.repeat(64),
    });
    mockZip([
      {
        fileName: '163223994462241.json',
        compressedSize: 100,
        uncompressedSize: 500,
        generalPurposeBitFlag: 0,
        externalFileAttributes: 0,
        content: JSON.stringify({
          orderId: '111-9039002-8646662',
          orderItemId: '163223994462241',
          customizationData: {
            children: [
              {
                children: [
                  {
                    children: [
                      {
                        type: 'OptionCustomization',
                        label: 'Choose Size',
                        displayValue: '11.8 x 23.6 Inches',
                      },
                      {
                        type: 'ImageCustomization',
                        label: 'Upload Photo',
                        position: 'Front',
                        image: {
                          imageName: 'accc2047.jpg',
                          buyerFilename: 'customer.jpeg',
                        },
                      },
                      {
                        type: 'TextCustomization',
                        label: 'Custom Text',
                        placement: { name: 'Front Text' },
                        inputValue: 'We love you!',
                      },
                    ],
                  },
                ],
              },
            ],
          },
          'version3.0': {
            customizationInfo: {
              surfaces: [
                {
                  name: 'Surface 1',
                  areas: [
                    {
                      customizationType: 'Options',
                      label: 'Choose Color',
                      side: 'Back side',
                      optionValue: 'Ash Gray',
                    },
                  ],
                },
              ],
            },
          },
        }),
      },
      {
        fileName: 'accc2047.jpg',
        compressedSize: 5,
        uncompressedSize: 5,
        generalPurposeBitFlag: 0,
        externalFileAttributes: 0,
      },
    ]);

    const result = await service.extractZipImagesForOrderItem(orderItemId);

    expect(result.extractedCount).toBe(1);
    expect(repository.updateParsedData).toHaveBeenCalledWith(
      payloadId,
      expect.objectContaining({
        amazonCustomization: expect.objectContaining({
          customerInputs: expect.objectContaining({
            sourceJsonPath: '163223994462241.json',
            texts: [
              expect.objectContaining({ label: 'Custom Text', value: 'We love you!', slotKey: 'FRONT_TEXT' }),
            ],
            options: expect.arrayContaining([
              expect.objectContaining({ label: 'Choose Size', value: '11.8 x 23.6 Inches' }),
              expect.objectContaining({ label: 'Choose Color', value: 'Ash Gray', slotKey: 'BACK_SIDE' }),
            ]),
            images: [
              expect.objectContaining({
                label: 'Upload Photo',
                slotKey: 'FRONT',
                positionRaw: expect.objectContaining({ position: 'Front' }),
                imageName: 'accc2047.jpg',
                buyerFilename: 'customer.jpeg',
                assetId: '660000000000000000000902',
                secureUrl: 'https://res.cloudinary.com/demo/image/upload/accc2047.jpg',
              }),
            ],
          }),
        }),
      }),
      expect.objectContaining({ assets: expect.any(Array) }),
    );
    expect(result.payload.parsedData.amazonCustomization.customerInputs.images[0].secureUrl)
      .toBe('https://res.cloudinary.com/demo/image/upload/accc2047.jpg');
  });

  test('extractZipImagesForOrderItem records per-entry upload failures', async () => {
    repository.findByOrderItem.mockResolvedValue(payload());
    mediaPublic.storeAsset.mockRejectedValueOnce(Object.assign(new Error('Cloud upload failed'), {
      code: 'MEDIA_CLOUDINARY_UPLOAD_FAILED',
    }));
    mockZip([
      { fileName: 'front.png', compressedSize: 5, uncompressedSize: 5, generalPurposeBitFlag: 0, externalFileAttributes: 0 },
    ]);

    const result = await service.extractZipImagesForOrderItem(orderItemId);

    expect(result).toMatchObject({
      extractedCount: 0,
      skippedCount: 0,
      failedCount: 1,
      failedImages: [
        {
          normalizedPath: 'front.png',
          errorCode: 'MEDIA_CLOUDINARY_UPLOAD_FAILED',
          errorMessage: 'Cloud upload failed',
        },
      ],
    });
    expect(repository.updateParsedData.mock.calls[0][2].assets[0].metadata).toEqual(expect.objectContaining({
      zipImageExtractionStatus: 'PARTIAL_FAILED',
      failedImages: [
        expect.objectContaining({
          normalizedPath: 'front.png',
          errorCode: 'MEDIA_CLOUDINARY_UPLOAD_FAILED',
        }),
      ],
    }));
  });

  test('extractZipImagesForOrderItem reuses already extracted images on rerun', async () => {
    repository.findByOrderItem.mockResolvedValue(payload({
      metadata: {
        extractedImages: [
          {
            normalizedPath: 'front.png',
            filename: 'front.png',
            assetId: '660000000000000000000902',
            secureUrl: 'https://res.cloudinary.com/demo/image/upload/front.png',
            mimeType: 'image/png',
          },
        ],
      },
    }));
    mockZip([
      { fileName: 'front.png', compressedSize: 5, uncompressedSize: 5, generalPurposeBitFlag: 0, externalFileAttributes: 0 },
    ]);

    const result = await service.extractZipImagesForOrderItem(orderItemId);

    expect(mediaPublic.storeAsset).not.toHaveBeenCalled();
    expect(result.extractedImages).toEqual([
      expect.objectContaining({
        normalizedPath: 'front.png',
        assetId: '660000000000000000000902',
      }),
    ]);
  });

  test('service imports only media public port across module boundary', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../modules/customization/services/customizationZipInspect.service.js'), 'utf8');

    expect(source).toContain("require('../../media/public')");
    expect(source).not.toMatch(/media\/(models|repositories|services|controllers|routes)\//);
    expect(source).not.toMatch(/order\/|catalog\/|mapping\/|production\/|vendorSubmission\/|shipment\//);
  });
});
