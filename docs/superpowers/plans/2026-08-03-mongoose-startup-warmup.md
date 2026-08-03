# Mongoose Startup Warm-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish initializing registered Mongoose models before the HTTP server accepts requests.

**Architecture:** Add one database utility that awaits `init()` for every registered model. Call it after Mongo connects and before Redis/workers/listen only in production, where `autoIndex` is disabled; development must not reconcile Atlas indexes implicitly.

**Tech Stack:** Node.js, Mongoose, Jest

## Global Constraints

- Do not enable production automatic index creation.
- Do not change routes, queries, workers, or schedulers.
- Do not add dependencies.

---

### Task 1: Warm registered models before listen

**Files:**
- Modify: `src/config/database.js`
- Modify: `src/server.js`
- Create: `src/test/config/database.test.js`

**Interfaces:**
- Produces: `initializeModels()` resolving only after every registered model's `init()` resolves.
- Consumes: `initializeModels()` in production `bootstrap()` before server setup continues.

- [ ] Write a failing test proving all registered models are initialized and awaited.
- [ ] Run `npx jest src/test/config/database.test.js --runInBand` and observe the missing export failure.
- [ ] Implement `initializeModels()` and await it immediately after `connectDatabase()`.
- [ ] Run the focused test, syntax checks, and architecture contract.
