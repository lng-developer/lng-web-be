# Local Upload Performance Report

## Result

The local benchmark ran authenticated multipart requests through the real Express app, Atlas database `lng_web_be`, and the configured Cloudinary provider. It compared generic Media upload with the full listing PSD workflow.

The configured Cloudinary plan rejects raw files above 10 MiB. A direct 11 MiB probe returned HTTP 400: `File size too large. Got 11534336. Maximum is 10485760.` The original 20 MiB benchmark therefore waited for the external upload before surfacing HTTP 500. Valid benchmark sizes were changed to 1, 5, and 9 MiB.

## Measurements

| Size | Endpoint | Samples | Median | p95 | Throughput | Variation |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | Media baseline | 5 | 1,249.81 ms | 1,533.48 ms | 0.80 MiB/s | 29.00% |
| 1 MiB | Listing PSD | 5 | 1,877.00 ms | 2,356.01 ms | 0.53 MiB/s | 51.71% |
| 5 MiB | Media baseline | 3 | 3,614.54 ms | 3,675.52 ms | 1.38 MiB/s | 6.71% |
| 5 MiB | Listing PSD | 3 | 4,196.38 ms | 4,252.27 ms | 1.19 MiB/s | 10.07% |
| 9 MiB | Media baseline | 5 | 6,464.97 ms | 7,078.22 ms | 1.39 MiB/s | 26.90% |
| 9 MiB | Listing PSD | 5 | 7,193.37 ms | 9,288.58 ms | 1.25 MiB/s | 38.30% |

Listing workflow median overhead:

- 1 MiB: 627.19 ms (50.18%)
- 5 MiB: 581.84 ms (16.10%)
- 9 MiB: 728.40 ms (11.27%)

## Interpretation

The Cloudinary/network path is the dominant cost and scales with file size: the generic baseline rises from about 1.25 seconds at 1 MiB to 6.46 seconds at 9 MiB. The listing workflow consistently adds more than 500 ms median for Design resolution, Production recheck, and Order PSD status refresh.

Network variance remains above 20% for 1 and 9 MiB even after increasing those sizes to five samples. These are directional local results, not VPS capacity claims. They are sufficient to reject database-only optimization as the primary upload fix, but not to compare small sub-second changes reliably.

## Cleanup Proof

- Benchmark MediaAsset lifecycle rows: 50
- Active benchmark MediaAssets after cleanup: 0
- Remaining benchmark Cloudinary objects: 0
- Listing restored to original `psdTemplateAssetId`: `6a5b102b135a9b951049b47a`
- Listing restored to original `psdStatus`: `PRESENT`
- Benchmark account password was reset to a random process-only value; no password or token was persisted or printed.

## Decision

Two independent issues are proven:

1. The backend advertises a 200 MiB upload limit while the configured Cloudinary raw-file limit is 10 MiB. Oversized uploads waste time and end as HTTP 500 instead of being rejected at the boundary.
2. Valid listing PSD uploads synchronously wait for three post-actions, adding roughly 0.58-0.73 seconds median in these runs.

The next smallest safe change is to align backend validation with the effective provider limit and return HTTP 413 before Multer writes the full file. Optimize or detach listing post-actions only after that correctness fix. Large PSD support requires a higher Cloudinary raw-file limit or separate object storage; chunking does not bypass the plan's total-file limit.
