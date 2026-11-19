# Acacia Books stock sync fix

This source package includes a focused fix for stock being overwritten during cloud sync.

- A sync now checks that the local warehouse list has not changed while it reads or writes the cloud. If a user adds stock during that wait, it retries instead of replacing their newer list.
- Stock items are stamped with the warehouse selected for their own inventory key.
- The cloud stock sync remains scoped to both the signed-in company ID and the selected warehouse key. It does not merge one company's row with another company's row.
- `sql/acacia_stock_company_warehouse_fix.sql` first provides a read-only preview. Its repair block only aligns item warehouse labels with the warehouse key in that same company row; it never deletes, moves, or adds quantities.
- `tests/stock-sync-race.test.cjs` exercises the two save windows that could previously overwrite a newer local stock list. Run with `node --test tests/stock-sync-race.test.cjs` from this folder.

The archive did not include a database schema or a stock export. The SQL therefore targets the `company_state` structure used by the app and is intentionally non-destructive. If a row is already under the wrong warehouse key, assign its correct company and warehouse before any relocation; SQL cannot infer that from the mixed row.
