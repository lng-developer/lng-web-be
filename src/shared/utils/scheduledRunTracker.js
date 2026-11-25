function createScheduledRunTracker() {
  const active = new Set();

  function track(promise) {
    active.add(promise);
    const remove = () => active.delete(promise);
    promise.then(remove, remove);
    return promise;
  }

  function drain() {
    return Promise.allSettled(active);
  }

  return { track, drain };
}

module.exports = { createScheduledRunTracker };
