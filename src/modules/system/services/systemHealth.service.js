const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const config = require('../../../config');
const { createQueue } = require('../../../config/queue');
const { getRedisClient } = require('../../../config/redis');
const socketMetrics = require('../../../realtime/socketMetrics');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');

const modules = [
  { key: 'auth', name: 'Auth & RBAC Engine', endpoint: '/api/auth/health' },
  { key: 'shop', name: 'Shop Aggregate Root', endpoint: '/api/shops/health' },
  { key: 'catalog', name: 'Catalog & Metadata', endpoint: '/api/catalog/health' },
  { key: 'vendor', name: 'Vendor Master & SLA', endpoint: '/api/vendors/health' },
  { key: 'order', name: 'Order & Items Lifecycle', endpoint: '/api/orders/health' },
  { key: 'customization', name: 'Customization Handoff', endpoint: '/api/customizations/health' },
  { key: 'mapping', name: '5-Stage Mapping Engine', endpoint: '/api/mapping/health' },
  { key: 'production', name: 'Production Workflow & QC', endpoint: '/api/production/health' },
  { key: 'shipment', name: 'FBM Shipment & Carrier', endpoint: '/api/shipments/health' },
  { key: 'finance', name: 'Finance & Reconciliation', endpoint: '/api/finance/health' },
  { key: 'report', name: 'Read Models & Analytics', endpoint: '/api/reports/health' },
  { key: 'workScore', name: 'Work Score Evaluation', endpoint: '/api/work-scores/health' },
  { key: 'media', name: 'Media Assets & Artwork', endpoint: '/api/media/health' },
  { key: 'audit', name: 'Immutable Audit Evidence', endpoint: '/api/audit/health' },
  { key: 'design', name: 'Design Workflow', endpoint: '/api/design/health' },
  { key: 'integration', name: 'External Integrations', endpoint: '/api/integration/health' },
  { key: 'organization', name: 'Organization Structure', endpoint: '/api/organization/health' },
  { key: 'hr', name: 'HR Operations', endpoint: '/api/hr/health' },
  { key: 'notification', name: 'Notifications', endpoint: '/api/notifications/health' },
  { key: 'vendorSubmission', name: 'Vendor Submission', endpoint: '/api/vendor-submissions/health' },
];

const queueDefinitions = [
  {
    key: 'externalOrderImport',
    name: 'External Order Import',
    queueName: 'external-order-import',
    worker: 'externalOrderImport',
  },
  {
    key: 'externalOrderPostImport',
    name: 'Post-import Mapping',
    queueName: 'external-order-post-import',
    worker: 'externalOrderPostImport',
  },
  {
    key: 'externalOrderCustomizationAssets',
    name: 'Customization Assets',
    queueName: 'external-order-customization-assets',
    worker: 'externalOrderCustomizationAssets',
  },
  {
    key: 'sqlAttendance',
    name: 'SQL Attendance Sync',
    queueName: 'sql-attendance',
    worker: 'sqlAttendance',
  },
  {
    key: 'hrAnnouncements',
    name: 'HR Announcements',
    queueName: 'hr-announcements',
    worker: 'hrAnnouncements',
  },
  {
    key: 'payrollEmail',
    name: 'Payroll Email',
    queueName: 'hr-payroll-email',
    worker: 'payrollEmail',
  },
];

const workerDefinitions = [
  {
    key: 'externalOrderImport',
    name: 'External Order Import Worker',
    process: 'embedded-api',
    queueName: 'external-order-import',
    enabledWhenRedis: true,
  },
  {
    key: 'externalOrderPostImport',
    name: 'Post-import Mapping Worker',
    process: 'embedded-api',
    queueName: 'external-order-post-import',
    enabledWhenRedis: true,
  },
  {
    key: 'externalOrderCustomizationAssets',
    name: 'Customization Asset Worker',
    process: 'embedded-api',
    queueName: 'external-order-customization-assets',
    enabledWhenRedis: true,
  },
  {
    key: 'sqlAttendance',
    name: 'SQL Attendance Worker',
    process: 'pm2-separate',
    queueName: 'sql-attendance',
    script: 'worker:sql-attendance',
  },
  {
    key: 'hrAnnouncements',
    name: 'HR Announcement Worker',
    process: 'pm2-separate',
    queueName: 'hr-announcements',
    script: 'worker:hr-announcements',
  },
  {
    key: 'payrollEmail',
    name: 'Payroll Email Worker',
    process: 'pm2-separate',
    queueName: 'hr-payroll-email',
    script: 'worker:payroll-email',
  },
  {
    key: 'vendorSubmissionRecovery',
    name: 'Vendor Submission Recovery',
    process: 'embedded-api',
    queueName: null,
    status: 'running',
  },
  {
    key: 'vendorTrackingRecheck',
    name: 'Vendor Tracking Recheck',
    process: 'embedded-api',
    queueName: null,
    status: 'running',
  },
];
const logProcesses = Object.freeze({
  'lng-web-be': { label: 'Backend API', filePrefix: 'lng-web-be' },
  'lng-web-be-import-workers': {
    label: 'Import Workers',
    filePrefix: 'lng-web-be-import-workers',
  },
  'lng-web-be-dev-tunnel': { label: 'Dev Tunnel', filePrefix: 'lng-web-be-dev-tunnel' },
});
const logStreams = new Set(['out', 'error']);
const defaultLogDir = process.env.PM2_LOG_DIR || path.join(process.env.HOME || process.cwd(), '.pm2', 'logs');

