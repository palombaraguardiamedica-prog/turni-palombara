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
  const EVENT_TITLE = 'Guardia medica';
  const LS_HINT = 'turni_palombara_gcal_id';
  const LS_COLOR = 'turni_palombara_gcal_color';

  // Palette colori EVENTI Google Calendar (colorId 1-11) → lo swatch
  // scelto coincide col colore reale dei turni sul calendario.
  const CAL_COLORS = [
    { colorId: '7', hex: '#039be5', nome: 'Pavone' },
    { colorId: '9', hex: '#3f51b5', nome: 'Mirtillo' },
    { colorId: '1', hex: '#7986cb', nome: 'Lavanda' },
    { colorId: '10', hex: '#0b8043', nome: 'Basilico' },
    { colorId: '2', hex: '#33b679', nome: 'Salvia' },
    { colorId: '5', hex: '#f6bf26', nome: 'Banana' },
    { colorId: '6', hex: '#f4511e', nome: 'Mandarino' },
    { colorId: '11', hex: '#d50000', nome: 'Pomodoro' },
    { colorId: '4', hex: '#e67c73', nome: 'Salmone' },
    { colorId: '3', hex: '#8e24aa', nome: 'Uva' },
    { colorId: '8', hex: '#616161', nome: 'Grafite' }
  ];
  const hexFor = (id) => (CAL_COLORS.find(c => c.colorId === id) || CAL_COLORS[0]).hex;
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
  async function requestToken(clientId) {
    if (!clientId) throw new Error('Client ID Google non configurato');
    await loadGis();
    const oauth2 = window.google.accounts.oauth2;
    return new Promise((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: clientId, scope: SCOPE,
        callback: (resp) => { if (resp.access_token) resolve(resp.access_token); else reject(new Error(resp.error || 'Autorizzazione negata')); },
        error_callback: (err) => reject(new Error((err && (err.message || err.type)) || 'Autorizzazione annullata'))
      });
      client.requestAccessToken({ prompt: '' });
    });
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
  async function applyColor(token, calId, colorId) {
    if (!colorId) return; const hex = hexFor(colorId);
    try {
      await gcal(token, 'PATCH', '/users/me/calendarList/' + encodeURIComponent(calId) + '?colorRgbFormat=true',
        { backgroundColor: hex, foregroundColor: readableFg(hex) });
    } catch (_) { /* colore del calendario non applicabile: gli eventi restano comunque colorati */ }
  }

  function calGone() { return new Error('CALENDAR_GONE'); }
  function isGone(e) { return e && e.message === 'CALENDAR_GONE'; }

  async function findOrCreateCalendar(token, colorId, forceCreate) {
    if (!forceCreate) {
      try {
        const hint = localStorage.getItem(LS_HINT);
        if (hint) {
          try { await gcal(token, 'GET', '/calendars/' + encodeURIComponent(hint)); await applyColor(token, hint, colorId); return hint; }
          catch (_) { localStorage.removeItem(LS_HINT); }
        }
      } catch (_) {}
    }
    try {
      const list = await gcal(token, 'GET', '/users/me/calendarList?maxResults=250');
      const found = (list.items || []).find(c => c.summary === CAL_SUMMARY);
      if (found) { try { localStorage.setItem(LS_HINT, found.id); } catch (_) {} await applyColor(token, found.id, colorId); return found.id; }
    } catch (_) {}
    const created = await gcal(token, 'POST', '/calendars', {
      summary: CAL_SUMMARY, timeZone: TZ,
      description: 'Turni guardia medica di Palombara — sincronizzati dall\'app Turni Palombara. Non modificare a mano: gli eventi vengono sovrascritti a ogni sincronizzazione.'
    });
    try { localStorage.setItem(LS_HINT, created.id); } catch (_) {}
    await applyColor(token, created.id, colorId);
    return created.id;
  }

  // ---------- eventi (id deterministico, all-day) ----------
  function toHex(s) { let o = ''; for (let i = 0; i < s.length; i++) o += s.charCodeAt(i).toString(16).padStart(2, '0'); return o; }
  function eventId(email, giorno) { return 'tp' + toHex(email.toLowerCase()) + giorno.replace(/-/g, ''); }
  function nextDay(giorno) { const [y, m, d] = giorno.split('-').map(Number); const dt = new Date(y, m - 1, d + 1); return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate()); }
  function eventBody(email, giorno, colorId) {
    return {
      id: eventId(email, giorno), summary: EVENT_TITLE, colorId: colorId,
      start: { date: giorno }, end: { date: nextDay(giorno) },
      extendedProperties: { private: { app: APP_TAG, sig: 'c' + colorId } },
      reminders: { useDefault: false }, transparency: 'transparent'
    };
  }

  async function listManaged(token, calId, timeMin, timeMax) {
    const map = new Map(); let pageToken;
    do {
      const qs = new URLSearchParams({ privateExtendedProperty: 'app=' + APP_TAG, singleEvents: 'true', showDeleted: 'false', maxResults: '2500', timeMin, timeMax });
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

  async function runOnce(token, email, year, month, dates, colorId, forceCreate, onProgress) {
    onProgress && onProgress({ phase: 'calendar' });
    const calId = await findOrCreateCalendar(token, colorId, forceCreate);

    const firstStr = year + '-' + pad2(month + 1) + '-01';
    const nm = new Date(year, month + 1, 1);
    const nextMStr = nm.getFullYear() + '-' + pad2(nm.getMonth() + 1) + '-01';
    const timeMin = new Date(year, month, 1).toISOString();
    const timeMax = new Date(year, month + 1, 2).toISOString();

    onProgress && onProgress({ phase: 'reading' });
    const existing = forceCreate ? new Map() : await listManaged(token, calId, timeMin, timeMax);
    // tieni solo eventi del mese corrente (per non toccare gli altri mesi)
    const existingMonth = new Map();
    for (const [id, ev] of existing) { const d = ev.start && ev.start.date; if (d && d >= firstStr && d < nextMStr) existingMonth.set(id, ev); }

    const desired = new Map();
    for (const g of dates) desired.set(eventId(email, g), { giorno: g, sig: 'c' + colorId });

    const toCreate = [], toUpdate = [], toDelete = [];
    for (const [id, d] of desired) {
      const ex = existingMonth.get(id);
      if (!ex) toCreate.push(d);
      else if (!(ex.extendedProperties && ex.extendedProperties.private && ex.extendedProperties.private.sig === d.sig)) toUpdate.push(d);
    }
    for (const [id] of existingMonth) if (!desired.has(id)) toDelete.push(id);

    const total = toCreate.length + toUpdate.length + toDelete.length; let done = 0;
    const tick = () => { done++; onProgress && onProgress({ phase: 'writing', done, total }); };
    onProgress && onProgress({ phase: 'writing', done: 0, total });
    const path = '/calendars/' + encodeURIComponent(calId) + '/events';
    const createEvent = async (d) => {
      try { await gcal(token, 'POST', path, eventBody(email, d.giorno, colorId)); }
      catch (e) {
        if (/HTTP 409/.test(e.message)) await gcal(token, 'PUT', path + '/' + eventId(email, d.giorno), eventBody(email, d.giorno, colorId));
        else if (/HTTP 404/.test(e.message)) throw calGone();
        else throw e;
      }
    };
    const W = 2;
    await pool(toCreate, W, async d => { await createEvent(d); tick(); });
    await pool(toUpdate, W, async d => {
      try { await gcal(token, 'PUT', path + '/' + eventId(email, d.giorno), eventBody(email, d.giorno, colorId)); }
      catch (e) { if (/HTTP 404/.test(e.message)) await createEvent(d); else throw e; }
      tick();
    });
    await pool(toDelete, W, async id => {
      try { await gcal(token, 'DELETE', path + '/' + id); }
      catch (e) { if (!/HTTP 4(04|10)/.test(e.message)) throw e; }
      tick();
    });

    onProgress && onProgress({ phase: 'done' });
    return { calendarId: calId, created: toCreate.length, updated: toUpdate.length, deleted: toDelete.length, unchanged: desired.size - toCreate.length - toUpdate.length };
  }

  async function syncMonth(opts) {
    const { clientId, email, year, month, dates, colorId, onProgress } = opts;
    onProgress && onProgress({ phase: 'auth' });
    const token = await requestToken(clientId);
    saveColor(colorId);
    try { return await runOnce(token, email, year, month, dates, colorId, false, onProgress); }
    catch (e) {
      if (isGone(e)) { try { localStorage.removeItem(LS_HINT); } catch (_) {} return await runOnce(token, email, year, month, dates, colorId, true, onProgress); }
      throw e;
    }
  }

  window.GCAL = { CAL_COLORS, getSavedColor, syncMonth, CAL_SUMMARY };
})();
