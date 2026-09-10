jest.mock('mongoose', () => ({
  connect: jest.fn(),
  disconnect: jest.fn(),
  model: jest.fn(),
  modelNames: jest.fn(),
  set: jest.fn(),
}));
jest.mock('../../src/config', () => ({ database: { uri: 'mongodb://test' }, env: 'test' }));

const mongoose = require('mongoose');
const { connectDatabase, initializeModels } = require('../../src/config/database');

describe('database startup', () => {
  test('bounds the Mongo connection pool used by the API process', async () => {
    await connectDatabase();

    expect(mongoose.connect).toHaveBeenCalledWith('mongodb://test', expect.objectContaining({
      maxPoolSize: 20,
      minPoolSize: 0,
    }));
  });

  test('waits for every registered model to initialize', async () => {
    let releaseSecond;
    const first = { init: jest.fn().mockResolvedValue() };
    const second = { init: jest.fn(() => new Promise((resolve) => { releaseSecond = resolve; })) };
    mongoose.modelNames.mockReturnValue(['First', 'Second']);
    mongoose.model.mockImplementation((name) => (name === 'First' ? first : second));

    let settled = false;
    const initializing = initializeModels().then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(first.init).toHaveBeenCalledTimes(1);
    expect(second.init).toHaveBeenCalledTimes(1);

    releaseSecond();
    await expect(initializing).resolves.toBe(2);
  });
});
