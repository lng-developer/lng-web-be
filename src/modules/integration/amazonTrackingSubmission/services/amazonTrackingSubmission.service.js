const crypto = require('crypto');
const AppError = require('../../../../shared/errors/appError');
const httpStatus = require('../../../../shared/constants/httpStatus');
const errorCodes = require('../../../../shared/constants/errorCodes');
const shipmentPublic = require('../../../shipment/public');
const orderPublic = require('../../../order/public');
const repository = require('../repositories/amazonTrackingSubmission.repository');

const fail = (message, status = httpStatus.BAD_REQUEST) => new AppError(message, status, true, status === httpStatus.CONFLICT ? errorCodes.CONFLICT_ERROR : errorCodes.VALIDATION_ERROR);
const amazonCarrierCodes = new Set('4PX|A-1|AAA Cooper|ABF|Asendia|Best Buy|Blue Package|Cainiao|Canada Post|CEVA|China Post|Conway|CyberSavings|DHL|DHL eCommerce|Estes|FedEx|Fedex Freight|FedEx SmartPost|First Mile|Hongkong Post|Hunter Logistics|India Post|JCEX|LANDMARK|Lasership|Letian|Newgistics|Old Dominion|OnTrac|OSM|Pilot Freight|PTT Kargo|R+L|Roadrunner|Royal Mail|Saia|SF Express|SFC|ShipEntegra|South Eastern Freight Lines|StreamLite|UPS|UPS Freight|UPS Mail Innovations|Urban Express|USPS|Watkins and Shepard|XPO Freight|Yanwen|Yellow Freight|YF Logistics|YHT|Yun Express|Canpar Express|Desertcart|ECMS Express, Inc.|ESI Delivery Service|GlobalPost|GLS US,iMile|JD LOGISTICS|Jiehang|Metropolitan Warehouse and Delivery|Meyer Logistics|Pandion|Pitt Ohio|Roadie|Shanghai Shouwu|TForce Logistics|The Delivery Group|UniUni|ROADIE'.split('|'));
function amazonUsDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw fail('Shipment is missing a vendor-confirmed ship date');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}-${parts.find((part) => part.type === 'day').value}`;
}

async function buildSnapshot({ shopId, shipmentIds }) {
  const shipments = await shipmentPublic.listTrackingCandidatesByIds(shipmentIds);
  if (shipments.length !== shipmentIds.length || shipments.some((shipment) => !shipment)) throw fail('Shipment not found', httpStatus.NOT_FOUND);
  const rows = await Promise.all(shipments.map(async (shipment) => {
    if (String(shipment.shopId) !== String(shopId) || !['SHIPPED', 'DELIVERED'].includes(shipment.status) || !shipment.carrier || !shipment.trackingNumber || !shipment.vendorShippedAt) throw fail('Shipment is not eligible for Amazon tracking');
    if (!amazonCarrierCodes.has(shipment.carrier)) throw fail('Shipment carrier is not an Amazon carrier code');
    const item = await orderPublic.findItemById(shipment.orderItemId);
    if (item?.salesChannelCode !== 'AMAZON') throw fail('Shipment is not an Amazon shipment');
    return [shipment.externalOrderId || item.externalOrderId, amazonUsDate(shipment.vendorShippedAt), shipment.carrier, shipment.trackingNumber, 'Standard'].join('\t');
  }));
  const tsv = `order-id\tship-date\tcarrier-code\ttracking-number\tship-method\r\n${rows.join('\r\n')}\r\n`;
  return { tsv, rowCount: rows.length, checksum: crypto.createHash('sha256').update(tsv).digest('hex'), filename: `amazon-tracking-${Date.now()}.tsv` };
}

async function createSubmission(input) {
  if (await repository.findNonTerminalByShipmentIds(input.shipmentIds)) throw fail('A shipment is already in an active tracking submission', httpStatus.CONFLICT);
  const submission = await repository.create({ ...input, ...(input.snapshot || await buildSnapshot(input)) });
  const { tsv, ...result } = submission;
  return result;
}
async function getLeasedPayload({ command, submissionId = null }) {
  const submission = await repository.findByCommandId(command._id || command.id);
  if (!submission || (submissionId && String(submission._id) !== String(submissionId)) || String(submission.shopId) !== String(command.shopId) || String(submission.agentId) !== String(command.agentId)) throw fail('Tracking submission not found', httpStatus.NOT_FOUND);
  return { submissionId: String(submission._id), filename: submission.filename, tsv: submission.tsv, rowCount: submission.rowCount, checksum: submission.checksum };
}
async function markTerminal({ submissionId, status, result = {} }) {
  if (!['SUCCEEDED', 'FAILED'].includes(status)) throw fail('Invalid terminal submission status');
  const submission = await repository.findById(submissionId);
  if (!submission) throw fail('Tracking submission not found', httpStatus.NOT_FOUND);
  if (!['SUBMITTED', 'WAITING_AMAZON'].includes(submission.status)) throw fail('Amazon acknowledgement is required before completion', httpStatus.CONFLICT);
  return repository.updateById(submissionId, { status, result: { importedCount: result.importedCount || 0, failedCount: result.failedCount || 0, diagnostics: (result.diagnostics || []).slice(0, 20) } });
}
async function transition(submissionId, from, to) {
  const submission = await repository.findById(submissionId);
  if (!submission) throw fail('Tracking submission not found', httpStatus.NOT_FOUND);
  if (submission.status !== from) throw fail(`Tracking submission is not ${from}`, httpStatus.CONFLICT);
  return repository.updateById(submissionId, { status: to });
}
function markSubmitted({ submissionId }) { return transition(submissionId, 'QUEUED', 'SUBMITTED'); }
function markWaiting({ submissionId }) { return transition(submissionId, 'SUBMITTED', 'WAITING_AMAZON'); }
async function recordAmazonBatch({ submissionId, amazonBatchId }) {
  const submission = await repository.findById(submissionId);
  if (!submission) throw fail('Tracking submission not found', httpStatus.NOT_FOUND);
  if (!['SUBMITTED', 'WAITING_AMAZON'].includes(submission.status)) throw fail('Amazon acknowledgement is required before recording a batch', httpStatus.CONFLICT);
  return repository.updateById(submissionId, { amazonBatchId });
}
module.exports = { buildSnapshot, createSubmission, getLeasedPayload, markSubmitted, markWaiting, recordAmazonBatch, markTerminal };
