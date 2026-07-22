create or replace function public.jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb as $$
select case 
  when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then
    (select jsonb_object_agg(
      coalesce(ka, kb),
      case 
        when va is not null and vb is not null then public.jsonb_deep_merge(va, vb)
        else coalesce(vb, va)
      end
    ) from jsonb_each(a) e1(ka, va) full outer join jsonb_each(b) e2(kb, vb) on ka = kb)
  else b
end;
$$ language sql immutable;

create or replace function public.handle_sync_metadata()
returns trigger as $$
begin
  new.updated_at = now();
  if (TG_OP = 'UPDATE') then
    new.version = old.version + 1;
  end if;
  return new;
end;
$$ language plpgsql;

create table if not exists public.company_state (
  company_id text not null,
  key        text not null,
  value      text,
  version    bigint not null default 1,
  deleted_at timestamptz default null,
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);

drop trigger if exists sync_company_state_metadata on public.company_state;
create trigger sync_company_state_metadata
  before update on public.company_state
  for each row execute function public.handle_sync_metadata();

create table if not exists public.app_accounts (
  login_id   text primary key,
  username   text not null,
  company_id text not null,
  data       jsonb not null default '{}'::jsonb,
  version    bigint not null default 1,
  deleted_at timestamptz default null,
  updated_at timestamptz not null default now(),
  constraint check_data_is_object check (jsonb_typeof(data) = 'object')
);

drop trigger if exists sync_app_accounts_metadata on public.app_accounts;
create trigger sync_app_accounts_metadata
  before update on public.app_accounts
  for each row execute function public.handle_sync_metadata();

create index if not exists idx_company_state_sync 
  on public.company_state (company_id, updated_at, version);

create index if not exists idx_app_accounts_sync 
  on public.app_accounts (company_id, updated_at, version);

create index if not exists idx_app_accounts_data_gin 
  on public.app_accounts using gin (data);

alter table public.company_state enable row level security;
alter table public.app_accounts enable row level security;

drop policy if exists "tenant_isolation_company_state" on public.company_state;
drop policy if exists "tenant_isolation_app_accounts" on public.company_state;

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
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'company_state'
  ) then
    alter publication supabase_realtime add table public.company_state;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'app_accounts'
  ) then
    alter publication supabase_realtime add table public.app_accounts;
  end if;
end $$;

create or replace function public.upsert_account_delta(
  p_login_id text,
  p_username text,
  p_company_id text,
  p_data_delta jsonb
)
returns public.app_accounts as $$
declare
  v_result public.app_accounts;
begin
  insert into public.app_accounts (login_id, username, company_id, data)
  values (p_login_id, p_username, p_company_id, p_data_delta)
  on conflict (login_id) do update
  set 
    username = excluded.username,
    company_id = excluded.company_id,
    data = public.jsonb_deep_merge(public.app_accounts.data, excluded.data),
    deleted_at = null
  returning * into v_result;

  return v_result;
end;
$$ language plpgsql security definer;
