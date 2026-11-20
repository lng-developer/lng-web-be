function isClientAbortedStreamError(error, response) {
  if (!response?.destroyed) return false;

  return error?.code === 'ERR_STREAM_PREMATURE_CLOSE'
    || error?.code === 'ERR_STREAM_DESTROYED'
    || error?.message === 'Cannot pipe to a closed or destroyed stream';
}

module.exports = isClientAbortedStreamError;
