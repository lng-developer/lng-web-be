const recordStatuses = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

const listingQcStatuses = Object.freeze({
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

const setupStatuses = Object.freeze({
  MISSING: 'MISSING',
  PRESENT: 'PRESENT',
});

const psdTemplateUpload = Object.freeze({
  maxBytes: 200 * 1024 * 1024,
  allowedExtensions: ['.psd', '.zip', '.rar'],
  allowedMimeTypes: [
    'application/octet-stream',
    'application/zip',
    'application/x-photoshop',
    'application/x-rar-compressed',
    'application/vnd.adobe.photoshop',
    'application/vnd.rar',
    'image/vnd.adobe.photoshop',
  ],
});

module.exports = {
  listingQcStatuses,
  psdTemplateUpload,
  recordStatuses,
  setupStatuses,
};
