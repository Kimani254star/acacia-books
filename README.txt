ACACIA PAYMENTS PACKAGE (cards, PayPal, bank transfer; M-Pesa/Airtel ready for later)

GITHUB (Books repo):  index.html, payments-real.js, pay-return.html  -> main folder
SUPABASE:  run supabase/mobile_payments.sql in SQL Editor; paste supabase/functions/pay/index.ts as an
           Edge Function named "pay" with JWT verification OFF; add secrets listed in supabase/SETUP.md
PAYPAL:    open payments-real.js and paste your PayPal Client ID into  paypalClientId: ""
Support repo: nothing to add.


BRANDING READABILITY UPDATE: acacia-fixes.js now checks text contrast at the WCAG AA 4.5:1 minimum, including after company color changes. Organization Profile inputs, links, labels, branding previews and placeholder text retain readable foregrounds.
