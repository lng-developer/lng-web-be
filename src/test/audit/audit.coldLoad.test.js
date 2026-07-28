const { execFileSync } = require('child_process');
const path = require('path');

test('scoped Audit query resolves finalized Auth exports after a reciprocal cold load', () => {
  const servicePath = path.resolve(__dirname, '../../modules/audit/services/auditEvent.service.js');
  const repositoryPath = path.resolve(__dirname, '../../modules/audit/repositories/auditEvent.repository.js');
  const authPath = path.resolve(__dirname, '../../modules/auth/public.js');
  const script = `
    const Module = require('module');
    const servicePath = ${JSON.stringify(servicePath)};
    const repository = require(${JSON.stringify(repositoryPath)});
    const authPath = ${JSON.stringify(authPath)};
    const originalLoad = Module._load;
    let authReady = false;
    let canAccessScopeCalled = false;
    const finalAuth = {
      canAccessScope(_context, permission, scope) {
        canAccessScopeCalled = permission === 'AUDIT:READ'
          && scope.scopeType === 'shop'
          && scope.scopeId === 'shop-1';
        return canAccessScopeCalled;
      },
      isSuperAdmin() { return false; },
    };
    Module._load = function load(request, parent, isMain) {
      let resolved;
      try { resolved = Module._resolveFilename(request, parent, isMain); } catch (_error) {}
      if (resolved === authPath) return authReady ? finalAuth : {};
      return originalLoad.call(this, request, parent, isMain);
    };
    repository.list = async (_query, scopes) => ({ items: [], nextCursor: null, scopes });
    delete require.cache[servicePath];
    const service = require(servicePath);
    authReady = true;
    service.listEvents({ limit: 20 }, {
      permissions: [],
      scopes: [{ scopeType: 'shop', scopeId: 'shop-1', permissions: ['AUDIT:READ'] }],
    }).then(() => {
      if (!canAccessScopeCalled) throw new Error('final Auth capability was not called');
    }).catch((error) => {
      console.error(error.stack || error);
      process.exitCode = 1;
    });
  `;

  expect(() => execFileSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'pipe',
  })).not.toThrow();
});
