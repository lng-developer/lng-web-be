const {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('../../../config');

let client;

function settings() {
  const value = config.media.wasabi;
  if (!value.endpoint || !value.region || !value.bucket || !value.accessKeyId || !value.secretAccessKey) {
    const error = new Error('Wasabi configuration is incomplete');
    error.code = 'MEDIA_WASABI_CONFIG_MISSING';
    throw error;
  }
  return value;
}

function getClient() {
  const value = settings();
  if (!client) {
    client = new S3Client({
      endpoint: value.endpoint,
      region: value.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: value.accessKeyId,
        secretAccessKey: value.secretAccessKey,
      },
    });
  }
  return client;
}

async function createMultipartUpload({ key, contentType }) {
  const result = await getClient().send(new CreateMultipartUploadCommand({
    Bucket: settings().bucket,
    Key: key,
    ContentType: contentType,
  }));
  return { uploadId: result.UploadId };
}

async function presignUploadPart({ key, uploadId, partNumber, expiresIn }) {
  const command = new UploadPartCommand({
    Bucket: settings().bucket,
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

async function completeMultipartUpload({ key, uploadId, parts }) {
  const completedParts = parts
    .map(({ partNumber, etag }) => ({ PartNumber: partNumber, ETag: etag }))
    .sort((a, b) => a.PartNumber - b.PartNumber);
  return getClient().send(new CompleteMultipartUploadCommand({
    Bucket: settings().bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: completedParts },
  }));
}

function abortMultipartUpload({ key, uploadId }) {
  return getClient().send(new AbortMultipartUploadCommand({
    Bucket: settings().bucket, Key: key, UploadId: uploadId,
  }));
}

function headObject({ key }) {
  return getClient().send(new HeadObjectCommand({ Bucket: settings().bucket, Key: key }));
}

async function readObjectRange({ key, start, end }) {
  const result = await getClient().send(new GetObjectCommand({
    Bucket: settings().bucket,
    Key: key,
    Range: `bytes=${start}-${end}`,
  }));
  return Buffer.from(await result.Body.transformToByteArray());
}

function presignDownload({ key, filename, expiresIn, disposition = 'attachment' }) {
  const command = new GetObjectCommand({
    Bucket: settings().bucket,
    Key: key,
    ResponseContentDisposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

module.exports = {
  createMultipartUpload,
  presignUploadPart,
  completeMultipartUpload,
  abortMultipartUpload,
  headObject,
  readObjectRange,
  presignDownload,
};
