const {
  toCustomizationPayloadDto,
  toOrderItemCustomizationViewDto,
} = require('../../../modules/customization/dtos/customizationPayload.dto');

describe('customizationPayload.dto', () => {
  test('exposes extracted Cloudinary images in frontend-friendly fields', () => {
    const dto = toCustomizationPayloadDto({
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
          sourceUrl: 'https://zme-caps.amazon.com/t/token/file.zip?secret=do-not-leak',
          assetId: '660000000000000000000901',
          metadata: {
            mimeType: 'application/zip',
            size: 2586485,
            sha256: 'a'.repeat(64),
            classification: 'zip',
            downloadedAt: '2026-06-30T01:00:00.000Z',
            zipInspectionStatus: 'INSPECTED',
            zipInspectedAt: '2026-06-30T01:01:00.000Z',
            zipManifest: {
              fileCount: 2,
              directoryCount: 0,
              totalCompressedBytes: 100,
              totalUncompressedBytes: 200,
              warnings: ['ZIP_ENTRY_UNKNOWN_EXTENSION'],
              errors: [],
            },
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
                localPath: 'C:\\storage\\front.jpg',
              },
            ],
            failedImages: [
              {
                normalizedPath: 'bad.png',
                errorCode: 'MEDIA_UPLOAD_FAILED',
                errorMessage: 'upload failed',
                localPath: 'C:\\storage\\bad.png',
              },
            ],
          },
        },
      ],
      parsedData: {
        amazonCustomization: {
          customerInputs: {
            texts: [{ label: 'Custom Text', value: 'We love you!' }],
            options: [{ label: 'Choose Size', value: '11.8 x 23.6 Inches' }],
            images: [{
              imageName: 'front.jpg',
              secureUrl: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
            }],
          },
        },
      },
      localPath: 'C:\\storage\\asset.zip',
    });

    expect(dto.assets).toHaveLength(1);
    expect(dto.downloadedZip).toMatchObject({
      assetId: '660000000000000000000901',
      status: 'DOWNLOADED',
      mimeType: 'application/zip',
      size: 2586485,
      sha256: 'a'.repeat(64),
      classification: 'zip',
    });
    expect(dto.downloadedZip.sourceUrlRedacted).toContain('[REDACTED_PATH]');
    expect(dto.downloadedZip.sourceUrlRedacted).not.toContain('secret=do-not-leak');
    expect(dto.zipInspection).toMatchObject({
      status: 'INSPECTED',
      fileCount: 2,
      directoryCount: 0,
      totalCompressedBytes: 100,
      totalUncompressedBytes: 200,
      warnings: ['ZIP_ENTRY_UNKNOWN_EXTENSION'],
      errors: [],
    });
    expect(dto.extractedImages).toEqual([
      {
        index: null,
        originalPath: 'front.jpg',
        normalizedPath: 'front.jpg',
        filename: 'front.jpg',
        extension: null,
        assetId: '660000000000000000000902',
        provider: null,
        providerAssetId: null,
        resourceType: null,
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
        mimeType: 'image/jpeg',
        size: 69071,
        sha256: 'b'.repeat(64),
      },
    ]);
    expect(dto.failedImages).toEqual([
      {
        index: null,
        originalPath: null,
        normalizedPath: 'bad.png',
        filename: null,
        extension: null,
        errorCode: 'MEDIA_UPLOAD_FAILED',
        errorMessage: 'upload failed',
      },
    ]);
    expect(dto.customerInputs).toEqual({
      texts: [{ label: 'Custom Text', value: 'We love you!' }],
      options: [{ label: 'Choose Size', value: '11.8 x 23.6 Inches' }],
      images: [{
        imageName: 'front.jpg',
        secureUrl: 'https://res.cloudinary.com/demo/image/upload/front.jpg',
      }],
    });
    expect(dto.review).toMatchObject({
      status: 'PARSED',
      needsReview: false,
      customerInputs: dto.customerInputs,
      extractedImages: dto.extractedImages,
      failedImages: dto.failedImages,
    });
    expect(JSON.stringify(dto)).not.toContain('localPath');
  });

  test('returns empty image arrays when no extracted images exist', () => {
    const dto = toCustomizationPayloadDto({
      _id: '660000000000000000000601',
      status: 'PENDING',
      assets: [],
    });

    expect(dto.downloadedZip).toBeNull();
    expect(dto.zipInspection).toBeNull();
    expect(dto.extractedImages).toEqual([]);
    expect(dto.failedImages).toEqual([]);
    expect(dto.customerInputs).toBeNull();
    expect(dto.review).toMatchObject({
      status: 'PENDING',
      needsReview: false,
      customerInputs: null,
      extractedImages: [],
    });
    expect(dto.assets).toEqual([]);
  });

  test('maps slim order-item customization view without raw/debug payload fields', () => {
    const dto = toOrderItemCustomizationViewDto({
      _id: '660000000000000000000601',
      orderItemId: '660000000000000000000401',
      status: 'PARSED',
      errorCode: null,
      errorMessage: null,
      rawRecordId: '660000000000000000000701',
      parsedData: {
        amazonCustomization: {
          customerInputs: {
            sourceJsonPath: '163104263403801.json',
            orderId: '114-1',
            orderItemId: 'item-1',
            asin: 'B000TEST',
            texts: [{ label: 'Custom Name', value: 'NURSE' }],
            images: [{ imageName: 'front.jpg', secureUrl: 'https://res.cloudinary.com/demo/front.jpg' }],
          },
        },
      },
      assets: [{
        type: 'CUSTOMIZED_URL',
        status: 'DOWNLOADED',
        sourceUrl: 'https://zme-caps.amazon.com/t/token/file.zip?secret=do-not-leak',
        metadata: {
          extractedImages: [{
            assetId: '660000000000000000000902',
            secureUrl: 'https://res.cloudinary.com/demo/front.jpg',
            filename: 'front.jpg',
            mimeType: 'image/jpeg',
            size: 1234,
            sha256: 'a'.repeat(64),
          }],
          failedImages: [{
            filename: 'bad.png',
            errorCode: 'MEDIA_UPLOAD_FAILED',
            errorMessage: 'upload failed',
          }],
        },
      }],
    });

    expect(dto).toEqual({
      payloadId: '660000000000000000000601',
      orderItemId: '660000000000000000000401',
      status: 'PARSED',
      needsReview: false,
      errorCode: null,
      errorMessage: null,
      customerInputs: {
        texts: [{ label: 'Custom Name', value: 'NURSE' }],
        images: [{ imageName: 'front.jpg', secureUrl: 'https://res.cloudinary.com/demo/front.jpg' }],
      },
      imageAssets: [{
        assetId: '660000000000000000000902',
        secureUrl: 'https://res.cloudinary.com/demo/front.jpg',
        filename: 'front.jpg',
        mimeType: 'image/jpeg',
        size: 1234,
        sha256: 'a'.repeat(64),
      }],
      failedImages: [{
        filename: 'bad.png',
        errorCode: 'MEDIA_UPLOAD_FAILED',
        errorMessage: 'upload failed',
      }],
    });
    expect(dto.customerInputs.texts).toEqual([{ label: 'Custom Name', value: 'NURSE' }]);
    expect(JSON.stringify(dto)).not.toContain('rawRecordId');
    expect(JSON.stringify(dto)).not.toContain('parsedData');
    expect(JSON.stringify(dto)).not.toContain('CUSTOMIZED_URL');
    expect(JSON.stringify(dto)).not.toContain('secret=do-not-leak');
    expect(JSON.stringify(dto)).not.toContain('sourceJsonPath');
    expect(JSON.stringify(dto)).not.toContain('B000TEST');
  });

  test('dedupes customer input texts and prefers entries with name', () => {
    const dto = toOrderItemCustomizationViewDto({
      _id: '660000000000000000000601',
      orderItemId: '660000000000000000000401',
      status: 'PARSED',
      parsedData: {
        amazonCustomization: {
          customerInputs: {
            texts: [
              { label: 'Custom Name', name: null, value: 'Christie' },
              { label: 'Custom Name', name: 'Name', value: 'Christie' },
              { label: 'Custom Text', name: null, value: 'Happy Birthday' },
              { label: 'Custom Text', name: 'Adress', value: 'Happy Birthday' },
            ],
          },
        },
      },
      assets: [],
    });

    expect(dto.customerInputs.texts).toEqual([
      { label: 'Custom Name', name: 'Name', value: 'Christie' },
      { label: 'Custom Text', name: 'Adress', value: 'Happy Birthday' },
    ]);
  });
});
