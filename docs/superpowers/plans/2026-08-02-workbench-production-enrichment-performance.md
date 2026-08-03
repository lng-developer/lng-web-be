# Workbench Production Enrichment Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce workbench latency by running independent production shop, user, and vendor enrichment reads concurrently without changing API output.

**Architecture:** Keep the production-task query, missing-order-snapshot enrichment, and authorization checks unchanged. Run the three existing enrichment functions concurrently, merge only their disjoint enrichment fields by stable task position, and then map the merged tasks through the existing DTO.

**Tech Stack:** Node.js, CommonJS, Jest, MongoDB/Mongoose, k6

## Global Constraints

- Limit production code changes to `listTaskSummariesByOrderItemIds()`.
- Preserve its public signature, DTO fields, permission checks, and error behavior.
- Do not change production queue/export flows, repositories, indexes, caching, dependencies, or database configuration.
- Do not commit unless the user explicitly requests it.

---

### Task 1: Parallelize workbench production enrichments

**Files:**
- Modify: `src/test/production/services/productionTask.service.test.js`
- Modify: `src/modules/production/services/productionTask.service.js:2067-2073`

**Interfaces:**
- Consumes: `attachShops(tasks)`, `attachProductionUsers(tasks)`, and `attachVendorSubmissions(tasks)`.
- Produces: unchanged `listTaskSummariesByOrderItemIds(orderItemIds, authContext)` DTOs containing shop, assigned-user, seller-user, and vendor-submission data.

- [ ] **Step 1: Write the failing concurrency test**

Add a focused test beside the existing list-task-summary tests. Use one task containing `orderSnapshot`, `orderItemSnapshot.sku`, `assignedDesignUserId`, and `vendorSubmissionId` so no missing-order lookup obscures the three target branches. Return unresolved promises from `shopPublic.findById`, `hrPublic.listEmployeeProfilesByAccountIds`, and `vendorSubmissionPublic.listLatestByProductionTaskIds`; keep employee-code lookup immediately resolved.

```js
test('loads task shop, users, and vendor submission concurrently', async () => {
  let resolveShop;
  let resolveUsers;
  let resolveVendor;
  const shopPromise = new Promise((resolve) => { resolveShop = resolve; });
  const usersPromise = new Promise((resolve) => { resolveUsers = resolve; });
  const vendorPromise = new Promise((resolve) => { resolveVendor = resolve; });
  repository.listSummariesByOrderItemIds.mockResolvedValueOnce([{
    _id: taskId,
    orderId,
    orderItemId,
    shopId,
    status: 'READY_TO_SEND_VENDOR',
    assignedDesignUserId: designerId,
    vendorSubmissionId,
    orderSnapshot: order,
    orderItemSnapshot: item,
  }]);
  shopPublic.findById.mockReturnValue(shopPromise);
  hrPublic.listEmployeeProfilesByAccountIds.mockReturnValue(usersPromise);
  hrPublic.listEmployeeProfilesByEmployeeCodes.mockResolvedValue([
    { employeeCode: 'J2605', fullName: 'Seller User' },
  ]);
  vendorSubmissionPublic.listLatestByProductionTaskIds.mockReturnValue(vendorPromise);

  const resultPromise = service.listTaskSummariesByOrderItemIds([orderItemId], { system: true });
  await Promise.resolve();
  await Promise.resolve();

  expect(shopPublic.findById).toHaveBeenCalledWith(shopId);
  expect(hrPublic.listEmployeeProfilesByAccountIds).toHaveBeenCalledWith([designerId, order.assignedStaffId]);
  expect(vendorSubmissionPublic.listLatestByProductionTaskIds).toHaveBeenCalledWith([taskId]);

  resolveShop({ _id: shopId, name: 'LNG Main Shop' });
  resolveUsers([
    { accountId: designerId, fullName: 'Scale User', employeeCode: 'SC01' },
    { accountId: order.assignedStaffId, fullName: 'Order Owner', employeeCode: 'CS01' },
  ]);
  resolveVendor([{
    id: vendorSubmissionId,
    productionTaskId: taskId,
    status: 'SUBMITTED',
  }]);

  const [summary] = await resultPromise;
  expect(summary.shop).toMatchObject({ id: shopId, name: 'LNG Main Shop' });
  expect(summary.assignedDesigner).toMatchObject({ id: designerId, fullName: 'Scale User' });
  expect(summary.seller).toMatchObject({ employeeCode: 'J2605', name: 'Seller User' });
  expect(summary.vendorSubmission).toMatchObject({ id: vendorSubmissionId, status: 'SUBMITTED' });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx jest src/test/production/services/productionTask.service.test.js --runInBand
```

Expected: the vendor assertion reports zero calls because the current implementation waits for shop and user enrichment first.

- [ ] **Step 3: Implement the minimum concurrent merge**

Keep task loading and authorization unchanged. Replace the nested enrichment awaits with one `Promise.all`, then copy only the fields owned by each branch before passing the rows to `toProductionTaskSummaryDto`.

```js
const [withShops, withUsers, withVendorSubmissions] = await Promise.all([
  attachShops(tasks),
  attachProductionUsers(tasks),
  attachVendorSubmissions(tasks),
]);
return tasks.map((task, index) => toProductionTaskSummaryDto({
  ...task,
  shop: withShops[index]?.shop || null,
  scaleByUser: withUsers[index]?.scaleByUser || null,
  qcByUser: withUsers[index]?.qcByUser || null,
  csAssigneeUser: withUsers[index]?.csAssigneeUser || null,
  orderOwnerUser: withUsers[index]?.orderOwnerUser || null,
  sellerUser: withUsers[index]?.sellerUser || null,
  vendorSubmission: withVendorSubmissions[index]?.vendorSubmission || null,
}));
```

- [ ] **Step 4: Run focused verification and verify GREEN**

Run:

```powershell
node -c src/modules/production/services/productionTask.service.js
npx jest src/test/production/services/productionTask.service.test.js --runInBand
$env:DOTENV_CONFIG_PATH='../../.env'; node -r dotenv/config ./node_modules/jest/bin/jest.js src/test/architecture.contract.test.js --runInBand
```

Expected: syntax exits 0; production and architecture suites report zero failures.

- [ ] **Step 5: Benchmark the affected endpoint**

Restart the local backend with the worktree code. Run `test/load/expected-load.js` against `/api/orders/workbench?limit=50` at 5 VU and 10 VU, using 5-second ramp-up, 20-second steady load, and 5-second ramp-down.

Expected: 0 percent request errors. Compare against the latest p95 values of 647 ms at 5 VU and 1.02 seconds at 10 VU; acceptance remains p95 below 1 second.

- [ ] **Step 6: Stop at the measured boundary**

Report both benchmark results and stop. Do not add caching or broaden production queue/export code even if the local Atlas connection remains limiting.
