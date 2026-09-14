const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const config = require('../../../../config');
const financePublic = require('../../../finance/public');
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../../../../shared/utils/logger');

const EXPECTED_SENDER = 'no-reply@ads.amazon.com';
const EXPECTED_REPORT_NAME = 'LNG Daily Campaign Spend';
const AMAZON_ADS_EMAIL_REDIRECT_HOST = 'na.r.ads.amazon.com';

function isAmazonS3Url(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isAmazonAdsEmailRedirectUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === AMAZON_ADS_EMAIL_REDIRECT_HOST
      && url.pathname.startsWith('/CL0/');
  } catch {
    return false;
  }
}

function reportUrlFromHtml(html) {
  return (String(html || '').match(/https:\/\/[^\s"'<>]+/g) || [])
    .find((url) => isAmazonS3Url(url) || isAmazonAdsEmailRedirectUrl(url)) || null;
}

function isTrustedReport(message) {
  const sender = String(message.from?.value?.[0]?.address || '').trim().toLowerCase();
  return sender === EXPECTED_SENDER && String(message.subject || '').includes(EXPECTED_REPORT_NAME);
}

function createAmazonAdsEmailImportService(deps = {}) {
  const settings = deps.config || config.amazonAdsGmail;
  const createClient = deps.createClient || ((options) => new ImapFlow(options));
  const parseMail = deps.parseMail || simpleParser;
  const request = deps.fetch || global.fetch;
  const fileSystem = deps.fs || fs;
  const systemOs = deps.os || os;
  const systemPath = deps.path || path;
  const importMappedAdsFromFile = deps.importMappedAdsFromFile || financePublic.importMappedAdsFromFile;
  const appLogger = deps.logger || logger;

  async function processMessage(client, uid) {
    const fetched = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
    const messageId = String(fetched?.envelope?.messageId || '').trim();
    if (!messageId) return 'skipped';
    const sourceRef = `gmail:${messageId}`;
    const message = await parseMail(fetched.source);
    const url = isTrustedReport(message) ? reportUrlFromHtml(message.html || message.textAsHtml) : null;
    if (!url) {
      appLogger.info('amazon_ads_gmail_import_skipped', { uid, reason: 'unsupported_report_url' });
      return 'skipped';
    }

    const response = await request(url);
    if (!response?.ok) throw new Error('Amazon Ads report download failed');
    if (!isAmazonS3Url(response.url)) throw new Error('Amazon Ads report redirect did not finish at Amazon S3');
    const directory = await fileSystem.promises.mkdtemp(systemPath.join(systemOs.tmpdir(), 'amazon-ads-gmail-'));
    const filePath = systemPath.join(directory, 'amazon-ads-report.csv');
    try {
      await fileSystem.promises.writeFile(filePath, Buffer.from(await response.arrayBuffer()));
      const result = await importMappedAdsFromFile(
        { path: filePath, originalname: 'amazon-ads-report.csv', mimetype: 'text/csv' },
        {
          salesChannelCode: settings.salesChannelCode,
          marketplaceCode: settings.marketplaceCode,
          sourceRef,
        },
        { system: true, worker: true, source: 'AMAZON_ADS_GMAIL' },
      );
      if (!result.complete) return 'pending';
      await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      appLogger.info('amazon_ads_gmail_import_completed', { messageId });
      return 'imported';
    } finally {
      await fileSystem.promises.rm(directory, { recursive: true, force: true });
    }
  }

  async function runOnce() {
    const summary = { imported: 0, skipped: 0, pending: 0, failed: 0 };
    if (!settings.enabled) return summary;
    if (!settings.user || !settings.appPassword) {
      appLogger.warn('amazon_ads_gmail_import_not_configured');
      return summary;
    }

    const client = createClient({
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      auth: { user: settings.user, pass: settings.appPassword },
      logger: false,
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false, from: EXPECTED_SENDER }, { uid: true });
      for (const uid of uids) {
        try {
          const result = await processMessage(client, uid);
          summary[result] += 1;
        } catch (error) {
          summary.failed += 1;
          appLogger.warn('amazon_ads_gmail_import_failed', { uid, message: error.message });
        }
      }
      return summary;
    } finally {
      lock.release();
      await client.logout();
    }
  }

  return { runOnce };
}

const service = createAmazonAdsEmailImportService();

module.exports = { createAmazonAdsEmailImportService, isAmazonS3Url, reportUrlFromHtml, runOnce: service.runOnce };
