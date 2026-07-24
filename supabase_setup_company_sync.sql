/* ============================================================
   Company Cloud Sync Module
   Syncs localStorage company data with Supabase in real-time
   ============================================================ */

(function(){
  if (window.__companySyncActive) return;
  window.__companySyncActive = true;

  const NS = window.__companyNS;
  if (!NS) { console.error('[companySync] isolation layer missing'); return; }

  let supabaseClient = null;
  let syncTimer = null;
  let lastSync = {};

  // Initialize Supabase client
  function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;
    if (window.supabase && window.__SUPA_URL__ && window.__SUPA_KEY__) {
      try {
        supabaseClient = window.supabase.createClient(window.__SUPA_URL__, window.__SUPA_KEY__, {
          auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sb-unify-auth' }
        });
        console.log('[companySync] Supabase client initialized');
      } catch (e) {
        console.error('[companySync] Failed to initialize Supabase:', e);
      }
    }
    return supabaseClient;
  }

  // Pull data from Supabase and apply to localStorage
  async function pullFromCloud() {
    try {
      const client = getSupabaseClient();
      if (!client) {
        console.log('[companySync] Supabase client not available, skipping pull');
        return false;
      }

      const currentUser = NS.currentUser();
      if (!currentUser) {
        console.log('[companySync] No logged in user');
        return false;
      }

      const companyId = currentUser.companyId;
      if (!companyId) {
        console.log('[companySync] No company ID in user');
        return false;
      }

      console.log('[companySync] Pulling data for company:', companyId);

      // Fetch company state from Supabase
      const { data, error } = await client
        .from('company_state')
        .select('key,value,updated_at')
        .eq('company_id', companyId);

      if (error) {
        console.warn('[companySync] Supabase query error:', error.message);
        // Don't fail on error - data might not exist yet (first login)
        return true;
      }

      if (!data) {
        console.log('[companySync] No data returned from Supabase');
        return true;
      }

      console.log('[companySync] Received', data.length, 'records from Supabase');

      // Apply to localStorage (via the proxy)
      NS.setApplying(true);
      try {
        data.forEach(row => {
          try {
            const val = JSON.parse(row.value);
            localStorage.setItem(row.key, JSON.stringify(val));
          } catch (e) {
            localStorage.setItem(row.key, row.value);
          }
        });
      } finally {
        NS.setApplying(false);
      }

      console.log('[companySync] Applied', data.length, 'keys to localStorage');
      return true;
    } catch (e) {
      console.error('[companySync] Pull exception:', e);
      return true; // Don't fail - allow bootstrap to continue
    }
  }

  // Push dirty keys to Supabase
  async function pushToCloud() {
    try {
      const client = getSupabaseClient();
      if (!client) return;

      const currentUser = NS.currentUser();
      if (!currentUser || !currentUser.companyId) return;

      const companyId = currentUser.companyId;
      const dirty = Object.keys(NS.dirty);
      
      if (!dirty.length) {
        console.log('[companySync] No dirty keys to push');
        return;
      }

      console.log('[companySync] Pushing', dirty.length, 'keys to Supabase');

      const rows = dirty.map(key => {
        let val = localStorage.getItem(key);
        try {
          val = JSON.parse(val);
        } catch (e) {}
        return {
          company_id: companyId,
          key: key,
          value: typeof val === 'string' ? val : JSON.stringify(val)
        };
      });

      const { error } = await client
        .from('company_state')
        .upsert(rows, { onConflict: 'company_id,key' });

      if (error) {
        console.warn('[companySync] Push error:', error.message);
        return;
      }

      // Clear dirty after successful push
      dirty.forEach(key => delete NS.dirty[key]);
      console.log('[companySync] Successfully pushed', dirty.length, 'keys');
    } catch (e) {
      console.error('[companySync] Push exception:', e);
    }
  }

  // Periodic sync (every 10 seconds)
  function startPeriodicSync() {
    if (syncTimer) clearInterval(syncTimer);
    console.log('[companySync] Starting periodic sync (every 10s)');
    syncTimer = setInterval(async () => {
      await pushToCloud();
      await pullFromCloud();
    }, 10000);
  }

  // Main sync entry point (called from index.html)
  window.startCloudSync = async function() {
    console.log('[companySync] Starting cloud sync...');
    
    try {
      // Try to pull initial data, but don't fail if it doesn't work
      const pullSuccess = await pullFromCloud();
      console.log('[companySync] Initial pull completed');
      
      // Start periodic sync regardless of initial pull result
      startPeriodicSync();
      
      console.log('[companySync] ✅ Cloud sync initialized successfully');
      return true;
    } catch (e) {
      console.error('[companySync] Exception during startup:', e);
      // Still return true to allow page to load
      startPeriodicSync();
      return true;
    }
  };

  // Clean up on page unload
  window.addEventListener('pagehide', async () => {
    if (syncTimer) clearInterval(syncTimer);
    await pushToCloud();
  });

  console.log('[companySync] module loaded and ready');
})();
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
