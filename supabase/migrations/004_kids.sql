-- Модуль «Дети»: данные семьи одним объектом JSON. Идемпотентно. Выполнить в Supabase → SQL Editor после 001–003.
-- Таблицы и функции «Кухни» и «Уборки» НЕ меняются.
--
-- kids_data: одна строка на семью. data — дети, занятия, события, отметки «Собрано», список «Кто отвозит».
-- version растёт на 1 при каждой записи: защита от одновременной правки с двух телефонов.

create table if not exists public.kids_data (
  household_id uuid primary key references public.households(id) on delete cascade,
  data         jsonb  not null default '{}'::jsonb,
  version      bigint not null default 0,
  updated_at   timestamptz not null default now()
);
alter table public.kids_data enable row level security;

drop policy if exists kids_data_select on public.kids_data;
create policy kids_data_select on public.kids_data for select to authenticated using (public.is_member(household_id));

revoke all on public.kids_data from anon, authenticated;
grant select on public.kids_data to authenticated;

-- Прочитать: { data, version }. Если семья ещё не открывала «Детей» — data = null, version = 0.
create or replace function public.kids_get() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  hid uuid;
  r public.kids_data%rowtype;
begin
  select m.household_id into hid from public.members m where m.user_id = auth.uid();
  if hid is null then raise exception 'Нет доступа к семье. Войдите заново'; end if;
  select * into r from public.kids_data c where c.household_id = hid;
  if not found then return jsonb_build_object('data', null, 'version', 0); end if;
  return jsonb_build_object('data', r.data, 'version', r.version);
end $$;

-- Записать целиком с проверкой версии. Возвращает новую версию. Несовпадение версии → 'version_conflict'.
create or replace function public.kids_save(expected_version bigint, new_data jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  cur bigint;
begin
  if uid is null then raise exception 'Войдите заново'; end if;
  select m.household_id into hid from public.members m where m.user_id = uid;
  if hid is null then raise exception 'Нет доступа к семье'; end if;
  if jsonb_typeof(new_data) is distinct from 'object' then raise exception 'Пустые данные'; end if;
  if octet_length(new_data::text) > 500000 then raise exception 'Слишком много данных'; end if;

  -- строка семьи создаётся при первой записи; блокируем её на время проверки
  insert into public.kids_data (household_id) values (hid) on conflict (household_id) do nothing;
  select c.version into cur from public.kids_data c where c.household_id = hid for update;
  if cur is distinct from expected_version then raise exception 'version_conflict'; end if;

  update public.kids_data c set data = new_data, version = cur + 1, updated_at = now() where c.household_id = hid;
  return cur + 1;
end $$;

revoke execute on function public.kids_get(), public.kids_save(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.kids_get(), public.kids_save(bigint, jsonb) to authenticated;
