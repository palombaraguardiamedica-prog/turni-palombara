// ============================================================
//  app.js — TURNI PALOMBARA
//  Auth, tabella mensile, modalita' modifica, totali, admin,
//  rilevamento aggiornamenti.
// ============================================================
(function () {
  const CONFIG = window.APP_CONFIG;
  const lower = DB.lower, dstr = DB.dstr;

  const MESI = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO',
                'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
  const GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']; // index = getDay()
  const PALETTE = ['#3f7d57', '#2f6fb0', '#b5532f', '#7a4fb0', '#0f8c8c', '#b0357a',
                   '#8a6d1f', '#516a7a', '#2e8b3d', '#c25a00', '#5a5fb0', '#a01f3c'];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }

  // ---------- festivi italiani ----------
  const FISSI = [[1, 1], [1, 6], [4, 25], [5, 1], [6, 2], [8, 15], [11, 1], [12, 8], [12, 25], [12, 26]];
  function easterSunday(Y) {
    const a = Y % 19, b = Math.floor(Y / 100), c = Y % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Y, month - 1, day);
  }
  const _holCache = {};
  function holidays(Y) {
    if (_holCache[Y]) return _holCache[Y];
    const s = new Set(FISSI.map(([m, d]) => m + '-' + d));
    const e = easterSunday(Y), p = addDays(e, 1);
    s.add((e.getMonth() + 1) + '-' + e.getDate());
    s.add((p.getMonth() + 1) + '-' + p.getDate());
    (CONFIG.FESTIVI_LOCALI || []).forEach(str => {
      const [mm, dd] = String(str).split('-').map(Number);
      if (mm && dd) s.add(mm + '-' + dd);
    });
    return (_holCache[Y] = s);
  }
  function isRed(date) {
    return date.getDay() === 0 || holidays(date.getFullYear()).has((date.getMonth() + 1) + '-' + date.getDate());
  }

  const state = {
    session: null, me: null, isAdmin: false,
    users: [], turni: new Set(), notes: {}, editingNote: null,
    year: new Date().getFullYear(), month: new Date().getMonth(),
    editMode: false, channel: null, _initedFor: null, _reloadTimer: null,
    _localSha: null, _updateAvail: false, _toastDismissed: false, _verChannel: null, _verPollId: null
  };

  // ---------- toast ----------
  let toastTimer;
  function toast(msg, isErr) {
    const t = $('toast'); t.textContent = msg; t.classList.toggle('err', !!isErr); t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
  }

  function showScreen(name) {
    $('login-screen').classList.toggle('hidden', name !== 'login');
    $('blocked-screen').classList.toggle('hidden', name !== 'blocked');
    $('app').classList.toggle('hidden', name !== 'app');
  }

  // ============================================================
  //  AUTENTICAZIONE
  // ============================================================
  async function handleSession(session) {
    state.session = session;
    if (!session) { state._initedFor = null; showScreen('login'); return; }
    const email = lower(session.user.email);
    if (state._initedFor === email) return;
    const profile = await DB.myProfile(email);
    if (!profile || !profile.attivo) {
      state._initedFor = null;
      $('blocked-email').textContent = session.user.email;
      showScreen('blocked');
      return;
    }
    state.me = profile; state.isAdmin = profile.ruolo === 'admin';
    state._initedFor = email;
    initApp();
  }

  function initApp() {
    showScreen('app');
    $('btn-admin').classList.toggle('hidden', !state.isAdmin);
    const now = new Date(); state.year = now.getFullYear(); state.month = now.getMonth();
    updateMonthLabel();
    if (!state.channel) {
      state.channel = DB.subscribeTurni(() => {
        clearTimeout(state._reloadTimer); state._reloadTimer = setTimeout(loadMonth, 300);
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') loadMonth();
      });
    }
    startVersionCheck();
    loadMonth();
  }

  async function doGoogle(force) {
    $('login-msg').textContent = force ? 'Scegli l\'account…' : 'Apertura Google…';
    $('login-msg').classList.remove('err');
    const { error } = await DB.signInGoogle(force);
    if (error) { $('login-msg').textContent = 'Errore login Google: ' + error.message; $('login-msg').classList.add('err'); }
  }

  // ---------- rilevamento aggiornamenti (badge + toast) ----------
  async function startVersionCheck() {
    if (state._verChannel) return;
    try { state._localSha = await DB.getAppSha(); } catch (_) {}
    state._verChannel = DB.subscribeAppVersion(onVerChange);
    state._verPollId = setInterval(async () => {
      try { const s = await DB.getAppSha(); if (s && state._localSha && s !== state._localSha) showUpdate(); } catch (_) {}
    }, 5 * 60 * 1000);
  }
  function onVerChange(sha) { if (sha && state._localSha && sha !== state._localSha) showUpdate(); }
  function showUpdate() {
    if (state._updateAvail) return;
    state._updateAvail = true;
    $('btn-update').classList.remove('hidden');
    refreshUpdateToast();
  }
  function refreshUpdateToast() {
    const show = state._updateAvail && !state._toastDismissed;
    $('update-toast').classList.toggle('hidden', !show);
  }
  function applyUpdate() {
    $('btn-update').disabled = true;
    $('update-overlay').classList.remove('hidden');
    const bust = new Date().getTime();
    const assets = ['index.html', 'js/app.js', 'js/db.js', 'js/config.js', 'css/style.css'];
    const jobs = [];
    if ('serviceWorker' in navigator) jobs.push(navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))).catch(() => {}));
    if (window.caches) jobs.push(caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).catch(() => {}));
    Promise.all(jobs)
      .then(() => Promise.all(assets.map(u => fetch(u, { cache: 'reload' }).catch(() => {}))))
      .then(() => location.replace(location.pathname + '?_r=' + bust))
      .catch(() => location.reload());
  }

  // ============================================================
  //  NAVIGAZIONE MESE
  // ============================================================
  function updateMonthLabel() { $('month-label').textContent = `${MESI[state.month]} ${state.year}`; }
  function shiftMonth(delta) {
    const d = new Date(state.year, state.month + delta, 1);
    state.year = d.getFullYear(); state.month = d.getMonth();
    updateMonthLabel(); loadMonth();
  }
  function goToday() {
    const n = new Date(); state.year = n.getFullYear(); state.month = n.getMonth();
    updateMonthLabel(); loadMonth();
  }

  // ============================================================
  //  CARICAMENTO + RENDER
  // ============================================================
  async function loadMonth() {
    try {
      const [users, rows, notes] = await Promise.all([
        DB.listUsers(), DB.monthTurni(state.year, state.month), DB.monthNotes(state.year, state.month)
      ]);
      state.users = users.filter(u => u.attivo)
        .sort((a, b) => (a.ordine - b.ordine) || (a.nome || a.email).localeCompare(b.nome || b.email));
      state.turni = new Set(rows.map(r => lower(r.user_email) + '|' + r.giorno));
      state.notes = {}; notes.forEach(n => { state.notes[n.giorno] = n.testo; });
      render();
    } catch (e) { console.error(e); toast('Errore nel caricamento', true); }
  }

  function render() {
    const y = state.year, m = state.month;
    const ndays = new Date(y, m + 1, 0).getDate();
    const users = state.users;
    const myEmail = lower(state.me.email);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const totals = {}; users.forEach(u => totals[lower(u.email)] = 0);

    let html = '<table class="turni"><thead><tr>';
    html += '<th class="c-num">#</th><th class="c-wday">Giorno</th>';
    users.forEach(u => {
      const mine = lower(u.email) === myEmail;
      const label = u.nome || u.email.split('@')[0];
      html += `<th class="c-user${mine ? ' mine' : ''}"><div class="uh"><span>${esc(label)}</span><span class="udot" style="background:${esc(u.colore)}"></span></div></th>`;
    });
    html += '<th class="c-note">NOTE / DESIDERATA</th>';
    html += '</tr></thead><tbody>';

    for (let d = 1; d <= ndays; d++) {
      const date = new Date(y, m, d), giorno = dstr(date);
      const red = isRed(date), todayRow = sameDay(date, today);
      let cnt = 0; const present = {};
      users.forEach(u => {
        const e = lower(u.email), has = state.turni.has(e + '|' + giorno);
        present[e] = has; if (has) { cnt++; totals[e]++; }
      });
      const cntCls = cnt === 0 ? 'cnt0' : (cnt === 1 ? 'cnt1' : 'cnt2');
      html += `<tr class="${red ? 'red ' : ''}${todayRow ? 'is-today' : ''}">`;
      html += `<td class="c-num ${cntCls}">${d}</td>`;
      html += `<td class="c-wday${red ? ' red' : ''}">${GIORNI[date.getDay()]}</td>`;
      users.forEach(u => {
        const e = lower(u.email), has = present[e], dup = has && cnt >= 2;
        const editable = state.editMode && (state.isAdmin || e === myEmail);
        const cls = ['cell'];
        if (has) cls.push('x');
        if (dup) cls.push('dup');
        if (e === myEmail) cls.push('mine');
        if (editable) cls.push('editable');
        html += `<td class="${cls.join(' ')}" data-email="${esc(e)}" data-giorno="${giorno}">${has ? '<span class="mark">✕</span>' : ''}</td>`;
      });
      const nota = state.notes[giorno] || '';
      html += `<td class="c-note note" data-giorno="${giorno}">${nota ? esc(nota) : '<span class="note-ph">+ nota</span>'}</td>`;
      html += '</tr>';
    }

    html += '</tbody><tfoot><tr>';
    html += '<td class="c-foot-left" colspan="2"><div class="foot-left-inner">'
      + '<button id="btn-sync" class="foot-feat" type="button" disabled title="Sincronizza con Google Calendar (prossimamente)">📅</button>'
      + '<button id="btn-pdf" class="foot-feat" type="button" disabled title="Genera PDF turni (prossimamente)">📄</button>'
      + '<span class="tot-label">TOTALE</span></div></td>';
    users.forEach(u => { html += `<td>${totals[lower(u.email)] || 0}</td>`; });
    html += '<td class="c-note"></td>';
    html += '</tr></tfoot></table>';

    $('table-wrap').innerHTML = html;
  }

  // ---------- toggle X (scrittura immediata, ottimistica) ----------
  async function toggleCell(email, giorno) {
    email = lower(email);
    const key = email + '|' + giorno, had = state.turni.has(key);
    if (had) state.turni.delete(key); else state.turni.add(key);
    render();
    try {
      if (had) await DB.removeTurno(email, giorno); else await DB.addTurno(email, giorno);
    } catch (err) {
      console.error(err);
      if (had) state.turni.add(key); else state.turni.delete(key);
      render(); toast('Errore nel salvataggio', true);
    }
  }

  function onTableClick(e) {
    const noteTd = e.target.closest && e.target.closest('td.note');
    if (noteTd) { openNoteEditor(noteTd.dataset.giorno); return; }
    const td = e.target.closest && e.target.closest('td.cell.editable');
    if (!td) return;
    toggleCell(td.dataset.email, td.dataset.giorno);
  }

  // ---------- modalita' modifica ----------
  function toggleEdit() {
    state.editMode = !state.editMode;
    document.body.classList.toggle('editing', state.editMode);
    const btn = $('btn-edit');
    btn.classList.toggle('on', state.editMode);
    btn.innerHTML = state.editMode ? '✓ Ho finito' : '✏️ Inserisci disponibilita\' del mese';
    const hint = $('edit-hint');
    hint.classList.toggle('hidden', !state.editMode);
    if (state.editMode) {
      hint.innerHTML = state.isAdmin
        ? '✏️ <b>Modalita\' modifica (admin)</b> — tocca le caselle di qualunque colonna per inserire o togliere il turno. Premi <b>Ho finito</b> quando hai terminato.'
        : '✏️ <b>Modalita\' modifica</b> — tocca le caselle della <b>tua colonna</b> (evidenziata) per inserire o togliere il turno. Premi <b>Ho finito</b> quando hai terminato.';
    }
    render();
  }

  // ============================================================
  //  NOTE DEL GIORNO (colonna condivisa)
  // ============================================================
  function openNoteEditor(giorno) {
    state.editingNote = giorno;
    const d = parseInt(giorno.split('-')[2], 10);
    const date = new Date(state.year, state.month, d);
    $('note-day-label').textContent = `${GIORNI[date.getDay()]} ${d} ${MESI[state.month].toLowerCase()} ${state.year}`;
    $('note-text').value = state.notes[giorno] || '';
    $('modal-note').classList.remove('hidden');
    setTimeout(() => $('note-text').focus(), 40);
  }
  function closeNote() { $('modal-note').classList.add('hidden'); state.editingNote = null; }
  async function doSaveNote() {
    const g = state.editingNote; if (!g) return closeNote();
    const testo = $('note-text').value;
    if (testo.trim()) state.notes[g] = testo.trim(); else delete state.notes[g];
    render(); closeNote();
    try { await DB.saveNote(g, testo, state.me.email); }
    catch (e) { console.error(e); toast('Errore nel salvataggio della nota', true); loadMonth(); }
  }

  // ============================================================
  //  ADMIN — gestione turnisti
  // ============================================================
  function nextColor(users) {
    const used = new Set(users.map(u => (u.colore || '').toLowerCase()));
    return PALETTE.find(c => !used.has(c.toLowerCase())) || PALETTE[users.length % PALETTE.length];
  }

  async function openAdmin() {
    $('modal-admin').classList.remove('hidden');
    try { const users = await DB.listUsers(); renderUserList(users); $('u-colore').value = nextColor(users); }
    catch (e) { toast('Errore', true); }
  }
  function closeAdmin() { $('modal-admin').classList.add('hidden'); }

  function renderUserList(users) {
    const adminEmail = lower(CONFIG.ADMIN_EMAIL);
    const box = $('user-list'); box.innerHTML = '';
    users.forEach(u => {
      const isPerma = lower(u.email) === adminEmail;
      const name = u.nome || u.email.split('@')[0];
      const row = document.createElement('div'); row.className = 'user-row';
      row.innerHTML =
        `<input type="color" value="${esc(u.colore)}" title="Colore colonna">
         <input type="number" class="ord" value="${u.ordine != null ? u.ordine : 100}" min="0" step="1" title="Ordine colonna: numero piu' basso = colonna piu' a sinistra" style="width:54px">
         <div class="info">
           <input class="u-name" type="text" value="${esc(name)}" placeholder="Nome / etichetta">
           <input class="u-mail" type="email" value="${esc(u.email)}" autocomplete="off" ${isPerma ? 'readonly title="Email admin non modificabile"' : ''}>
         </div>
         <span class="tag ${u.attivo ? '' : 'off'}">${u.ruolo === 'admin' ? 'admin' : (u.attivo ? 'attivo' : 'disattivo')}</span>`;
      row.querySelector('input[type=color]').addEventListener('change', async (ev) => {
        try { await DB.updateUser(u.email, { colore: ev.target.value }); loadMonth(); }
        catch (e) { toast('Errore', true); }
      });
      row.querySelector('input.ord').addEventListener('change', async (ev) => {
        const v = parseInt(ev.target.value, 10); if (isNaN(v)) return;
        try { await DB.updateUser(u.email, { ordine: v }); renderUserList(await DB.listUsers()); loadMonth(); }
        catch (e) { toast('Errore', true); }
      });
      const nameInp = row.querySelector('.u-name');
      nameInp.addEventListener('change', async () => {
        try { await DB.updateUser(u.email, { nome: nameInp.value.trim() }); loadMonth(); }
        catch (e) { toast('Errore', true); }
      });
      const mailInp = row.querySelector('.u-mail');
      if (!isPerma) {
        mailInp.addEventListener('change', async () => {
          const v = lower(mailInp.value);
          if (!v || v === lower(u.email)) { mailInp.value = u.email; return; }
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { toast('Email non valida', true); mailInp.value = u.email; return; }
          try {
            await DB.updateUser(u.email, { email: v });
            toast('Email aggiornata ✓'); renderUserList(await DB.listUsers()); loadMonth();
          } catch (err) {
            console.error(err);
            toast(err.code === '23505' ? 'Email gia\' presente' : 'Errore', true); mailInp.value = u.email;
          }
        });
      }
      if (isPerma) {
        const lock = document.createElement('span'); lock.className = 'lock'; lock.textContent = '🔒'; lock.title = 'Admin perpetuo';
        row.appendChild(lock);
      } else {
        const toggle = document.createElement('button'); toggle.textContent = u.attivo ? '🚫' : '✅'; toggle.title = u.attivo ? 'Disattiva' : 'Attiva';
        toggle.addEventListener('click', async () => {
          try { await DB.updateUser(u.email, { attivo: !u.attivo }); renderUserList(await DB.listUsers()); loadMonth(); }
          catch (e) { toast('Errore', true); }
        });
        const del = document.createElement('button'); del.textContent = '🗑'; del.title = 'Elimina';
        del.addEventListener('click', async () => {
          if (!confirm(`Eliminare il turnista ${name}? Verranno rimossi anche i suoi turni.`)) return;
          try { await DB.deleteUser(u.email); renderUserList(await DB.listUsers()); loadMonth(); }
          catch (e) { toast('Errore', true); }
        });
        row.appendChild(toggle); row.appendChild(del);
      }
      box.appendChild(row);
    });
  }

  async function addUser(e) {
    e.preventDefault();
    const nome = $('u-nome').value.trim(), email = $('u-email').value.trim();
    if (!email) { toast('Inserisci un\'email', true); return; }
    try {
      // ordine automatico: il nuovo turnista va in fondo (colonna piu' a destra)
      const all = await DB.listUsers();
      const nextOrd = all.reduce((m, u) => Math.max(m, u.ordine || 0), 0) + 10;
      await DB.addUser({ nome, email, colore: $('u-colore').value, ruolo: $('u-ruolo').value, ordine: nextOrd });
      $('u-nome').value = ''; $('u-email').value = ''; $('u-ruolo').value = 'membro';
      toast('Turnista aggiunto ✓');
      const users = await DB.listUsers(); renderUserList(users); $('u-colore').value = nextColor(users);
      loadMonth();
    } catch (err) {
      console.error(err);
      toast(err.code === '23505' ? 'Email gia\' presente' : 'Errore (sei admin?)', true);
    }
  }

  // ============================================================
  //  WIRING + BOOT
  // ============================================================
  function wire() {
    $('btn-google').addEventListener('click', () => doGoogle(false));
    $('btn-google-switch').addEventListener('click', () => doGoogle(true));
    $('btn-logout-blocked').addEventListener('click', () => DB.signOut());
    $('btn-logout').addEventListener('click', () => DB.signOut());

    $('btn-update').addEventListener('click', applyUpdate);
    $('update-toast-reload').addEventListener('click', applyUpdate);
    $('update-toast-x').addEventListener('click', () => { state._toastDismissed = true; refreshUpdateToast(); });

    $('btn-prev').addEventListener('click', () => shiftMonth(-1));
    $('btn-next').addEventListener('click', () => shiftMonth(1));
    $('btn-today').addEventListener('click', goToday);
    $('btn-edit').addEventListener('click', toggleEdit);

    $('table-wrap').addEventListener('click', onTableClick);

    $('btn-admin').addEventListener('click', openAdmin);
    $('btn-admin-close').addEventListener('click', closeAdmin);
    $('modal-admin').addEventListener('click', (e) => { if (e.target.id === 'modal-admin') closeAdmin(); });
    $('admin-form').addEventListener('submit', addUser);

    $('btn-note-save').addEventListener('click', doSaveNote);
    $('btn-note-cancel').addEventListener('click', closeNote);
    $('btn-note-close').addEventListener('click', closeNote);
    $('modal-note').addEventListener('click', (e) => { if (e.target.id === 'modal-note') closeNote(); });
    $('note-text').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doSaveNote(); });

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeAdmin(); closeNote(); } });
  }

  function boot() {
    if (!window.supabase || !CONFIG.SUPABASE_URL) {
      document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">⚙️ Configurazione mancante: inserisci SUPABASE_URL e SUPABASE_ANON_KEY in <b>js/config.js</b> (Fase 2 del setup).</p>';
      return;
    }
    wire();
    DB.onAuth(handleSession);
    DB.getSession().then(handleSession);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
