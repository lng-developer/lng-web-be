const customizationStatuses = Object.freeze({
  PENDING: 'PENDING',
  DOWNLOADING: 'DOWNLOADING',
  DOWNLOADED: 'DOWNLOADED',
  EXTRACTING: 'EXTRACTING',
  PARSED: 'PARSED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
  FAILED: 'FAILED',
});

module.exports = {
  customizationStatuses,
};
