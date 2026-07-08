
create table if not exists public.company_state (
  company_id text not null,
  key        text not null,
  value      text,
  updated_at timestamptz default now(),
  primary key (company_id, key)
);
alter table public.company_state enable row level security;
drop policy if exists "app read write" on public.company_state;
create policy "app read write" on public.company_state
  for all to anon using (true) with check (true);
grant select, insert, update, delete on public.company_state to anon;
grant all on public.company_state to service_role;


create table if not exists public.app_accounts (
  login_id   text primary key,
  username   text,
  company_id text,
  data       jsonb,
  updated_at timestamptz default now()
);
alter table public.app_accounts enable row level security;
drop policy if exists "app read write" on public.app_accounts;
create policy "app read write" on public.app_accounts
  for all to anon using (true) with check (true);
grant select, insert, update, delete on public.app_accounts to anon;
grant all on public.app_accounts to service_role;

alter publication supabase_realtime add table public.company_state;
