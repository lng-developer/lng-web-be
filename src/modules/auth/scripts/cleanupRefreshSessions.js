const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const Account = require('../models/account.model');

const DEFAULT_MAX_SESSIONS = 50;

function parseArgs(argv = process.argv.slice(2)) {
  const args = { apply: false, max: DEFAULT_MAX_SESSIONS };

  for (const arg of argv) {
    if (arg === '--apply') args.apply = true;
    if (arg.startsWith('--max=')) args.max = Number(arg.slice('--max='.length));
  }

  if (!Number.isInteger(args.max) || args.max < 1) {
    throw new Error('--max must be a positive integer');
  }

  return args;
}

async function summarize(now, maxSessions) {
  const [summary = {}] = await Account.aggregate([
    {
      $project: {
        before: { $size: { $ifNull: ['$sessions', []] } },
        activeOrFuture: {
          $size: {
            $filter: {
              input: { $ifNull: ['$sessions', []] },
              as: 'session',
              cond: { $gt: ['$$session.expiresAt', now] },
            },
          },
        },
      },
    },
    {
      $project: {
        before: 1,
        expired: { $subtract: ['$before', '$activeOrFuture'] },
        after: { $min: ['$activeOrFuture', maxSessions] },
      },
    },
    {
      $group: {
        _id: null,
        accounts: { $sum: 1 },
        accountsWithSessions: { $sum: { $cond: [{ $gt: ['$before', 0] }, 1, 0] } },
        accountsTrimmed: { $sum: { $cond: [{ $gt: ['$before', '$after'] }, 1, 0] } },
        sessionsBefore: { $sum: '$before' },
        expiredSessions: { $sum: '$expired' },
        sessionsAfter: { $sum: '$after' },
      },
    },
  ]);

  const sessionsBefore = summary.sessionsBefore || 0;
  const sessionsAfter = summary.sessionsAfter || 0;

  return {
    accounts: summary.accounts || 0,
    accountsWithSessions: summary.accountsWithSessions || 0,
    accountsTrimmed: summary.accountsTrimmed || 0,
    sessionsBefore,
    expiredSessions: summary.expiredSessions || 0,
    sessionsAfter,
    sessionsRemoved: sessionsBefore - sessionsAfter,
  };
}

async function cleanup({ apply, max }) {
  const now = new Date();
  const before = await summarize(now, max);

  if (apply && before.sessionsRemoved > 0) {
    await Account.updateMany(
      { sessions: { $exists: true, $ne: [] } },
      [
        {
          $set: {
            sessions: {
              $slice: [
                {
                  $filter: {
                    input: { $ifNull: ['$sessions', []] },
                    as: 'session',
                    cond: { $gt: ['$$session.expiresAt', now] },
                  },
                },
                -max,
              ],
            },
          },
        },
      ],
      { updatePipeline: true },
    );
  }

  return {
    mode: apply ? 'apply' : 'dry-run',
    maxSessionsPerAccount: max,
    before,
    after: apply ? await summarize(now, max) : null,
  };
}

async function main() {
  const args = parseArgs();

  await connectDatabase();
  try {
    const result = await cleanup(args);
    result.database = Account.db.name;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_MAX_SESSIONS,
  parseArgs,
  summarize,
  cleanup,
};
