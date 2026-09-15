function toAnalysisDto(run, launch) {
  if (!run) return null;
  return { id: String(run._id), launchId: String(run.launchId), shopId: String(run.shopId), requestKey: run.requestKey,
    mockupRevision: run.mockupRevision, status: run.status,
    result: run.status === 'SUCCEEDED' && run.result ? { detectedText: run.result.detectedText, theme: run.result.theme,
      designDescription: run.result.designDescription, suggestedKeyword: run.result.suggestedKeyword, warnings: [...run.result.warnings] } : null,
    isStale: String(launch.mockupAssetId) !== String(run.assetId) || launch.mockupRevision !== run.mockupRevision,
    createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt,
    errorCode: run.errorCode, errorMessage: run.errorMessage,
    validationErrors: (run.validationErrors || []).map(({ field, code, message }) => ({ field, code, message })),
    usage: run.usage ? { inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens, totalTokens: run.usage.totalTokens } : null };
}
module.exports = { toAnalysisDto };
