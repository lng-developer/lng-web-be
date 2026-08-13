process.env.REDIS_ENABLED = 'false';
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

if (!process.env.MONGODB_URI || !process.env.TEST_DB_NAME) {
  process.env.TEST_DB_NAME = 'lng_web_be_test';
}

const configuredDbName = process.env.TEST_DB_NAME;
if (process.env.MONGODB_URI) {
  const rawUri = process.env.MONGODB_URI;
  const [withoutQuery, query = ''] = rawUri.split('?');
  const question = query ? `?${query}` : '';
  const lastSlash = withoutQuery.lastIndexOf('/');
  const base = lastSlash >= 0
    ? withoutQuery.slice(0, lastSlash + 1)
    : `${withoutQuery}/`;
  process.env.MONGODB_URI = `${base}${configuredDbName}${question}`;
} else {
  process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${configuredDbName}`;
}
