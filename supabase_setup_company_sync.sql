create or replace function public.current_company_id()
returns text
language sql stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'company_id',''),
    nullif(auth.jwt() -> 'app_metadata'  ->> 'company_id','')
  );
$$;

-- ---------- (8) unified company key/value store ----------
create table if not exists public.company_state (
  company_id  text not null,
  key         text not null,
  value       text,
  updated_at  timestamptz not null default now(),
  primary key (company_id, key)
);
grant select, insert, update, delete on public.company_state to authenticated;
grant all on public.company_state to service_role;
alter table public.company_state enable row level security;

drop policy if exists cs_select on public.company_state;
drop policy if exists cs_write  on public.company_state;
create policy cs_select on public.company_state
  for select to authenticated
  using (company_id = public.current_company_id());
create policy cs_write on public.company_state
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ---------- accounts (cross-device login lookup) ----------
create table if not exists public.app_accounts (
  login_id    text primary key,
  username    text,
  company_id  text,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
grant select on public.app_accounts to anon;             -- login lookup by id
grant select, insert, update on public.app_accounts to authenticated;
grant all on public.app_accounts to service_role;
alter table public.app_accounts enable row level security;

drop policy if exists aa_lookup on public.app_accounts;
drop policy if exists aa_write  on public.app_accounts;
create policy aa_lookup on public.app_accounts
  for select to anon, authenticated using (true);        -- login form needs this
create policy aa_write  on public.app_accounts
  for all to authenticated
  using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- ---------- (10) audit log ----------
create table if not exists public.audit_log (
  id          bigserial primary key,
  company_id  text not null,
  actor       text not null,
  action      text not null,        -- 'write' | 'delete' | 'login' | 'register' | ...
  resource    text not null,        -- logical key or entity name
  at          timestamptz not null default now(),
  detail      jsonb
);
create index if not exists audit_log_company_idx on public.audit_log (company_id, at desc);
grant select, insert on public.audit_log to authenticated;
grant all on public.audit_log to service_role;
alter table public.audit_log enable row level security;

drop policy if exists al_read   on public.audit_log;
drop policy if exists al_insert on public.audit_log;
create policy al_read on public.audit_log
  for select to authenticated
  using (company_id = public.current_company_id());
create policy al_insert on public.audit_log
  for insert to authenticated
  with check (company_id = public.current_company_id());
