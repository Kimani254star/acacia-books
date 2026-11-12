-- ACACIA BOOKS: safe company stock-sync schema check/setup
-- IMPORTANT:
-- This SQL prepares the existing cloud-sync table. It does NOT copy browser
-- localStorage inventory into Supabase. The complete browser copy must be
-- pushed by Acacia Books while logged into the correct company.

-- 1) Create the expected table only if it does not already exist.
-- The app stores each company data key as text; inventory JSON is stored in
-- the value column as serialized text.
create table if not exists public.company_state (
  company_id text not null,
  key text not null,
  value text,
  updated_at timestamptz not null default now()
);

-- 2) Enforce one row per company + data key (required by the sync engine).
create unique index if not exists company_state_company_id_key_uidx
  on public.company_state (company_id, key);

-- 3) Ensure the table can be included in Supabase Realtime, if Realtime is used.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'company_state'
  ) then
    alter publication supabase_realtime add table public.company_state;
  end if;
exception
  when undefined_object then
    raise notice 'supabase_realtime publication not found; skipping publication registration';
end $$;

-- 4) Read-only diagnostic: show stock rows for one company.
-- Replace YOUR_COMPANY_ID with the exact companyId shown in the Books account.
select
  company_id,
  key,
  updated_at,
  case
    when key like 'inventory_%'
      then jsonb_array_length(coalesce(nullif(value, '')::jsonb, '[]'::jsonb))
    else null
  end as stock_item_count
from public.company_state
where company_id = 'YOUR_COMPANY_ID'
  and key like 'inventory_%'
order by key;

-- 5) Read-only check for duplicate company/key rows (should return no rows).
select company_id, key, count(*) as duplicate_rows
from public.company_state
group by company_id, key
having count(*) > 1;
