-- ============================================================
--  app_version: notifica aggiornamenti (badge + toast)
--  La GitHub Action aggiorna 'sha' a ogni deploy -> Realtime ->
--  i client mostrano il badge "Update". Idempotente.
-- ============================================================

create table if not exists public.app_version (
  id         int primary key default 1,
  sha        text not null default '',
  updated_at timestamptz not null default now(),
  constraint solo_una_riga check (id = 1)
);
insert into public.app_version (id, sha) values (1, 'init') on conflict (id) do nothing;

grant select on public.app_version to anon, authenticated;
grant all    on public.app_version to service_role;

alter table public.app_version enable row level security;
drop policy if exists av_select on public.app_version;
create policy av_select on public.app_version for select to anon, authenticated using (true);

do $rt$
begin
  begin alter publication supabase_realtime add table public.app_version; exception when others then null; end;
end
$rt$;
