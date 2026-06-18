-- ============================================================
--  TURNI PALOMBARA - schema database (PostgreSQL / Supabase)
--  Eseguito via Management API. Idempotente (ri-eseguibile).
-- ============================================================

-- ---------- Tabelle ----------
create table if not exists public.utenti_autorizzati (
  email      text primary key,
  nome       text not null default '',
  colore     text not null default '#3f7d57',
  ruolo      text not null default 'membro' check (ruolo in ('admin','membro')),
  ordine     int  not null default 100,
  attivo     boolean not null default true,
  created_at timestamptz not null default now()
);
-- robustezza se la tabella esisteva da una versione precedente
alter table public.utenti_autorizzati add column if not exists ordine int not null default 100;

create table if not exists public.turni (
  id          uuid primary key default gen_random_uuid(),
  user_email  text not null,
  giorno      date not null,
  created_at  timestamptz not null default now(),
  unique (user_email, giorno)
);
create index if not exists idx_turni_giorno on public.turni (giorno);
create index if not exists idx_turni_email  on public.turni (user_email);

-- eliminando un turnista si rimuovono automaticamente i suoi turni
do $fk$
begin
  if not exists (select 1 from pg_constraint where conname = 'turni_user_fk') then
    alter table public.turni
      add constraint turni_user_fk foreign key (user_email)
      references public.utenti_autorizzati(email) on delete cascade on update cascade;
  end if;
end
$fk$;

-- ---------- Funzioni helper (security definer) ----------
create or replace function public.email_autorizzata() returns boolean
  language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.utenti_autorizzati u
    where lower(u.email) = lower(auth.jwt() ->> 'email') and u.attivo = true
  );
$fn$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.utenti_autorizzati u
    where lower(u.email) = lower(auth.jwt() ->> 'email')
      and u.ruolo = 'admin' and u.attivo = true
  );
$fn$;

-- ---------- Protezione admin perpetuo ----------
create or replace function public.proteggi_admin() returns trigger
  language plpgsql as $fn$
declare admin_email text := 'marabelli.s@gmail.com';
begin
  if (tg_op = 'DELETE') then
    if lower(old.email) = admin_email then
      raise exception 'Impossibile eliminare l''admin perpetuo';
    end if;
    return old;
  else -- UPDATE
    if lower(old.email) = admin_email then
      new.email  := old.email;
      new.ruolo  := 'admin';
      new.attivo := true;
    end if;
    return new;
  end if;
end;
$fn$;

drop trigger if exists trg_proteggi_admin on public.utenti_autorizzati;
create trigger trg_proteggi_admin
  before update or delete on public.utenti_autorizzati
  for each row execute function public.proteggi_admin();

-- ---------- Seed admin perpetuo ----------
insert into public.utenti_autorizzati (email, nome, colore, ruolo, ordine, attivo)
values ('marabelli.s@gmail.com', 'Marabelli S.', '#3f7d57', 'admin', 10, true)
on conflict (email) do update set ruolo = 'admin', attivo = true;

-- ---------- Row Level Security ----------
alter table public.utenti_autorizzati enable row level security;
alter table public.turni              enable row level security;

drop policy if exists ua_select   on public.utenti_autorizzati;
drop policy if exists ua_admin_all on public.utenti_autorizzati;
create policy ua_select on public.utenti_autorizzati
  for select to authenticated using (public.email_autorizzata());
create policy ua_admin_all on public.utenti_autorizzati
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists turni_select on public.turni;
drop policy if exists turni_insert on public.turni;
drop policy if exists turni_update on public.turni;
drop policy if exists turni_delete on public.turni;
create policy turni_select on public.turni
  for select to authenticated using (public.email_autorizzata());
create policy turni_insert on public.turni
  for insert to authenticated
  with check (public.email_autorizzata()
              and (lower(user_email) = lower(auth.jwt() ->> 'email') or public.is_admin()));
create policy turni_update on public.turni
  for update to authenticated
  using (public.email_autorizzata()
         and (lower(user_email) = lower(auth.jwt() ->> 'email') or public.is_admin()))
  with check (public.email_autorizzata()
              and (lower(user_email) = lower(auth.jwt() ->> 'email') or public.is_admin()));
create policy turni_delete on public.turni
  for delete to authenticated
  using (public.email_autorizzata()
         and (lower(user_email) = lower(auth.jwt() ->> 'email') or public.is_admin()));

-- ---------- GRANT espliciti (policy post-30/10/2026) ----------
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.utenti_autorizzati to authenticated;
grant select, insert, update, delete on public.turni              to authenticated;
grant all on public.utenti_autorizzati to service_role;
grant all on public.turni              to service_role;

-- ---------- Realtime ----------
do $rt$
begin
  begin alter publication supabase_realtime add table public.turni;              exception when others then null; end;
  begin alter publication supabase_realtime add table public.utenti_autorizzati; exception when others then null; end;
end
$rt$;

-- ---------- Note per giorno (colonna condivisa "NOTE / DESIDERATA") ----------
create table if not exists public.note_giorni (
  giorno     date primary key,
  testo      text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.note_giorni enable row level security;
drop policy if exists note_select on public.note_giorni;
drop policy if exists note_write  on public.note_giorni;
create policy note_select on public.note_giorni for select to authenticated using (public.email_autorizzata());
create policy note_write  on public.note_giorni for all    to authenticated using (public.email_autorizzata()) with check (public.email_autorizzata());
grant select, insert, update, delete on public.note_giorni to authenticated;
grant all on public.note_giorni to service_role;
do $rtn$
begin
  begin alter publication supabase_realtime add table public.note_giorni; exception when others then null; end;
end
$rtn$;
