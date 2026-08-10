const mongoose = require('mongoose');
const config = require('../../../config');
const { createQueue } = require('../../../config/queue');
const { getRedisClient } = require('../../../config/redis');

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
    modules: modules.map((module) => ({ ...module, status: 'ok' })),
    workers: getWorkerHealth(redis),
    queues,
  };
}

module.exports = { getHealth };