function redisStatus() {
  if (!config.redis.enabled) return 'DISABLED';
  return getRedisClient().status === 'ready' ? 'CONNECTED' : 'DISCONNECTED';
}

async function getQueueHealth(redis) {
  if (redis !== 'CONNECTED') {
    return queueDefinitions.map((queue) => ({
      ...queue,
      status: 'disabled',
      counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0, paused: 0 },
    }));
  }

  return Promise.all(queueDefinitions.map(async (definition) => {
    const queue = createQueue(definition.queueName);
    try {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused');
      return {
        ...definition,
        status: counts.failed > 0 ? 'degraded' : 'ok',
        counts,
      };
    } catch (error) {
      return {
        ...definition,
        status: 'error',
        counts: { waiting: 0, active: 0, delayed: 0, completed: 0, failed: 0, paused: 0 },
        error: error.message,
      };
    } finally {
      await queue.close();
    }
  }));
}

function getWorkerHealth(redis) {
  return workerDefinitions.map((worker) => {
    if (worker.status) return worker;
    if (worker.process === 'embedded-api') {
      return { ...worker, status: redis === 'CONNECTED' ? 'running' : 'disabled' };
    }
    return { ...worker, status: 'external' };
  });
}

async function getHealth() {
  const memory = process.memoryUsage();
  const mongoStatus = mongoose.connection.readyState === 1 ? 'CONNECTED' : 'DISCONNECTED';
  const redis = redisStatus();
  const queues = await getQueueHealth(redis);

  return {
    status: mongoStatus === 'CONNECTED' && redis !== 'DISCONNECTED' ? 'ok' : 'degraded',
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    nodeVersion: process.version,
    memory: {
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      rssMb: Math.round(memory.rss / 1024 / 1024),
    },
    infrastructure: {
      mongo: mongoStatus,
      redis,
      metrics: config.metrics.enabled ? 'ENABLED' : 'DISABLED',
    },
    realtime: socketMetrics.getHealth(),
    modules: modules.map((module) => ({ ...module, status: 'ok' })),
    workers: getWorkerHealth(redis),
    queues,
  };
}

function validationError(message) {
  return new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
}

function normalizeLogQuery(query = {}) {
  const processName = String(query.process || 'lng-web-be').trim();
  const stream = String(query.stream || 'out').trim();
  const lines = Number(query.lines || 200);

  if (!logProcesses[processName]) throw validationError('Unsupported log process');
  if (!logStreams.has(stream)) throw validationError('Unsupported log stream');
  if (!Number.isSafeInteger(lines) || lines < 1 || lines > 500) {
    throw validationError('lines must be between 1 and 500');
  }

  return { process: processName, stream, lines };
}

function redactLogLine(line) {
  return String(line)
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/((?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

async function readTail(filePath, lines) {
  try {
    const stat = await fs.promises.stat(filePath);
    const bytes = Math.min(stat.size, 256 * 1024);
    const handle = await fs.promises.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      await handle.read(buffer, 0, bytes, stat.size - bytes);
      return buffer.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-lines).map(redactLogLine);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function getLogs(query = {}, options = {}) {
  const normalized = normalizeLogQuery(query);
  const definition = logProcesses[normalized.process];
  const logDir = options.logDir || defaultLogDir;
  const filename = `${definition.filePrefix}-${normalized.stream}.log`;
  const filePath = path.join(logDir, filename);
  const content = await readTail(filePath, normalized.lines);

  return {
    ...normalized,
    filename,
    content,
    availableProcesses: Object.entries(logProcesses).map(([key, value]) => ({
      key,
      label: value.label,
    })),
    availableStreams: [...logStreams],
  };
}

module.exports = { getHealth, getLogs };
