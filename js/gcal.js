// ============================================================
//  gcal.js — sincronizzazione turni con Google Calendar
//  100% client-side (GitHub Pages, niente backend).
//   1. Google Identity Services (GIS) -> access token on-demand
//      con scope calendar.
//   2. Calendar REST API: crea/colora il calendario "TURNI PALOMBARA"
//      e fa il diff degli eventi (solo i TUOI turni del mese).
//  Tocca SOLO il calendario "TURNI PALOMBARA" e gli eventi taggati
//  app=turni-palombara: gli altri calendari/eventi non si toccano.
// ============================================================
(function () {
  const SCOPE = 'https://www.googleapis.com/auth/calendar';
  const CAL_API = 'https://www.googleapis.com/calendar/v3';
  const CAL_SUMMARY = 'TURNI PALOMBARA';
  const TZ = 'Europe/Rome';
  const APP_TAG = 'turni-palombara';
  // Ogni giorno di turno = turno notturno: "Notte Palombara" 20-22 (stesso
  // giorno) + "SN" (smonto notte) 08-10 il mattino dopo.
  const NIGHT = { title: 'Notte Palombara', start: '20:00', end: '22:00' };
  const SN = { title: 'SN', start: '08:00', end: '10:00' };
  const LS_HINT = 'turni_palombara_gcal_id';
  const LS_COLOR = 'turni_palombara_gcal_color';

  // Palette colori. Gli EVENTI ereditano il colore del CALENDARIO (custom
  // backgroundColor): cosi' swatch = calendario = eventi, lo STESSO identico
  // hex, senza lo scarto tra swatch e render del colorId di Google. Si
  // possono quindi usare hex arbitrari, incluso il verde dell'app.
  const CAL_COLORS = [
    { hex: '#3f7d57', nome: 'Verde Palombara' },
    { hex: '#0b8043', nome: 'Basilico' },
    { hex: '#33b679', nome: 'Salvia' },
    { hex: '#039be5', nome: 'Pavone' },
    { hex: '#3f51b5', nome: 'Mirtillo' },
    { hex: '#7986cb', nome: 'Lavanda' },
    { hex: '#f6bf26', nome: 'Banana' },
    { hex: '#f4511e', nome: 'Mandarino' },
    { hex: '#d50000', nome: 'Pomodoro' },
    { hex: '#e67c73', nome: 'Salmone' },
    { hex: '#8e24aa', nome: 'Uva' },
    { hex: '#616161', nome: 'Grafite' }
  ];
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const pad2 = (n) => String(n).padStart(2, '0');

  function getSavedColor() { try { return localStorage.getItem(LS_COLOR); } catch (_) { return null; } }
  function saveColor(id) { if (id) try { localStorage.setItem(LS_COLOR, id); } catch (_) {} }

  // ---------- Google Identity Services (token client) ----------
  let gisLoading = null;
  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (gisLoading) return gisLoading;
    gisLoading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
      s.onload = () => res();
      s.onerror = () => rej(new Error('Impossibile caricare Google Identity Services'));
      document.head.appendChild(s);
    });
    return gisLoading;
  }
  // Cache del token in memoria: Google chiede il consenso solo la PRIMA volta,
  // poi riusiamo il token finche' valido (~1h) -> niente popup ad ogni sync.
  let _token = null, _tokenExp = 0;
  function hasToken() { return !!_token && Date.now() < _tokenExp; }
  async function requestToken(clientId) {
    if (hasToken()) return _token;
    if (!clientId) throw new Error('Client ID Google non configurato');
    await loadGis();
    const oauth2 = window.google.accounts.oauth2;
    return new Promise((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE,
        callback: (resp) => {
          if (resp.access_token) {
            _token = resp.access_token;
            _tokenExp = Date.now() + ((resp.expires_in ? resp.expires_in : 3600) * 1000) - 60000;
            resolve(_token);
          } else reject(new Error(resp.error || 'Autorizzazione negata'));
        },
        error_callback: (err) => reject(new Error((err && (err.message || err.type)) || 'Autorizzazione annullata'))
      });
      client.requestAccessToken({ prompt: '' });
    });
  }

  // Calendari su cui l'utente puo' SCRIVERE (owner/writer).
  async function listCalendars(clientId) {
    const token = await requestToken(clientId);
    const res = await gcal(token, 'GET', '/users/me/calendarList?maxResults=250&minAccessRole=writer');
    return (res.items || []).map(c => ({ id: c.id, summary: c.summary || c.id, primary: !!c.primary }));
  }

  // ---------- REST helper (retry con backoff su 429/5xx/rate-limit) ----------
  const MAX_RETRY = 6;
  async function gcal(token, method, path, body, attempt) {
    attempt = attempt || 0;
    const res = await fetch(CAL_API + path, {
      method,
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const transient = res.status === 429 || res.status >= 500 ||
        (res.status === 403 && /rate ?limit|userratelimit|quota/i.test(txt));
      if (transient && attempt < MAX_RETRY) {
        await sleep(Math.min(30000, 800 * Math.pow(2, attempt)) + Math.floor(Math.random() * 400));
        return gcal(token, method, path, body, attempt + 1);
      }
      const err = new Error('Google Calendar ' + method + ' ' + path.split('?')[0] + ' → HTTP ' + res.status + ' ' + txt.slice(0, 140));
      err.status = res.status; throw err;
    }
    if (res.status === 204) return undefined;
    return res.json();
  }

  function readableFg(hex) {
    const h = hex.replace('#', ''); if (h.length < 6) return '#1d1d1d';
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return ((0.299 * r + 0.587 * g + 0.114 * b) / 255) > 0.6 ? '#1d1d1d' : '#ffffff';
  }
  async function applyColor(token, calId, hex) {
    if (!hex) return;
    try {
      await gcal(token, 'PATCH', '/users/me/calendarList/' + encodeURIComponent(calId) + '?colorRgbFormat=true',
        { backgroundColor: hex, foregroundColor: readableFg(hex) });
    } catch (_) { /* colore non applicabile con lo scope corrente: ignora */ }
  }

  function calGone() { return new Error('CALENDAR_GONE'); }
  function isGone(e) { return e && e.message === 'CALENDAR_GONE'; }

  async function findOrCreateCalendar(token, color, forceCreate) {
    if (!forceCreate) {
      try {
        const hint = localStorage.getItem(LS_HINT);
        if (hint) {
          try { await gcal(token, 'GET', '/calendars/' + encodeURIComponent(hint)); await applyColor(token, hint, color); return hint; }
          catch (_) { localStorage.removeItem(LS_HINT); }
        }
      } catch (_) {}
    }
    try {
      const list = await gcal(token, 'GET', '/users/me/calendarList?maxResults=250');
      const found = (list.items || []).find(c => c.summary === CAL_SUMMARY);
      if (found) { try { localStorage.setItem(LS_HINT, found.id); } catch (_) {} await applyColor(token, found.id, color); return found.id; }
    } catch (_) {}
    const created = await gcal(token, 'POST', '/calendars', {
      summary: CAL_SUMMARY, timeZone: TZ,
      description: 'Turni guardia medica di Palombara — sincronizzati dall\'app Turni Palombara. Non modificare a mano: gli eventi vengono sovrascritti a ogni sincronizzazione.'
    });
    try { localStorage.setItem(LS_HINT, created.id); } catch (_) {}
    await applyColor(token, created.id, color);
    return created.id;
  }

  // ---------- eventi (id deterministico legato al giorno del turno) ----------
  function toHex(s) { let o = ''; for (let i = 0; i < s.length; i++) o += s.charCodeAt(i).toString(16).padStart(2, '0'); return o; }
  function nightId(email, giorno) { return 'tpn' + toHex(email.toLowerCase()) + giorno.replace(/-/g, ''); }
  function snId(email, giorno) { return 'tps' + toHex(email.toLowerCase()) + giorno.replace(/-/g, ''); }
  function nextDay(giorno) { const [y, m, d] = giorno.split('-').map(Number); const dt = new Date(y, m - 1, d + 1); return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()); }

  // Per ogni giorno di turno: "Notte Palombara" 20-22 (stesso giorno) +
  // "SN" 08-10 (mattino dopo). L'id e' legato al GIORNO DEL TURNO (non alla
  // data dell'evento): cosi' togliendo la X spariscono entrambi.
  function buildDesired(email, dates) {
    const m = new Map();
    for (const g of dates) {
      m.set(nightId(email, g), { id: nightId(email, g), date: g, start: NIGHT.start, end: NIGHT.end, title: NIGHT.title, sig: 'notte' });
      m.set(snId(email, g), { id: snId(email, g), date: nextDay(g), start: SN.start, end: SN.end, title: SN.title, sig: 'sn' });
    }
    return m;
  }
  // niente colorId: l'evento eredita il colore (custom) del calendario
  function eventBody(d, monthKey) {
    return {
      id: d.id, summary: d.title,
      start: { dateTime: d.date + 'T' + d.start + ':00', timeZone: TZ },
      end: { dateTime: d.date + 'T' + d.end + ':00', timeZone: TZ },
      extendedProperties: { private: { app: APP_TAG, m: monthKey, sig: d.sig } },
      reminders: { useDefault: false }
    };
  }

  // Eventi gestiti dall'app per QUESTO mese (tag app + m=YYYY-MM): cosi' il
  // diff e' corretto anche per gli "SN" che cadono nel mese successivo.
  async function listManaged(token, calId, monthKey) {
    const map = new Map(); let pageToken;
    do {
      const qs = new URLSearchParams({ singleEvents: 'true', showDeleted: 'false', maxResults: '2500' });
      qs.append('privateExtendedProperty', 'app=' + APP_TAG);
      qs.append('privateExtendedProperty', 'm=' + monthKey);
      if (pageToken) qs.set('pageToken', pageToken);
      let res;
      try { res = await gcal(token, 'GET', '/calendars/' + encodeURIComponent(calId) + '/events?' + qs.toString()); }
      catch (e) { if (/HTTP 404/.test(e.message)) throw calGone(); throw e; }
      for (const ev of (res.items || [])) map.set(ev.id, ev);
      pageToken = res.nextPageToken;
    } while (pageToken);
    return map;
  }

  async function pool(items, size, fn) {
    let i = 0;
    const workers = Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const idx = i++; await fn(items[idx]); } });
    await Promise.all(workers);
  }

  // Diff dei turni di un mese su UN calendario gia' risolto (calId).
  async function diffOnCalendar(token, calId, email, monthKey, dates, onProgress, skipRead) {
    onProgress && onProgress({ phase: 'reading' });
    const existing = skipRead ? new Map() : await listManaged(token, calId, monthKey);
    const desired = buildDesired(email, dates);

    const toCreate = [], toUpdate = [], toDelete = [];
    for (const [id, d] of desired) {
      const ex = existing.get(id);
      if (!ex) toCreate.push(d);
      else if (!(ex.extendedProperties && ex.extendedProperties.private && ex.extendedProperties.private.sig === d.sig)) toUpdate.push(d);
    }
    for (const [id] of existing) if (!desired.has(id)) toDelete.push(id);

    const total = toCreate.length + toUpdate.length + toDelete.length; let done = 0;
    const tick = () => { done++; onProgress && onProgress({ phase: 'writing', done, total }); };
    onProgress && onProgress({ phase: 'writing', done: 0, total });
    const path = '/calendars/' + encodeURIComponent(calId) + '/events';
    const createEvent = async (d) => {
      try { await gcal(token, 'POST', path, eventBody(d, monthKey)); }
      catch (e) {
        if (/HTTP 409/.test(e.message)) await gcal(token, 'PUT', path + '/' + d.id, eventBody(d, monthKey));
        else if (/HTTP 404/.test(e.message)) throw calGone();
        else throw e;
      }
    };
    const W = 2;
    await pool(toCreate, W, async d => { await createEvent(d); tick(); });
    await pool(toUpdate, W, async d => {
      try { await gcal(token, 'PUT', path + '/' + d.id, eventBody(d, monthKey)); }
      catch (e) { if (/HTTP 404/.test(e.message)) await createEvent(d); else throw e; }
      tick();
    });
    await pool(toDelete, W, async id => {
      try { await gcal(token, 'DELETE', path + '/' + id); }
      catch (e) { if (!/HTTP 4(04|10)/.test(e.message)) throw e; }
      tick();
    });

    onProgress && onProgress({ phase: 'done' });
    return { calId, created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length, unchanged: desired.size - toCreate.length - toUpdate.length };
  }

  // Rimuove TUTTI i turni di un mese da un calendario (per spostarli altrove).
  async function deleteMonthEvents(token, calId, monthKey) {
    const existing = await listManaged(token, calId, monthKey);
    const path = '/calendars/' + encodeURIComponent(calId) + '/events';
    await pool([...existing.keys()], 2, async id => {
      try { await gcal(token, 'DELETE', path + '/' + id); }
      catch (e) { if (!/HTTP 4(04|10)/.test(e.message)) throw e; }
    });
  }

  // Sincronizza il mese sul calendario scelto.
  //   target = { palombara:true, color }    -> crea/usa «TURNI PALOMBARA» col colore
  //   target = { palombara:false, calId }   -> usa un calendario esistente (eredita il suo colore)
  //   prevCalId = calendario su cui era sincronizzato il mese (dal DB): se diverso, sposta gli eventi.
  async function syncMonth(opts) {
    const { clientId, email, year, month, dates, target, prevCalId, onProgress } = opts;
    onProgress && onProgress({ phase: 'auth' });
    const token = await requestToken(clientId);
    const monthKey = year + '-' + pad2(month + 1);

    onProgress && onProgress({ phase: 'calendar' });
    let calId;
    if (target.palombara) { saveColor(target.color); calId = await findOrCreateCalendar(token, target.color, false); }
    else { calId = target.calId; }

    // se per questo mese si cambia calendario, togli gli eventi dal precedente
    if (prevCalId && prevCalId !== calId) {
      try { await deleteMonthEvents(token, prevCalId, monthKey); } catch (_) { /* calendario precedente non piu' disponibile: ignora */ }
    }

    try {
      return await diffOnCalendar(token, calId, email, monthKey, dates, onProgress, false);
    } catch (e) {
      if (isGone(e) && target.palombara) {
        try { localStorage.removeItem(LS_HINT); } catch (_) {}
        const calId2 = await findOrCreateCalendar(token, target.color, true);
        return await diffOnCalendar(token, calId2, email, monthKey, dates, onProgress, true);
      }
      throw e;
    }
  }

  window.GCAL = { CAL_COLORS, getSavedColor, syncMonth, listCalendars, hasToken, CAL_SUMMARY };
})();
