const connectionsByAccountId = new Map();

function connect(accountId) {
  const key = String(accountId || '');
  if (!key) return null;
  const nextCount = (connectionsByAccountId.get(key) || 0) + 1;
  connectionsByAccountId.set(key, nextCount);
  return nextCount === 1 ? 'ONLINE' : null;
}

function disconnect(accountId) {
  const key = String(accountId || '');
  if (!key) return null;
  const nextCount = (connectionsByAccountId.get(key) || 0) - 1;
  if (nextCount > 0) {
    connectionsByAccountId.set(key, nextCount);
    return null;
  }
  connectionsByAccountId.delete(key);
  return 'OFFLINE';
}

function onlineAccountIds() {
  return new Set(connectionsByAccountId.keys());
}

function reset() {
  connectionsByAccountId.clear();
}

module.exports = {
  connect,
  disconnect,
  onlineAccountIds,
  reset,
};
