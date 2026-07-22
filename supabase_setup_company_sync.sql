create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.company_state (
  company_id text not null,
  key        text not null,
  value      text,
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);

drop trigger if exists set_company_state_updated_at on public.company_state;
create trigger set_company_state_updated_at
  before update on public.company_state
  for each row execute function public.set_updated_at();

create table if not exists public.app_accounts (
  login_id   text primary key,
  username   text not null,
  company_id text,
  data       jsonb default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint check_data_is_object check (jsonb_typeof(data) = 'object')
);

create index if not exists idx_app_accounts_company_id on public.app_accounts(company_id);
create index if not exists idx_app_accounts_data_gin on public.app_accounts using gin (data);

drop trigger if exists set_app_accounts_updated_at on public.app_accounts;
create trigger set_app_accounts_updated_at
  before update on public.app_accounts
  for each row execute function public.set_updated_at();

alter table public.company_state enable row level security;
alter table public.app_accounts enable row level security;

drop policy if exists "tenant_isolation_company_state" on public.company_state;
drop policy if exists "tenant_isolation_app_accounts" on public.app_accounts;

create policy "tenant_isolation_company_state" on public.company_state
  for all to authenticated
  using (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id'))
  with check (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id'));

create policy "tenant_isolation_app_accounts" on public.app_accounts
  for all to authenticated
  using (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id'))
  with check (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id'));

grant select, insert, update, delete on public.company_state to authenticated;
grant select, insert, update, delete on public.app_accounts to authenticated;
grant all on public.company_state to service_role;
grant all on public.app_accounts to service_role;

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
end $$;
