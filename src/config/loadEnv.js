const path = require('path');
const dotenv = require('dotenv');

const appEnv = process.env.APP_ENV || process.env.NODE_ENV || 'development';
if (!['development', 'production', 'test'].includes(appEnv)) {
  throw new Error('APP_ENV must be development, production or test');
}

// Tests use injected configuration; never inherit a developer's credentials.
if (appEnv !== 'test') {
  const envPath = path.resolve(process.cwd(), `.env.${appEnv}`);
  const result = dotenv.config({ path: envPath, quiet: true });
  if (result.error) throw new Error(`Cannot load ${envPath}`, { cause: result.error });
}
