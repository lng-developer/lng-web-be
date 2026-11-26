const crypto = require('crypto');
const httpStatus = require('../../../../shared/constants/httpStatus');
const errorCodes = require('../../../../shared/constants/errorCodes');
const AppError = require('../../../../shared/errors/appError');
const { assertValidObjectId } = require('../../../../shared/utils/objectId');
const authPublic = require('../../../auth/public');
const shipmentPublic = require('../../../shipment/public');
const orderPublic = require('../../../order/public');
const repository = require('../repositories/amazonTrackingSubmission.repository');
const extensionCommandRepository = require('../../extensionCommand/repositories/extensionCommand.repository');
const { extensionCommandTypes, extensionCommandStatuses } = require('../../extensionCommand/constants/extensionCommand.constants');
const { amazonTrackingSubmissionStatuses, normalizeCarrierCode } = require('../constants/amazonTrackingSubmission.constants');
const { toSubmissionDto, toSubmissionDetailDto, toLeasedPayloadDto, toPreviewDto } = require('../dtos/amazonTrackingSubmission.dto');

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

function formatDate(dateInput, now = new Date()) {
  const nowDate = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const nowIsoDate = nowDate.toISOString().split('T')[0];

  if (!dateInput) return nowIsoDate;
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return nowIsoDate;

  const targetIsoDate = d.toISOString().split('T')[0];
  if (targetIsoDate > nowIsoDate) {
    return nowIsoDate;
  }
  return targetIsoDate;
}

