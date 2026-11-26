# Acacia Books: stock now syncs like all other company data

Change from the previous package:

- `app-3.js`: removed the two `inventory_` exclusions (in `applyRemote` and `pushKey`). Stock (`inventory_<warehouse>`) now goes through the same per-company engine as invoices, customers, etc. (company id + key, base fingerprint, incremental pull).
- `merges.js`: the separate stock engine (`acxStock_sync`) is replaced by a thin wrapper. It keeps `window.acxStockSync` and the Stock Sync panel working, but only calls the main engine (`__companySync.pushDirty` / `pullCompany`).
- `sync.js` (live sync) is unchanged: it already pulls every 20 s and pushes `inventory_` keys straight away through the main engine.
- Removed `tests/stock-sync-race.test.cjs` (it tested the removed engine).
- `sql/acacia_stock_company_warehouse_fix.sql` is unchanged (read-only preview first, then the repair block).

Not tested against a live Supabase project: test an import, a clone, and a second browser before deploying.


## Update: no separate stock write path

- `acacia-fixes.js`: removed the direct Supabase write (`forcePush`) from the import check. After an import the app now only asks the main engine to push, then reads the cloud row back to check it. It never writes stock to the cloud by any other route.
- `merges.js`: removed the direct upload (`forcePush`) and the "Upload this device's stock" button from the Stock sync doctor. The doctor still shows read-only counts and can remove stock deletion markers (through the normal storage hook).
- Unchanged: the Organization Profile direct save (not stock).
- Not changed: Supabase triggers. Stock rows still pass through the database triggers on `company_state`.
