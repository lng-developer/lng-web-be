function toListingContentRunDto(run) {
  if (!run) return null;
  return {
    id: String(run._id), launchId: String(run.launchId), shopId: String(run.shopId), requestKey: run.requestKey,
    inputVersion: run.inputVersion, inputHash: run.inputHash, profileVersion: run.profileVersion,
    promptVersion: run.promptVersion, provider: run.provider, model: run.model, status: run.status,
    requestedBy: String(run.requestedBy), createdAt: run.createdAt, startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null, resultVersionId: run.status === runStatuses.SUCCEEDED && run.resultVersionId ? String(run.resultVersionId) : null,
    providerRequestId: run.providerRequestId ?? null,
    usage: run.usage ? { inputTokens: run.usage.inputTokens ?? null, outputTokens: run.usage.outputTokens ?? null, totalTokens: run.usage.totalTokens ?? null } : null,
    errorCode: run.errorCode ?? null, errorMessage: run.errorMessage ?? null,
    validationErrors: (run.validationErrors || []).slice(0, 20).map(({ field, code, message }) => ({ field, code, message })),
  };
}

function toListingContentVersionDto(version, validity) {
  return {
    id: String(version._id), launchId: String(version.launchId), shopId: String(version.shopId),
    version: version.version, source: version.source,
    runId: version.runId ? String(version.runId) : null,
    parentVersionId: version.parentVersionId ? String(version.parentVersionId) : null,
    inputVersion: version.inputVersion, inputHash: version.inputHash, profileVersion: version.profileVersion,
    content: { title: version.content.title, bullets: [...version.content.bullets], searchTerms: [...version.content.searchTerms],
      recommendedColors: version.content.recommendedColors.map(({ code, reason }) => ({ code, reason })) },
    createdBy: String(version.createdBy), createdAt: version.createdAt, updatedAt: version.updatedAt,
    isStale: validity.isStale,
  };
}

module.exports = { toListingContentRunDto, toListingContentVersionDto };
const { runStatuses } = require('../constants/listingContent.constants');
