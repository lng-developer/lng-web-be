const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const defaults = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/lng-web-startup-smoke',
  CORS_ORIGIN: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'startup-smoke-secret',
  REDIS_ENABLED: 'false',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}

const createApp = require('../../../src/app');
const app = createApp();

if (!app || typeof app.listen !== 'function') {
  throw new Error('Application factory did not return an Express app');
}

process.stdout.write('startup smoke passed\n');
