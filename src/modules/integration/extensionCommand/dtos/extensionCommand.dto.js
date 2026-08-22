function id(value) { return value === undefined || value === null ? null : String(value._id || value.id || value); }
function toAgentDto(agent) { return agent && { id: id(agent), shopId: id(agent.shopId), clientId: agent.clientId, label: agent.label, version: agent.version || null, apiBaseUrl: agent.apiBaseUrl || null, lastSeenAt: agent.lastSeenAt, createdAt: agent.createdAt, updatedAt: agent.updatedAt }; }
function toManagementAgentDto(agent, token, status) { return agent && { ...toAgentDto(agent), status, token: token || null }; }
function toCommandDto(command) {
  return command && { id: id(command), type: command.type, status: command.status, shopId: id(command.shopId), agentId: id(command.agentId), createdByAccountId: id(command.createdByAccountId), claimedAt: command.claimedAt, startedAt: command.startedAt, completedAt: command.completedAt, leaseExpiresAt: command.leaseExpiresAt, attemptCount: command.attemptCount, importJobId: id(command.importJobId), result: command.result || { importedCount: 0, failedCount: 0 }, errorMessage: command.errorMessage || null, createdAt: command.createdAt, updatedAt: command.updatedAt };
}
module.exports = { toAgentDto, toManagementAgentDto, toCommandDto };
