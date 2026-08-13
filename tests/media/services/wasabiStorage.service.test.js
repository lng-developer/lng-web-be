const mockSend = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(input) { this.input = input; }
  }
  return {
    S3Client: jest.fn(() => ({ send: mockSend })),
    CreateMultipartUploadCommand: Command,
    UploadPartCommand: Command,
    CompleteMultipartUploadCommand: Command,
    AbortMultipartUploadCommand: Command,
    HeadObjectCommand: Command,
    GetObjectCommand: Command,
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: mockGetSignedUrl }));

describe('wasabiStorage service', () => {
  let service;

  beforeEach(() => {
    jest.resetModules();
    mockSend.mockReset();
    mockGetSignedUrl.mockReset();
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/lng_test';
    process.env.WASABI_ENDPOINT = 'https://s3.us-east-1.wasabisys.com';
    process.env.WASABI_REGION = 'us-east-1';
    process.env.WASABI_BUCKET = 'private-designs';
    process.env.WASABI_ACCESS_KEY_ID = 'test-key';
    process.env.WASABI_SECRET_ACCESS_KEY = 'test-secret';
    service = require('../../../src/modules/media/services/wasabiStorage.service');
  });

  test('creates a multipart upload in the private bucket', async () => {
    mockSend.mockResolvedValue({ UploadId: 'upload-1' });

    await expect(service.createMultipartUpload({
      key: 'media/asset.psd',
      contentType: 'image/vnd.adobe.photoshop',
    })).resolves.toEqual({ uploadId: 'upload-1' });

    expect(mockSend.mock.calls[0][0].input).toEqual({
      Bucket: 'private-designs',
      Key: 'media/asset.psd',
      ContentType: 'image/vnd.adobe.photoshop',
    });
  });

  test('sorts completed parts before sending them to Wasabi', async () => {
    mockSend.mockResolvedValue({ ETag: 'complete-etag' });

    await service.completeMultipartUpload({
      key: 'media/asset.zip',
      uploadId: 'upload-1',
      parts: [
        { partNumber: 2, etag: 'etag-2' },
        { partNumber: 1, etag: 'etag-1' },
      ],
    });

    expect(mockSend.mock.calls[0][0].input.MultipartUpload.Parts).toEqual([
      { PartNumber: 1, ETag: 'etag-1' },
      { PartNumber: 2, ETag: 'etag-2' },
    ]);
  });

  test('range reads only the requested signature bytes', async () => {
    const body = { transformToByteArray: jest.fn().mockResolvedValue([0x38, 0x42, 0x50, 0x53]) };
    mockSend.mockResolvedValue({ Body: body });

    await expect(service.readObjectRange({ key: 'media/asset.psd', start: 0, end: 7 }))
      .resolves.toEqual(Buffer.from([0x38, 0x42, 0x50, 0x53]));

    expect(mockSend.mock.calls[0][0].input.Range).toBe('bytes=0-7');
  });

  test('presigns upload parts and attachment downloads', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://upload.example').mockResolvedValueOnce('https://download.example');

    await expect(service.presignUploadPart({
      key: 'media/asset.zip', uploadId: 'upload-1', partNumber: 3, expiresIn: 900,
    })).resolves.toBe('https://upload.example');
    await expect(service.presignDownload({
      key: 'media/asset.zip', filename: 'design package.zip', expiresIn: 600,
    })).resolves.toBe('https://download.example');

    expect(mockGetSignedUrl.mock.calls[0][2]).toEqual({ expiresIn: 900 });
    expect(mockGetSignedUrl.mock.calls[1][1].input.ResponseContentDisposition)
      .toBe("attachment; filename*=UTF-8''design%20package.zip");
  });

  test('presigns inline downloads for previews', async () => {
    mockGetSignedUrl.mockResolvedValueOnce('https://download.example');

    await expect(service.presignDownload({
      key: 'media/asset.jpg', filename: 'songoku.jpg', expiresIn: 600, disposition: 'inline',
    })).resolves.toBe('https://download.example');

    expect(mockGetSignedUrl.mock.calls[0][1].input.ResponseContentDisposition)
      .toBe("inline; filename*=UTF-8''songoku.jpg");
  });
});
