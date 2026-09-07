const assert = require('assert');
const { performance } = require('perf_hooks');

function percentile(samples = [], value) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * value) - 1];
}

function summarize(samples = []) {
  return {
    count: samples.length,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
  };
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function readOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function validatePreflight({ baseUrl, token, listingId }) {
  if (!baseUrl) throw new Error('CATALOG_BENCHMARK_BASE_URL is required');
  if (!token) throw new Error('CATALOG_BENCHMARK_TOKEN is required');
  if (!listingId) throw new Error('CATALOG_BENCHMARK_LISTING_ID is required');
  const parsedUrl = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('CATALOG_BENCHMARK_BASE_URL must be HTTP(S)');
  return parsedUrl.toString().replace(/\/$/, '');
}

function scenarios(listingId) {
  return [
    { name: 'listing-options', paths: ['/api/catalog/listing-options'] },
    { name: 'listing-summary', paths: ['/api/catalog/listings/summary'] },
    { name: 'listing-page', paths: ['/api/catalog/listings?page=1&limit=20'] },
    { name: 'listing-variants', paths: [`/api/catalog/listings/${listingId}/variants`] },
    { name: 'dashboard-mix', paths: [
      '/api/catalog/listing-options',
      '/api/catalog/listings/summary',
      '/api/catalog/listings?page=1&limit=20',
      '/api/catalog/listings?page=1&limit=5&sort=quantitySoldDesc',
    ] },
  ];
}

async function request(baseUrl, token, path) {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    return { durationMs: performance.now() - startedAt, status: response.status };
  } catch (error) {
    return { durationMs: performance.now() - startedAt, status: null, error: error.message };
  }
}

async function runScenario({ scenario, baseUrl, token, concurrency, requestsPerUser }) {
  const requests = [];
  const worker = async () => {
    for (let index = 0; index < requestsPerUser; index += 1) {
      for (const path of scenario.paths) requests.push(await request(baseUrl, token, path));
    }
  };
  const startedAt = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedMs = performance.now() - startedAt;
  const successful = requests.filter((item) => item.status === 200);
  const failed = requests.filter((item) => item.status !== 200);

  return {
    name: scenario.name,
    requests: requests.length,
    successful: successful.length,
    failed: failed.length,
    requestsPerSecond: Math.round((requests.length / (elapsedMs / 1000)) * 100) / 100,
    latencyMs: summarize(successful.map((item) => Math.round(item.durationMs * 10) / 10)),
    errors: failed.slice(0, 10).map((item) => ({ status: item.status, error: item.error || null })),
  };
}

async function main({
  baseUrl = process.env.CATALOG_BENCHMARK_BASE_URL,
  token = process.env.CATALOG_BENCHMARK_TOKEN,
  listingId = process.env.CATALOG_BENCHMARK_LISTING_ID,
  concurrency = parsePositiveInteger(readOption('concurrency', '10'), 'concurrency'),
  requestsPerUser = parsePositiveInteger(readOption('requests-per-user', '20'), 'requests-per-user'),
  output = console.log,
} = {}) {
  const normalizedBaseUrl = validatePreflight({ baseUrl, token, listingId });
  const result = {
    concurrency,
    requestsPerUser,
    scenarios: [],
  };
  for (const scenario of scenarios(listingId)) {
    result.scenarios.push(await runScenario({
      scenario,
      baseUrl: normalizedBaseUrl,
      token,
      concurrency,
      requestsPerUser,
    }));
  }
  output(JSON.stringify(result, null, 2));
  return result;
}

function selfTest() {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
  assert.deepEqual(summarize([]), { count: 0, p50: null, p95: null, p99: null });
}

if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    selfTest();
  } else {
    main().catch((error) => {
      process.stderr.write(`${JSON.stringify({ error: error.message })}\n`);
      process.exitCode = 1;
    });
  }
}

module.exports = { main, percentile, selfTest, summarize };
