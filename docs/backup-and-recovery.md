# Backup and recovery

Receipts are legal records: their issued snapshot, UUID chain and ETA
identifiers must survive any failure.

## What to back up

| Data | Method | Frequency |
|---|---|---|
| MongoDB (all collections) | Continuous backup with point-in-time recovery (e.g. managed snapshots + oplog), or `mongodump --oplog` from a secondary | Continuous / at least hourly |
| `DATA_ENCRYPTION_KEY` | Secret manager with versioning, stored separately from database backups | On change |
| Redis | Not required (queue is rebuilt by the sweeper) | — |
| Configuration | Infrastructure-as-code repository | On change |

Backups must be encrypted at rest and in transit, access-restricted, and kept
for the legal retention period (compliance matrix U-08).

**Without the encryption key, ETA documents, device credentials, MFA secrets and
customer identity numbers in a backup cannot be read.** Losing the key makes the
stored ETA documents unrecoverable, although the structured receipt snapshot
(lines, totals, UUIDs) remains.

## Restore procedure

1. Restore MongoDB to a new replica set at the chosen point in time.
2. Start the API and worker with ETA submission **disabled** for all companies (set `eta.submissionEnabled=false`), so nothing is sent while the state is checked.
3. Verify audit-chain integrity per company (`GET /audit-events/verify`).
4. For each device, compare `posDevices.chain.seq/lastUuid` with the highest receipt `chainSeq`/`uuid`. They must match. A mismatch means the restore point split a transaction and needs investigation before any sale.
5. Receipts in `SUBMITTING` or `SUBMITTED` at the restore point: run reconciliation (Check status) so their state comes from ETA. Receipts issued after the restore point but already registered at ETA are lost locally. Recover their content from ETA (Get Receipt) and document the incident.
6. Re-enable submission.

## Restore test

Run quarterly: restore the latest backup to an isolated environment, run steps
2–4, sell one receipt on a test device in the simulated ETA mode, record the
duration and outcome here.

| Date | Backup point | Result | Duration | Notes |
|---|---|---|---|---|
| — | — | Not yet performed | — | — |
