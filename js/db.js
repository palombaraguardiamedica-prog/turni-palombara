// ============================================================
//  db.js — client Supabase + accesso dati + autenticazione
// ============================================================
(function () {
  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const lower = (s) => (s || '').trim().toLowerCase();
  const pad2 = (n) => String(n).padStart(2, '0');
  const dstr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const redirectUrl = () => location.origin + location.pathname;

  window.DB = {
    sb, lower, dstr, pad2, redirectUrl,

    async getSession() { const { data } = await sb.auth.getSession(); return data.session; },
    onAuth(cb) { sb.auth.onAuthStateChange((_e, session) => cb(session)); },
    async signInGoogle(forceChooser) {
      const options = { redirectTo: redirectUrl() };
      if (forceChooser) options.queryParams = { prompt: 'select_account' };
      return sb.auth.signInWithOAuth({ provider: 'google', options });
    },
    async signOut() { return sb.auth.signOut(); },

    // riga utente se autorizzato, altrimenti null (RLS restituisce 0 righe se non abilitato)
    async myProfile(email) {
      const { data, error } = await sb.from('utenti_autorizzati').select('*').eq('email', lower(email)).maybeSingle();
      if (error) { console.warn('myProfile', error); return null; }
      return data;
    },

    // --- gestione utenti (admin) ---
    async listUsers() {
      const { data, error } = await sb.from('utenti_autorizzati').select('*')
        .order('ordine', { ascending: true }).order('nome', { ascending: true });
      if (error) throw error; return data || [];
    },
    async addUser(u) {
      const row = {
        email: lower(u.email), nome: u.nome || '', colore: u.colore,
        ruolo: u.ruolo || 'membro', ordine: u.ordine != null ? u.ordine : 100, attivo: true
      };
      const { error } = await sb.from('utenti_autorizzati').insert(row); if (error) throw error;
    },
    async updateUser(email, patch) {
      const { error } = await sb.from('utenti_autorizzati').update(patch).eq('email', lower(email)); if (error) throw error;
    },
    async deleteUser(email) {
      const { error } = await sb.from('utenti_autorizzati').delete().eq('email', lower(email)); if (error) throw error;
    },

    // --- turni del mese (month: 0-11) ---
    async monthTurni(year, month) {
      const first = `${year}-${pad2(month + 1)}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const last = `${year}-${pad2(month + 1)}-${pad2(lastDay)}`;
      const { data, error } = await sb.from('turni').select('user_email,giorno')
        .gte('giorno', first).lte('giorno', last);
      if (error) throw error; return data || [];
    },
    async addTurno(email, giorno) {
      const { error } = await sb.from('turni').insert({ user_email: lower(email), giorno });
      if (error && error.code !== '23505') throw error;   // 23505 = gia' presente: ok
    },
    async removeTurno(email, giorno) {
      const { error } = await sb.from('turni').delete().eq('user_email', lower(email)).eq('giorno', giorno);
      if (error) throw error;
    },

    // --- note per giorno (condivise) ---
    async monthNotes(year, month) {
      const first = `${year}-${pad2(month + 1)}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const last = `${year}-${pad2(month + 1)}-${pad2(lastDay)}`;
      const { data, error } = await sb.from('note_giorni').select('giorno,testo')
        .gte('giorno', first).lte('giorno', last);
      if (error) throw error; return data || [];
    },
    async saveNote(giorno, testo, email) {
      testo = (testo || '').trim();
      if (!testo) {
        const { error } = await sb.from('note_giorni').delete().eq('giorno', giorno);
        if (error) throw error; return;
      }
      const { error } = await sb.from('note_giorni')
        .upsert({ giorno, testo, updated_by: lower(email), updated_at: new Date().toISOString() }, { onConflict: 'giorno' });
      if (error) throw error;
    },

    // --- calendario di sincronizzazione per mese (Google Calendar) ---
    async getSyncTarget(email, mese) {
      const { data, error } = await sb.from('sync_target').select('calendar_id')
        .eq('user_email', lower(email)).eq('mese', mese).maybeSingle();
      if (error) { console.warn('getSyncTarget', error); return null; }
      return data ? data.calendar_id : null;
    },
    async setSyncTarget(email, mese, calendarId) {
      const { error } = await sb.from('sync_target')
        .upsert({ user_email: lower(email), mese, calendar_id: calendarId, updated_at: new Date().toISOString() }, { onConflict: 'user_email,mese' });
      if (error) throw error;
    },

    subscribeTurni(cb) {
      return sb.channel('turni-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'turni' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'utenti_autorizzati' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'note_giorni' }, cb)
        .subscribe();
    },

    async getAppSha() {
      const { data } = await sb.from('app_version').select('sha').eq('id', 1).maybeSingle();
      return data ? data.sha : '';
    },
    subscribeAppVersion(cb) {
      return sb.channel('ver-live')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'app_version', filter: 'id=eq.1' },
          (p) => cb(p && p.new && p.new.sha))
        .subscribe();
    }
  };
})();
