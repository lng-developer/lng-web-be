const crypto = require('crypto');
const httpStatus = require('../../../../shared/constants/httpStatus');
const errorCodes = require('../../../../shared/constants/errorCodes');
const AppError = require('../../../../shared/errors/appError');
const authPublic = require('../../../auth/public');
const shipmentPublic = require('../../../shipment/public');
const repository = require('../repositories/amazonTrackingSubmission.repository');
const extensionCommandRepository = require('../../extensionCommand/repositories/extensionCommand.repository');
const { extensionCommandTypes, extensionCommandStatuses } = require('../../extensionCommand/constants/extensionCommand.constants');
const { amazonTrackingSubmissionStatuses, normalizeCarrierCode } = require('../constants/amazonTrackingSubmission.constants');
const { toSubmissionDto, toSubmissionDetailDto, toLeasedPayloadDto } = require('../dtos/amazonTrackingSubmission.dto');

const forbidden = () => new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
const notFound = (message) => new AppError(message, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
const badRequest = (message) => new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
const conflict = (message) => new AppError(message, httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);

function hashString(val) {
  return crypto.createHash('sha256').update(String(val || '')).digest('hex');
}

function sha256Hex(val) {
  return crypto.createHash('sha256').update(String(val || ''), 'utf8').digest('hex');
}

function assertUserShopAccess(auth, shopId, permission) {
  if (auth?.system) return;
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  const scope = { scopeType: 'shop', scopeId: String(shopId) };
  if (!authPublic.canAccessScope(auth, permission, scope)) throw forbidden();
}

async function assertExtensionAgent(auth, clientId) {
  if (auth?.tokenType !== 'EXTENSION' || !auth.extensionTokenId) throw forbidden();
  const agent = await extensionCommandRepository.findAgentForToken(auth.extensionTokenId, clientId);
  if (!agent) throw notFound('Extension agent not registered');
  return agent;
}

async function validateCommandLease(commandId, agentId, leaseToken) {
  const command = await extensionCommandRepository.findCommandById(commandId);
  if (!command) throw notFound('Command not found');
  if (String(command.agentId) !== String(agentId)) throw forbidden();
  if (command.leaseTokenHash !== hashString(leaseToken)) throw forbidden();
  return command;
}

function formatDate(date) {
  // Amazon US operates on US Pacific Time (America/Los_Angeles).
  // A ship-date cannot be in the future relative to Amazon marketplace time.
  const d = new Date(date);
  const pstFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' });
  const formatted = pstFormatter.format(d);
  const todayInPst = pstFormatter.format(new Date());
  return formatted > todayInPst ? todayInPst : formatted;
}

async function createSubmission(payload, authContext) {
  assertUserShopAccess(authContext, payload.shopId, 'ORDERS:WRITE');

  const agent = await extensionCommandRepository.findAgentById(payload.agentId);
  if (!agent) throw notFound('Extension agent not found');
  if (String(agent.shopId) !== String(payload.shopId)) throw badRequest('Agent does not belong to the selected shop');

  const shipments = await shipmentPublic.findByIds(payload.shipmentIds);
  if (!shipments.length) throw notFound('No shipments found');

  const validRows = [];
  const validShipmentIds = [];

  for (const shipment of shipments) {
    if (String(shipment.shopId) !== String(payload.shopId)) {
      throw badRequest(`Shipment ${shipment._id} does not belong to shop ${payload.shopId}`);
    }
    if (shipment.status !== 'SHIPPED') {
      throw badRequest(`Shipment ${shipment._id} is not in SHIPPED status`);
    }
    if (!shipment.externalOrderId || !shipment.carrier || !shipment.trackingNumber || !shipment.shippedAt) {
      throw badRequest(`Shipment ${shipment._id} is missing tracking details (carrier, trackingNumber, or shippedAt)`);
    }

    const shipDate = formatDate(shipment.shippedAt);
    const carrierCode = normalizeCarrierCode(shipment.carrier);
    let shipMethod = 'Standard';
    if (carrierCode === 'USPS') {
      shipMethod = 'USPS First Class';
    } else if (carrierCode === 'UPS') {
      shipMethod = 'UPS Ground';
    } else if (carrierCode === 'FedEx') {
      shipMethod = 'FedEx Ground';
    }

    validRows.push({
      shipmentId: shipment._id,
      orderId: shipment.orderId || null,
      externalOrderId: shipment.externalOrderId,
      shipDate,
      carrier: shipment.carrier,
      carrierCode,
      trackingNumber: shipment.trackingNumber,
      shipMethod,
    });
    validShipmentIds.push(shipment._id);
  }

  // Build TSV feed strictly matching the official Amazon Shipping Confirmation Template
  const templateHeaders = [
    'order-id',
    'order-item-id',
    'quantity',
    'ship-date',
    'carrier-code',
    'carrier-name',
    'tracking-number',
    'ship-method',
    'transparency_code',
    'ship_from_address_name',
    'ship_from_address_line1',
    'ship_from_address_line2',
    'ship_from_address_line3',
    'ship_from_address_city',
    'ship_from_address_county',
    'ship_from_address_state_or_region',
    'ship_from_address_postalcode',
    'ship_from_address_countrycode',
    'ship_from_supply_source_id',
  ];
  const tsvHeader = templateHeaders.join('\t') + '\r\n';
  const tsvLines = validRows.map((r) => [
    r.externalOrderId,
    '', // order-item-id: not required for whole order
    '', // quantity: not required when confirming full shipment
    r.shipDate,
    r.carrierCode,
    r.carrierCode === 'Other' ? (r.carrier || 'Other') : '',
    r.trackingNumber,
    r.shipMethod || 'Standard',
    '', // transparency_code
    '', // ship_from_address_name
    '', // ship_from_address_line1
    '', // ship_from_address_line2
    '', // ship_from_address_line3
    '', // ship_from_address_city
    '', // ship_from_address_county
    '', // ship_from_address_state_or_region
    '', // ship_from_address_postalcode
    '', // ship_from_address_countrycode
    '', // ship_from_supply_source_id
  ].join('\t') + '\r\n');
  const tsv = tsvHeader + tsvLines.join('');
  const checksum = sha256Hex(tsv);
  const filename = `shipping-confirmation-${Date.now()}.txt`;

  // Create submission record
  const submission = await repository.create({
    shopId: payload.shopId,
    agentId: payload.agentId,
    shipmentIds: validShipmentIds,
    rows: validRows,
    filename,
    tsv,
    rowCount: validRows.length,
    checksum,
    status: amazonTrackingSubmissionStatuses.PENDING,
  });

  // Create extension command
  let command;
  try {
    command = await extensionCommandRepository.createCommand({
      type: extensionCommandTypes.UPLOAD_TRACKING,
      status: extensionCommandStatuses.QUEUED,
      shopId: payload.shopId,
      agentId: payload.agentId,
      trackingSubmissionId: submission._id,
      activeOrderKey: String(payload.agentId),
      createdByAccountId: authContext.accountId || null,
    });
  } catch (cmdErr) {
    await repository.updateById(submission._id, { status: amazonTrackingSubmissionStatuses.FAILED, errorMessage: cmdErr?.message });
    if (cmdErr?.code === 11000) throw conflict('Another operation is already active for this extension agent');
    throw cmdErr;
  }

  // Link commandId to submission
  const updatedSubmission = await repository.updateById(submission._id, { commandId: command._id });

  // Update shipments to SUBMITTED
  await shipmentPublic.updateMarketplaceConfirmation(validShipmentIds, {
    status: 'SUBMITTED',
    submissionId: submission._id,
  });

  return toSubmissionDto(updatedSubmission);
}

async function getLeasedPayload(commandId, body, authContext) {
  const agent = await assertExtensionAgent(authContext, body.clientId);
  const command = await validateCommandLease(commandId, agent._id, body.leaseToken);
  const submission = await repository.findByCommandId(command._id);
  if (!submission) throw notFound('Tracking submission not found for command');
  return toLeasedPayloadDto(submission);
}

async function markSubmitted(commandId, submissionId, body, authContext) {
  const agent = await assertExtensionAgent(authContext, body.clientId);
  await validateCommandLease(commandId, agent._id, body.leaseToken);
  const submission = await repository.findById(submissionId);
  if (!submission) throw notFound('Submission not found');
  const updated = await repository.updateById(submissionId, {
    status: amazonTrackingSubmissionStatuses.SUBMITTED,
    submittedAt: new Date(),
  });
  return toSubmissionDto(updated);
}

async function markWaiting(commandId, submissionId, body, authContext) {
  const agent = await assertExtensionAgent(authContext, body.clientId);
  await validateCommandLease(commandId, agent._id, body.leaseToken);
  const submission = await repository.findById(submissionId);
  if (!submission) throw notFound('Submission not found');

  const updated = await repository.updateById(submissionId, {
    status: amazonTrackingSubmissionStatuses.WAITING_AMAZON,
  });

  // Put command in WAITING_AMAZON state so lease expiration does not kill it while waiting for Amazon feed
  await extensionCommandRepository.updateClaimed({
    commandId,
    agentId: agent._id,
    leaseTokenHash: hashString(body.leaseToken),
    statuses: [extensionCommandStatuses.CLAIMED, extensionCommandStatuses.RUNNING, extensionCommandStatuses.WAITING_AMAZON],
    patch: { status: extensionCommandStatuses.WAITING_AMAZON, leaseExpiresAt: null },
  });

  return toSubmissionDto(updated);
}

async function recordAmazonBatch(commandId, submissionId, body, authContext) {
  const agent = await assertExtensionAgent(authContext, body.clientId);
  await validateCommandLease(commandId, agent._id, body.leaseToken);
  const submission = await repository.findById(submissionId);
  if (!submission) throw notFound('Submission not found');

  const updated = await repository.updateById(submissionId, {
    amazonBatchId: body.amazonBatchId,
  });
  return toSubmissionDto(updated);
}

async function markTerminal(commandId, submissionId, body, authContext) {
  const agent = await assertExtensionAgent(authContext, body.clientId);
  await validateCommandLease(commandId, agent._id, body.leaseToken);
  const submission = await repository.findById(submissionId);
  if (!submission) throw notFound('Submission not found');

  const now = new Date();
  const isSuccess = body.status === 'SUCCEEDED';
  const finalStatus = isSuccess ? amazonTrackingSubmissionStatuses.SUCCEEDED : amazonTrackingSubmissionStatuses.FAILED;

  const updated = await repository.updateById(submissionId, {
    status: finalStatus,
    completedAt: now,
    result: body.result || { importedCount: isSuccess ? submission.rowCount : 0, failedCount: isSuccess ? 0 : submission.rowCount },
    errorMessage: isSuccess ? null : (body.result?.diagnostics?.[0] || 'Amazon tracking upload failed'),
  });

  // Update command status and release activeOrderKey
  await extensionCommandRepository.updateClaimed({
    commandId,
    agentId: agent._id,
    leaseTokenHash: hashString(body.leaseToken),
    statuses: [extensionCommandStatuses.CLAIMED, extensionCommandStatuses.RUNNING, extensionCommandStatuses.WAITING_AMAZON],
    patch: {
      status: isSuccess ? extensionCommandStatuses.SUCCEEDED : extensionCommandStatuses.FAILED,
      completedAt: now,
      leaseExpiresAt: null,
      result: {
        importedCount: isSuccess ? submission.rowCount : 0,
        failedCount: isSuccess ? 0 : submission.rowCount,
      },
    },
    unset: { activeOrderKey: 1 },
  });

  // Update shipments
  await shipmentPublic.updateMarketplaceConfirmation(submission.shipmentIds, {
    status: isSuccess ? 'CONFIRMED' : 'FAILED',
    confirmedAt: isSuccess ? now : undefined,
  });

  return toSubmissionDto(updated);
}

async function listSubmissions(query, authContext) {
  const shopIds = authPublic.listAccessibleScopeIds(authContext, 'ORDERS:READ', 'shop');
  return repository.listSubmissions({ shopIds, page: query.page, limit: query.limit });
}

async function getSubmission(submissionId, authContext) {
  const submission = await repository.findById(submissionId);
  if (!submission) throw notFound('Submission not found');
  assertUserShopAccess(authContext, submission.shopId, 'ORDERS:READ');
  return toSubmissionDetailDto(submission);
}

async function failSubmissionByCommandId(commandId, errorMessage) {
  const submission = await repository.findByCommandId(commandId);
  if (!submission) return;
  await repository.updateById(submission._id, {
    status: amazonTrackingSubmissionStatuses.FAILED,
    completedAt: new Date(),
    errorMessage: errorMessage || 'Amazon tracking upload failed',
  });
  if (submission.shipmentIds && submission.shipmentIds.length) {
    await shipmentPublic.updateMarketplaceConfirmation(submission.shipmentIds, {
      status: 'FAILED',
    });
  }
}

module.exports = {
  createSubmission,
  failSubmissionByCommandId,
  getLeasedPayload,
  markSubmitted,
  markWaiting,
  recordAmazonBatch,
  markTerminal,
  listSubmissions,
  getSubmission,
};
