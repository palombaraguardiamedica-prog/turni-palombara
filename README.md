# Turni Palombara

App web per la **turnazione della guardia medica di Palombara**.

Tabella mensile: ogni riga è un giorno (domeniche e festivi nazionali in rosso, calcolati in automatico), ogni colonna un turnista. In **modalità modifica** ogni turnista tocca le caselle della propria colonna per inserire/togliere il turno (X). La cella del numero del giorno è **bianca** (0 turnisti), **verde** (1) o **arancione** (>1); le caselle doppie di un giorno con più turnisti diventano arancioni. In fondo, il **totale** per colonna.

Login con **Google**: accedono solo gli indirizzi inseriti dall'amministratore (`marabelli.s@gmail.com`).

## Stack
HTML/CSS/JS puro · Supabase (Postgres + Auth Google + Realtime) · GitHub Pages.

## File
- `index.html` — markup (login, tabella, header, modal admin)
- `css/style.css` — tema chiaro verde/bianco
- `js/config.js` — URL/anon key Supabase + admin + festivi locali
- `js/db.js` — client Supabase, auth, query, realtime
- `js/app.js` — tabella, navigazione mesi, festivi, modalità modifica, totali, admin, aggiornamenti
- `supabase/schema.sql` — tabelle `utenti_autorizzati` + `turni`, RLS, GRANT, Realtime
- `supabase/app_version.sql` — badge "nuovo aggiornamento"
- `.github/workflows/bump-version.yml` — aggiorna `app_version` a ogni deploy

## Setup (4 fasi)
1. **GitHub** — account dedicato, repo `turni-palombara`, Personal Access Token (scope `repo` + `workflow`), GitHub Pages da `main` / root.
2. **Supabase** — nuovo progetto; copiare `SUPABASE_URL` e anon key in `js/config.js`; eseguire `supabase/schema.sql` e `supabase/app_version.sql` via Management API; mettere il ref in `bump-version.yml` e il secret `SUPABASE_MGMT_TOKEN` nel repo.
3. **Google OAuth** — Client OAuth Web su Google Cloud (origine = URL di Pages, redirect = `<supabase-url>/auth/v1/callback`); abilitare Google in Supabase Auth; Site URL + redirect = URL di Pages.
4. **Deploy & test** — push su `main`, login, aggiunta turnisti, inserimento turni.

## Festivi
Domeniche + festivi nazionali italiani (1/1, 6/1, Pasquetta, 25/4, 1/5, 2/6, 15/8, 1/11, 8/12, 25/12, 26/12). Per il patrono locale aggiungere la data in `FESTIVI_LOCALI` di `js/config.js` (formato `'MM-DD'`).
