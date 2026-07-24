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
      supabaseClient = window.supabase.createClient(window.__SUPA_URL__, window.__SUPA_KEY__, {
        auth: { persistSession: true, autoRefreshToken: true, storageKey: 'sb-unify-auth' }
      });
    }
    return supabaseClient;
  }

  // Pull data from Supabase and apply to localStorage
  async function pullFromCloud() {
    try {
      const client = getSupabaseClient();
      if (!client) return;

      const companyId = NS.currentUser()?.companyId;
      if (!companyId) return;

      // Fetch company state from Supabase
      const { data, error } = await client
        .from('company_state')
        .select('key,value,updated_at')
        .eq('company_id', companyId);

      if (error) {
        console.warn('[companySync] pull error:', error);
        return;
      }

      if (!data) return;

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

      console.log('[companySync] pulled', data.length, 'keys from cloud');
    } catch (e) {
      console.warn('[companySync] pull exception:', e);
    }
  }

  // Push dirty keys to Supabase
  async function pushToCloud() {
    try {
      const client = getSupabaseClient();
      if (!client) return;

      const companyId = NS.currentUser()?.companyId;
      if (!companyId) return;

      const dirty = Object.keys(NS.dirty);
      if (!dirty.length) return;

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
        console.warn('[companySync] push error:', error);
        return;
      }

      // Clear dirty after successful push
      dirty.forEach(key => delete NS.dirty[key]);
      console.log('[companySync] pushed', dirty.length, 'keys to cloud');
    } catch (e) {
      console.warn('[companySync] push exception:', e);
    }
  }

  // Periodic sync (every 5 seconds)
  function startPeriodicSync() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(async () => {
      await pushToCloud();
      await pullFromCloud();
    }, 5000);
  }

  // Main sync entry point (called from index.html)
  window.startCloudSync = async function() {
    console.log('[companySync] starting sync...');
    
    // Initial pull
    await pullFromCloud();
    
    // Start periodic sync
    startPeriodicSync();
    
    console.log('[companySync] per-company cloud sync active');
    return true;
  };

  // Clean up on page unload
  window.addEventListener('pagehide', async () => {
    if (syncTimer) clearInterval(syncTimer);
    await pushToCloud();
  });

  console.log('[companySync] module loaded');
})();
