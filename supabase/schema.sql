-- =====================================================================
--  Champions Hub · cuentas de usuario (Supabase)
--
--  Guarda TODO lo que cambias en la web (Pokémon y builds, equipos, historial,
--  ajustes y equipos de "Contra la IA") en tu cuenta, para verlo en cualquier
--  dispositivo.
--
--  Cómo usarlo: Supabase > SQL Editor > pega este archivo > Run.
--
--  Seguridad:
--   - Row Level Security: cada usuario solo puede leer y escribir SUS filas
--     (user_id = auth.uid()). La "anon key" de la web es pública por diseño:
--     sin una sesión válida no da acceso a nada.
--   - Contraseñas: las guarda y verifica Supabase Auth (hash bcrypt), con
--     confirmación de correo y límite de intentos. La web nunca las almacena.
--   - Límite de tamaño por documento para que nadie llene la base de datos.
-- =====================================================================

create table if not exists public.user_docs (
  user_id     uuid not null references auth.users(id) on delete cascade,
  collection  text not null check (collection in ('pokemon', 'teams', 'battles', 'settings', 'kv')),
  id          text not null check (char_length(id) between 1 and 200),
  data        jsonb not null check (pg_column_size(data) < 200000),
  updated_at  timestamptz not null default now(),
  primary key (user_id, collection, id)
);
create index if not exists user_docs_user on public.user_docs (user_id, collection);

alter table public.user_docs enable row level security;

drop policy if exists "leer lo mío" on public.user_docs;
create policy "leer lo mío" on public.user_docs for select
  to authenticated using (user_id = auth.uid());
drop policy if exists "crear lo mío" on public.user_docs;
create policy "crear lo mío" on public.user_docs for insert
  to authenticated with check (user_id = auth.uid());
drop policy if exists "cambiar lo mío" on public.user_docs;
create policy "cambiar lo mío" on public.user_docs for update
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "borrar lo mío" on public.user_docs;
create policy "borrar lo mío" on public.user_docs for delete
  to authenticated using (user_id = auth.uid());

-- Nadie sin sesión toca la tabla (ni siquiera para listar).
revoke all on public.user_docs from anon;
grant select, insert, update, delete on public.user_docs to authenticated;

-- Fecha de modificación siempre del servidor (no se puede falsear desde la web).
create or replace function public.user_docs_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists user_docs_touch on public.user_docs;
create trigger user_docs_touch before insert or update on public.user_docs
  for each row execute function public.user_docs_touch();

-- Máximo de documentos por usuario (evita abusos): 5.000.
create or replace function public.user_docs_quota() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.user_docs where user_id = new.user_id) >= 5000 then
    raise exception 'Límite de 5.000 elementos por cuenta';
  end if;
  return new;
end;
$$;
drop trigger if exists user_docs_quota on public.user_docs;
create trigger user_docs_quota before insert on public.user_docs
  for each row execute function public.user_docs_quota();

-- Borrar mi cuenta: elimina el usuario y, en cascada, todos sus datos.
-- Solo puede borrarse a sí mismo (usa auth.uid(); no recibe parámetros).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'Sin sesión';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
revoke execute on function public.user_docs_quota() from public, anon, authenticated;
