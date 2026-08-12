const fs = require('fs');
const os = require('os');
const path = require('path');

const service = require('../../src/modules/system/services/systemHealth.service');

describe('system log service', () => {
  let logDir;

  beforeEach(() => {
    logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lng-system-logs-'));
  });

  afterEach(() => {
    fs.rmSync(logDir, { recursive: true, force: true });
  });

  test('reads whitelisted pm2 logs and redacts secrets', async () => {
    fs.writeFileSync(path.join(logDir, 'lng-web-be-out.log'), [
      'first line',
      'Authorization: Bearer secret-token',
      'password=my-secret',
      'last line',
    ].join('\n'));

    const result = await service.getLogs({ process: 'lng-web-be', stream: 'out', lines: 3 }, { logDir });

    expect(result).toMatchObject({
      process: 'lng-web-be',
      stream: 'out',
      lines: 3,
    });
    expect(result.content).toEqual([
      'Authorization: Bearer [REDACTED]',
      'password=[REDACTED]',
      'last line',
    ]);
  });

  test('rejects unknown process names instead of reading arbitrary paths', async () => {
    await expect(service.getLogs({ process: '../.env', stream: 'out', lines: 100 }, { logDir }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('returns empty content when the selected log file is missing', async () => {
    const result = await service.getLogs({ process: 'lng-web-be-import-workers', stream: 'error' }, { logDir });

    expect(result.content).toEqual([]);
    expect(result.availableProcesses.map((item) => item.key)).toContain('lng-web-be');
  });
});
