let ioRef = null;
const connectedAccounts = new Map();
const counters = {
  authFailures: 0,
  eventFailures: 0,
  connections: 0,
  disconnections: 0,
  lastErrorAt: null,
  lastErrorMessage: null,
};

function attachIo(io) {
  ioRef = io;
}

function recordConnection(accountId) {
  counters.connections += 1;
  if (!accountId) return;
  connectedAccounts.set(accountId, (connectedAccounts.get(accountId) || 0) + 1);
}

function recordDisconnect(accountId) {
  counters.disconnections += 1;
  if (!accountId) return;
  const nextCount = (connectedAccounts.get(accountId) || 1) - 1;
  if (nextCount > 0) connectedAccounts.set(accountId, nextCount);
  else connectedAccounts.delete(accountId);
}

function recordAuthFailure(error) {
  counters.authFailures += 1;
  recordError(error);
}

function recordEventFailure(error) {
  counters.eventFailures += 1;
  recordError(error);
}

function recordError(error) {
  counters.lastErrorAt = new Date().toISOString();
  counters.lastErrorMessage = error?.message || 'Socket error';
}

function getHealth() {
  const adapter = ioRef?.sockets?.adapter;
  return {
    status: ioRef ? 'ok' : 'disabled',
    connectedClients: ioRef?.engine?.clientsCount || 0,
    authenticatedUsers: connectedAccounts.size,
    rooms: adapter?.rooms?.size || 0,
    connections: counters.connections,
    disconnections: counters.disconnections,
    authFailures: counters.authFailures,
    eventFailures: counters.eventFailures,
    lastErrorAt: counters.lastErrorAt,
    lastErrorMessage: counters.lastErrorMessage,
  };
}

module.exports = {
  attachIo,
  getHealth,
  recordAuthFailure,
  recordConnection,
  recordDisconnect,
  recordEventFailure,
};