function buildTsvFeed(feedRows) {
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
  const tsvLines = feedRows.map((r) => [
    r.externalOrderId || '',
    r.externalItemId || '',
    r.quantity || '',
    r.shipDate || '',
    r.carrierCode || '',
    r.carrierCode === 'Other' ? (r.carrier || 'Other') : '',
    r.trackingNumber || '',
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
  return { tsv, checksum, filename };
}

async function prepareFeedRows(shipments, { shopId, strict = false } = {}) {
  const orderItemIds = [...new Set(shipments.map((s) => s.orderItemId).filter(Boolean).map(String))];
  const orderItems = orderItemIds.length ? await orderPublic.findItemsByIds(orderItemIds) : [];
  const orderItemById = new Map(orderItems.map((i) => [String(i._id || i.id), i]));

  const normalizedList = await Promise.all(
    shipments.map(async (shipment) => {
      if (!shipment.trackingNumber || !shipment.carrier) return null;
      if (typeof shipmentPublic.normalizeTrackingForAmazon !== 'function') return null;
      try {
        return await shipmentPublic.normalizeTrackingForAmazon({
          trackingNumber: shipment.trackingNumber,
          carrier: shipment.carrier,
          provider: shipment.provider,
          shippedAt: shipment.shippedAt,
        });
      } catch (_err) {
        return null;
      }
    })
  );

  const validRows = [];
  const validShipmentIds = [];
  const skippedRows = [];

  for (let idx = 0; idx < shipments.length; idx++) {
    const shipment = shipments[idx];
    const normalized = normalizedList[idx];

    const isWrongShop = Boolean(shopId && String(shipment.shopId) !== String(shopId));
    const isNotShipped = shipment.status !== 'SHIPPED';
    const isMissingDetails = !shipment.externalOrderId || !shipment.carrier || !shipment.trackingNumber || !shipment.shippedAt;

    if (strict) {
      if (isWrongShop) throw badRequest(`Shipment ${shipment._id} does not belong to shop ${shopId}`);
      if (isNotShipped) throw badRequest(`Shipment ${shipment._id} is not in SHIPPED status`);
      if (isMissingDetails) throw badRequest(`Shipment ${shipment._id} is missing tracking details (carrier, trackingNumber, or shippedAt)`);
    }

    const issues = [];
    if (isWrongShop) issues.push('wrong_shop');
    if (isNotShipped) issues.push('not_shipped');
    if (!shipment.externalOrderId) issues.push('missing_order_id');
    if (!shipment.carrier) issues.push('missing_carrier');
    if (!shipment.trackingNumber) issues.push('missing_tracking_number');
    if (!shipment.shippedAt) issues.push('missing_shipped_at');

    const shipDate = normalized?.shipDate || formatDate(shipment.shippedAt);
    const resolvedCarrier = normalized?.carrier || shipment.carrier || 'Other';
    const carrierCode = normalized?.carrierCode || normalizeCarrierCode(resolvedCarrier);
    let shipMethod = normalized?.shipMethod || 'Standard';
    if (carrierCode === 'USPS' && shipMethod === 'Standard') {
      shipMethod = 'USPS First Class';
    } else if (carrierCode === 'UPS' && shipMethod === 'Standard') {
      shipMethod = 'UPS Ground';
    } else if (carrierCode === 'FedEx' && shipMethod === 'Standard') {
      shipMethod = 'FedEx Ground';
    }

    const carrierName = carrierCode === 'Other' ? (resolvedCarrier || 'Other') : '';
    const item = shipment.orderItemId ? orderItemById.get(String(shipment.orderItemId)) : null;

    const row = {
      shipmentId: shipment._id,
      orderId: shipment.orderId || null,
      orderItemId: shipment.orderItemId || null,
      externalOrderId: shipment.externalOrderId || '',
      externalItemId: item?.externalItemId || null,
      quantity: item?.quantity || null,
      shipDate,
      carrier: resolvedCarrier,
      carrierCode,
      carrierName,
      trackingNumber: normalized?.trackingNumber || shipment.trackingNumber || '',
      shipMethod,
      marketplaceConfirmationStatus: shipment.marketplaceConfirmationStatus || 'PENDING',
      marketplaceConfirmedAt: shipment.marketplaceConfirmedAt || null,
      isReady: issues.length === 0,
      issues,
    };

    if (issues.length === 0) {
      validRows.push(row);
      validShipmentIds.push(shipment._id);
    } else {
      skippedRows.push(row);
    }
  }

  // Group validRows by externalOrderId
  const rowsByOrder = new Map();
  for (const row of validRows) {
    const key = row.externalOrderId || String(row.shipmentId);
    if (!rowsByOrder.has(key)) rowsByOrder.set(key, []);
    rowsByOrder.get(key).push(row);
  }

  const feedRows = [];
  for (const [, orderRows] of rowsByOrder) {
    const trackingNumbers = new Set(orderRows.map((r) => r.trackingNumber));
    const allConfirmed = orderRows.every((r) => r.marketplaceConfirmationStatus === 'CONFIRMED');
    const hasSubmitted = orderRows.some((r) => r.marketplaceConfirmationStatus === 'SUBMITTED');
    const groupStatus = allConfirmed ? 'CONFIRMED' : hasSubmitted ? 'SUBMITTED' : (orderRows[0].marketplaceConfirmationStatus || 'PENDING');

    if (trackingNumbers.size === 1) {
      feedRows.push({
        ...orderRows[0],
        itemCount: orderRows.length,
        shipmentIds: orderRows.map((r) => r.shipmentId),
        externalItemId: '',
        quantity: '',
        marketplaceConfirmationStatus: groupStatus,
        marketplaceConfirmedAt: orderRows[0].marketplaceConfirmedAt || null,
      });
    } else {
      for (const r of orderRows) {
        feedRows.push({
          ...r,
          itemCount: 1,
          shipmentIds: [r.shipmentId],
          externalItemId: r.externalItemId || '',
          quantity: r.quantity ? String(r.quantity) : '1',
        });
      }
    }
  }

  const allDisplayRows = [...feedRows];
  for (const skipped of skippedRows) {
    allDisplayRows.push({
      ...skipped,
      itemCount: 1,
      shipmentIds: [skipped.shipmentId],
      externalItemId: skipped.externalItemId || '',
      quantity: skipped.quantity ? String(skipped.quantity) : '',
    });
  }

  return {
    validRows,
    validShipmentIds,
    feedRows,
    allDisplayRows,
  };
}

async function createManualDraft(payload = {}, authContext) {
  assertValidObjectId(payload.shopId, 'shopId');
  assertUserShopAccess(authContext, payload.shopId, 'ORDERS:WRITE');
  const ids = payload.shipmentIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids.map(String)).size !== ids.length) {
    throw badRequest('Provide 1 to 200 unique shipment IDs');
  }
  ids.forEach(id => assertValidObjectId(id, 'shipmentId'));
  const shipments = await shipmentPublic.findByIds(ids);
  if (shipments.length !== ids.length) throw badRequest('Some requested shipments were not found');
  const { validRows, validShipmentIds } = await prepareFeedRows(shipments, { shopId: payload.shopId, strict: true });
  if (!validRows.length || validRows.length !== ids.length) throw badRequest('Every requested shipment must produce a valid feed row');
  const itemKeys = new Set();
  for (const row of validRows) {
    if (!/^\d{3}-\d{7}-\d{7}$/.test(row.externalOrderId)) throw badRequest('An Amazon order ID is required');
    if (!/^\d+$/.test(row.externalItemId || '') || !Number.isInteger(Number(row.quantity)) || Number(row.quantity) < 1) {
      throw badRequest('Order item ID and positive quantity are required for manual drafts');
    }
    const key = `${row.externalOrderId}:${row.externalItemId}`;
    if (itemKeys.has(key)) throw badRequest('Duplicate order item in manual draft');
    itemKeys.add(key);
    if ([row.carrier, row.carrierCode, row.trackingNumber, row.shipMethod].some(value => /[\t\r\n]/.test(value))) {
      throw badRequest('Tracking feed fields cannot contain tabs or newlines');
    }
  }
  // Item-specific rows avoid replacing tracking for unselected items on the same order.
  validRows.sort((a, b) => `${a.externalOrderId}:${a.externalItemId}`.localeCompare(`${b.externalOrderId}:${b.externalItemId}`));
  const { tsv, checksum, filename } = buildTsvFeed(validRows);
  const existing = await repository.findDraftByChecksum(payload.shopId, checksum);
  if (existing) return toSubmissionDto(existing);
  return toSubmissionDto(await repository.create({
    shopId: payload.shopId,
    agentId: null,
    commandId: null,
    shipmentIds: validShipmentIds,
    rows: validRows,
    filename,
    tsv,
    checksum,
    rowCount: validRows.length,
    status: amazonTrackingSubmissionStatuses.DRAFT,
  }));
}

