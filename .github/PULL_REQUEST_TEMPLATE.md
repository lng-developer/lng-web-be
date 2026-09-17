## Summary

- 

## Scope

- [ ] integration
- [ ] catalog
- [ ] order
- [ ] production
- [ ] finance
- [ ] media
- [ ] mapping
- [ ] shipment
- [ ] vendor
- [ ] auth
- [ ] shop
- [ ] audit
- [ ] report
- [ ] vendorSubmission
- [ ] shared/config/tooling/docs

## Checklist

- [ ] I reviewed the diff before opening this PR.
- [ ] No debug code or unnecessary `console.log` remains.
- [ ] No secrets, API keys, tokens, credentials, or `.env` files are committed.
- [ ] API responses use DTOs and do not leak raw database documents.
- [ ] Read-only Mongoose queries use `.lean()`.
- [ ] Cross-module access goes through the target module's `public.js`.
- [ ] Ingestion, webhook, import, or transaction writes are idempotent where applicable.
- [ ] Local verification commands passed.

## Verification

```text
npm run test:architecture
npm run test:full
```

## Notes

- 
