ACACIA PAYMENTS PACKAGE (cards, PayPal, bank transfer; M-Pesa/Airtel ready for later)

GITHUB (Books repo):  index.html, payments-real.js, pay-return.html  -> main folder
SUPABASE:  run supabase/mobile_payments.sql in SQL Editor; paste supabase/functions/pay/index.ts as an
           Edge Function named "pay" with JWT verification OFF; add secrets listed in supabase/SETUP.md
PAYPAL:    open payments-real.js and paste your PayPal Client ID into  paypalClientId: ""
Support repo: nothing to add.

MULTI-CURRENCY ACCOUNTING UPDATE
--------------------------------
The Acacia multi-currency layer is loaded from acacia-multicurrency.js.
It preserves the existing invoice, bill, quotation, purchase-order, credit-note,
receipt and payment records and adds backwards-compatible FX metadata without
rewriting historic transaction totals. It records dated exchange-rate snapshots
in acxExchangeRateHistory and exposes window.acxFX helpers for rate lookup,
conversion, exposure and realised-FX reporting. Foreign-currency quotations and
credit notes receive currency/rate controls when their forms are opened. The FX
revaluation panel is added to Reports when that tab is present.

Important accounting note: the FX panel is an analysis/revaluation estimate.
It does not automatically post unrealised or realised FX journals to the general
ledger, because the project does not yet provide configured realised/unrealised
FX gain/loss accounts and posting/approval rules. Review and post the resulting
adjustments through the existing journal workflow after configuring those
accounts. Payment settlement reporting uses linked payment records and dated
rates where available; unlinked or incomplete payment records are excluded.

MULTI-CURRENCY PATCH 2 (2026-11-16)
----------------------------------
Fixed edit-form currency restoration for quotations and credit notes, corrected
record targeting after save so an edit does not accidentally annotate the last
record, and preserved payment amount fields while adding FX metadata (payment
schemas vary across modules). Historical rate lookup now returns no rate when a
requested date predates the first recorded rate for that currency, rather than
silently substituting today's settings rate.

Validation performed: Node.js syntax checks passed for all 28 JavaScript files;
required multi-currency script references are present in index.html. This is a
static validation only. Browser workflow, data reconciliation, and ledger posting
must still be tested in a staging copy. FX gain/loss reporting remains an analysis
estimate; automatic journal posting is not included in this package.

INVENTORY COSTING & BULK COSTING (2026-11-16)
- Added acacia-inventory-costing.js and loaded it from index.html.
- Inventory now has a Costing & Bulk Costing panel for each selected warehouse.
- Supports business default Weighted Average or FIFO, plus per-product overrides and bulk method assignment.
- FIFO records dated cost layers; weighted average maintains a moving average. Opening stock is initialized from existing quantity and buyPrice without deleting legacy fields.
- Bulk landed-cost allocation distributes an additional shipment cost by current inventory value or quantity.
- Exposes window.AcaciaCosting.receive(...) and issue(...) for receipt/issue integrations.
- Important limitation: this patch adds the costing engine and controls, but does not yet rewire every legacy purchase, sales, return, POS, transfer, and journal posting path to call receive/issue. Do not treat FIFO COGS or financial statements as production-complete until those workflows are integrated and tested. Existing transactions are preserved.

HUB DRAFT REGISTERS (2026-11-16)
--------------------------------
- Added a Drafts entry under Sales Hub, Purchase Hub, Accounting Hub and Inventory.
- Each hub register reads existing local draft records from browser storage and displays the draft type, name/reference, date, amount and status.
- Drafts are not converted into posted transactions by this register. Existing source records are left intact.
- Open module takes the user to the corresponding source module; it does not itself post or approve a draft.
- Draft counts are shown beside each hub's Drafts menu entry. Refresh reloads the current register.
- Static validation: JavaScript syntax checks passed. Browser-level workflow and record-by-record resume testing are still required.