async function createSubmission(payload, authContext) {
  assertUserShopAccess(authContext, payload.shopId, 'ORDERS:WRITE');

  const agent = await extensionCommandRepository.findAgentById(payload.agentId);
  if (!agent) throw notFound('Extension agent not found');
  if (String(agent.shopId) !== String(payload.shopId)) throw badRequest('Agent does not belong to the selected shop');

  const shipments = await shipmentPublic.findByIds(payload.shipmentIds);
  if (!shipments.length) throw notFound('No shipments found');

  const { validRows, validShipmentIds, feedRows } = await prepareFeedRows(shipments, {
    shopId: payload.shopId,
    strict: true,
  });

  const { tsv, checksum, filename } = buildTsvFeed(feedRows);

  // Create submission record
  const submission = await repository.create({
    shopId: payload.shopId,
    agentId: payload.agentId,
    shipmentIds: validShipmentIds,
    rows: validRows,
    filename,
    tsv,
    rowCount: feedRows.length,
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

async function previewSubmission(payload, authContext) {
  assertUserShopAccess(authContext, payload.shopId, 'ORDERS:READ');

  let shipments = [];
  if (Array.isArray(payload.shipmentIds) && payload.shipmentIds.length > 0) {
    shipments = await shipmentPublic.findByIds(payload.shipmentIds);
  } else if (typeof shipmentPublic.findShippedByShop === 'function') {
    shipments = await shipmentPublic.findShippedByShop(payload.shopId, { limit: 200 });
  } else if (typeof shipmentPublic.findReadyForMarketplaceUpload === 'function') {
    shipments = await shipmentPublic.findReadyForMarketplaceUpload(payload.shopId, { limit: 200 });
  }

  if (!shipments.length) {
    return toPreviewDto({
      items: [],
      tsv: '',
      rowCount: 0,
      summary: {
        totalOrders: 0,
        totalShipments: 0,
        readyOrders: 0,
        readyShipments: 0,
        confirmedOrders: 0,
        pendingOrders: 0,
      },
    });
  }

  const { feedRows, allDisplayRows } = await prepareFeedRows(shipments, {
    shopId: payload.shopId,
    strict: false,
  });

  const readyFeedRows = feedRows.filter(
    (r) => r.isReady && r.marketplaceConfirmationStatus !== 'CONFIRMED' && r.marketplaceConfirmationStatus !== 'SUBMITTED'
  );
  const { tsv } = buildTsvFeed(readyFeedRows);

  const totalOrders = new Set(allDisplayRows.map((r) => r.externalOrderId).filter(Boolean)).size;
  const readyOrders = new Set(
    readyFeedRows.map((r) => r.externalOrderId).filter(Boolean)
  ).size;
  const confirmedOrders = new Set(
    allDisplayRows.filter((r) => r.marketplaceConfirmationStatus === 'CONFIRMED').map((r) => r.externalOrderId).filter(Boolean)
  ).size;

  return toPreviewDto({
    items: allDisplayRows,
    tsv,
    rowCount: readyFeedRows.length,
    summary: {
      totalOrders,
      totalShipments: shipments.length,
      readyOrders,
      readyShipments: readyFeedRows.length,
      confirmedOrders,
      pendingOrders: Math.max(0, totalOrders - confirmedOrders),
    },
  });
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

function canReadSubmission(authContext, scope) {
  if (authContext?.tokenType === 'EXTENSION') return false;
  return authContext?.system || ['ORDERS:READ', 'ORDERS:WRITE', 'SHIPMENTS:READ', 'SHIPMENTS:WRITE']
    .some((permission) => authPublic.canAccessScope(authContext, permission, scope));
}

async function listSubmissions(query, authContext) {
  let shopIds;
  if (query.shopId) {
    if (!canReadSubmission(authContext, { scopeType: 'shop', scopeId: query.shopId })) throw forbidden();
    shopIds = [query.shopId];
  } else if (!canReadSubmission(authContext, { scopeType: 'global', scopeId: null })) {
    shopIds = [...new Set((authContext?.scopes || [])
      .filter((scope) => scope.scopeType === 'shop' && scope.scopeId && canReadSubmission(authContext, scope))
      .map((scope) => String(scope.scopeId)))];
    if (!shopIds.length) return { items: [], total: 0, page: query.page, limit: query.limit };
  }
  const result = await repository.listSubmissions({ shopIds, page: query.page, limit: query.limit });
  return { ...result, items: result.items.map(toSubmissionDto) };
}

async function getSubmission(submissionId, authContext) {
  const submission = await repository.findById(submissionId);
  if (!submission) throw notFound('Submission not found');
  if (!canReadSubmission(authContext, { scopeType: 'shop', scopeId: String(submission.shopId) })) throw forbidden();
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
  createManualDraft,
  createSubmission,
  previewSubmission,
  failSubmissionByCommandId,
  getLeasedPayload,
  markSubmitted,
  markWaiting,
  recordAmazonBatch,
  markTerminal,
  listSubmissions,
  getSubmission,
};
