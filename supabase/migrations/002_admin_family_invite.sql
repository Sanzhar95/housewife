-- Кнопка «Новая семья для друга»: создавать ссылки на новые семьи могут только записанные в app_admins.
-- Идемпотентно. Выполнить в Supabase → SQL Editor после 001.

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;     -- политик нет: из браузера таблица недоступна
revoke all on public.app_admins from anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid())
$$;

-- Ссылка на НОВУЮ отдельную семью (только админ). Токен показывается один раз, в базе — только sha256.
create or replace function public.admin_create_family_invite(family_name text) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := public._token();
begin
  if auth.uid() is null then raise exception 'Войдите заново'; end if;
  if not public.is_admin() then raise exception 'Недостаточно прав'; end if;
  insert into public.invites (household_id, kind, family_name, token_hash, created_by, expires_at)
  values (null, 'new_family', left(trim(coalesce(family_name, '')), 80), public._hash(tok), auth.uid(), now() + interval '7 days');
  return tok;
end $$;

revoke execute on function public.is_admin(), public.admin_create_family_invite(text) from public, anon, authenticated;
grant execute on function public.is_admin(), public.admin_create_family_invite(text) to authenticated;

-- Назначить себя админом (выполнить один раз, подставив свою почту):
--   insert into public.app_admins (user_id) select id from auth.users where email = 'ВАША_ПОЧТА' on conflict do nothing;
