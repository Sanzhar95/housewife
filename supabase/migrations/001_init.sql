-- «Домашняя кухня», этап 2: схема, защита по семье (RLS), чтение и запись одной транзакцией, приглашения.
-- Идемпотентно: можно запускать повторно. Выполнять в Supabase → SQL Editor целиком.

-- ───────────────────────── Таблицы ─────────────────────────
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  week_start text not null default '',
  portions int,
  email text,
  tz text not null default 'Asia/Almaty',
  version bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  kind text not null check (kind in ('join', 'new_family')),
  family_name text not null default '',
  token_hash text not null unique,
  created_by uuid,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid,
  created_at timestamptz not null default now(),
  check ((kind = 'join' and household_id is not null) or (kind = 'new_family' and household_id is null))
);

create table if not exists public.products (
  household_id uuid not null references public.households(id) on delete cascade,
  id text not null,
  name text not null default '',
  unit text not null default 'ШТ',
  stock double precision not null default 0,
  min_stock double precision not null default 0,
  seq bigint generated always as identity,
  primary key (household_id, id)
);

create table if not exists public.dishes (
  household_id uuid not null references public.households(id) on delete cascade,
  id text not null,
  name text not null default '',
  note text not null default '',
  type text not null default 'main',
  meals text[] not null default '{}',
  with_side boolean not null default false,
  recipe_portions double precision not null default 0,
  times double precision not null default 1,
  seq bigint generated always as identity,
  primary key (household_id, id)
);

create table if not exists public.dish_items (
  household_id uuid not null references public.households(id) on delete cascade,
  dish_id text not null,
  product_id text not null,
  qty double precision not null default 0,
  recipe_unit text not null default '',
  seq bigint generated always as identity,
  primary key (household_id, dish_id, product_id)
);

create table if not exists public.plan (
  household_id uuid not null references public.households(id) on delete cascade,
  id text not null,
  day int not null default 0,
  meal text not null default '',
  kind text not null default 'main',
  dish_id text not null default '',
  side_id text not null default '',
  done boolean not null default false,
  done_at text not null default '',
  leftover boolean not null default false,
  portions double precision not null default 0,
  from_id text not null default '',
  seq bigint generated always as identity,
  primary key (household_id, id)
);

create table if not exists public.purchases (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  when_str text not null default '',
  product_id text not null default '',
  qty double precision not null default 0,
  unit text not null default '',
  total double precision,
  unit_price double precision
);
create index if not exists purchases_h_idx on public.purchases (household_id, id);

create table if not exists public.log (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  when_str text not null default '',
  action text not null default '',
  obj text not null default '',
  details text not null default ''
);
create index if not exists log_h_idx on public.log (household_id, id);

-- ───────────────────────── Защита ─────────────────────────
alter table public.households enable row level security;
alter table public.members    enable row level security;
alter table public.invites    enable row level security;
alter table public.products   enable row level security;
alter table public.dishes     enable row level security;
alter table public.dish_items enable row level security;
alter table public.plan       enable row level security;
alter table public.purchases  enable row level security;
alter table public.log        enable row level security;

create or replace function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.household_id = h)
$$;

drop policy if exists households_select on public.households;
create policy households_select on public.households for select to authenticated using (public.is_member(id));
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated using (user_id = auth.uid());
drop policy if exists products_select on public.products;
create policy products_select on public.products for select to authenticated using (public.is_member(household_id));
drop policy if exists dishes_select on public.dishes;
create policy dishes_select on public.dishes for select to authenticated using (public.is_member(household_id));
drop policy if exists dish_items_select on public.dish_items;
create policy dish_items_select on public.dish_items for select to authenticated using (public.is_member(household_id));
drop policy if exists plan_select on public.plan;
create policy plan_select on public.plan for select to authenticated using (public.is_member(household_id));
drop policy if exists purchases_select on public.purchases;
create policy purchases_select on public.purchases for select to authenticated using (public.is_member(household_id));
drop policy if exists log_select on public.log;
create policy log_select on public.log for select to authenticated using (public.is_member(household_id));
-- у invites политик нет: из браузера таблица недоступна совсем

-- Права: сначала отзываем всё (в Supabase новые объекты по умолчанию доступны ролям API), затем выдаём только чтение.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.households, public.members, public.products, public.dishes,
                public.dish_items, public.plan, public.purchases, public.log to authenticated;

-- ───────────────────────── Вспомогательные ─────────────────────────
create or replace function public._arr(j jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end
$$;

create or replace function public._token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;

create or replace function public._hash(t text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(t, 'utf8')), 'hex')
$$;

-- ───────────────────────── Чтение ─────────────────────────
-- security invoker: работает RLS, чужие данные не видны.
create or replace function public.get_state() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  hid uuid;
  hh public.households%rowtype;
  mrole text;
begin
  select m.household_id, m.role into hid, mrole from public.members m where m.user_id = auth.uid();
  if hid is null then raise exception 'Нет доступа к семье. Войдите заново'; end if;
  select * into hh from public.households h where h.id = hid;

  return jsonb_build_object(
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'unit', p.unit, 'stock', p.stock, 'min', p.min_stock) order by p.seq)
                          from public.products p where p.household_id = hid), '[]'::jsonb),
    'dishes',   coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'note', d.note, 'type', d.type, 'meals', to_jsonb(d.meals),
                                 'withSide', d.with_side, 'portions', d.recipe_portions, 'times', d.times) order by d.seq)
                          from public.dishes d where d.household_id = hid), '[]'::jsonb),
    'ing',      coalesce((select jsonb_agg(jsonb_build_object('dish', i.dish_id, 'product', i.product_id, 'qty', i.qty, 'unit', i.recipe_unit) order by i.seq)
                          from public.dish_items i where i.household_id = hid), '[]'::jsonb),
    'plan',     coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'day', x.day, 'meal', x.meal, 'kind', x.kind, 'dish', x.dish_id, 'side', x.side_id,
                                 'done', x.done, 'date', x.done_at, 'left', x.leftover, 'portions', x.portions, 'from', x.from_id)
                                 order by x.day,
                                          case x.meal when 'Завтрак' then 0 when 'Обед' then 1 when 'Ужин' then 2 else -1 end,
                                          case x.kind when 'main' then 0 else 1 end,
                                          x.seq)
                          from public.plan x where x.household_id = hid), '[]'::jsonb),
    'settings', jsonb_build_object('email', coalesce(hh.email, ''), 'weekStart', hh.week_start, 'portions', coalesce(hh.portions, 0)),
    'log',      coalesce((select jsonb_agg(jsonb_build_object('when', l.when_str, 'action', l.action, 'obj', l.obj, 'details', l.details) order by l.id desc)
                          from (select * from public.log where household_id = hid order by id desc limit 100) l), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(jsonb_build_object('when', q.when_str, 'product', q.product_id, 'qty', q.qty, 'unit', q.unit,
                                 'total', q.total, 'price', q.unit_price) order by q.id)
                          from (select * from public.purchases where household_id = hid order by id desc limit 3000) q), '[]'::jsonb),
    'version',  hh.version,
    'me',       jsonb_build_object('email', coalesce(auth.jwt() ->> 'email', ''), 'role', mrole, 'household', hh.name)
  );
end $$;

-- ───────────────────────── Запись ─────────────────────────
create or replace function public.apply_changes(expected_version bigint, changes jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  cur bigint;
  s jsonb := coalesce(changes -> 'settings', '{}'::jsonb);
begin
  if uid is null then raise exception 'Войдите заново'; end if;
  select m.household_id into hid from public.members m where m.user_id = uid;
  if hid is null then raise exception 'Нет доступа к семье'; end if;

  select h.version into cur from public.households h where h.id = hid for update;
  if cur is distinct from expected_version then raise exception 'version_conflict'; end if;
  if jsonb_typeof(changes) is distinct from 'object' then raise exception 'Пустые изменения'; end if;

  -- удаления
  delete from public.products p where p.household_id = hid and p.id in (select jsonb_array_elements_text(public._arr(changes -> 'products' -> 'delete')));
  delete from public.dishes d   where d.household_id = hid and d.id in (select jsonb_array_elements_text(public._arr(changes -> 'dishes' -> 'delete')));
  delete from public.plan x     where x.household_id = hid and x.id in (select jsonb_array_elements_text(public._arr(changes -> 'plan' -> 'delete')));
  delete from public.dish_items i using jsonb_to_recordset(public._arr(changes -> 'ing' -> 'delete')) as k(dish text, product text)
    where i.household_id = hid and i.dish_id = k.dish and i.product_id = k.product;

  -- добавления и изменения (строка целиком, как в состоянии)
  insert into public.products (household_id, id, name, unit, stock, min_stock)
  select hid, x.id, coalesce(x.name, ''), coalesce(x.unit, 'ШТ'), coalesce(x.stock, 0), coalesce(x.min, 0)
  from jsonb_to_recordset(public._arr(changes -> 'products' -> 'upsert')) as x(id text, name text, unit text, stock double precision, min double precision)
  on conflict (household_id, id) do update set name = excluded.name, unit = excluded.unit, stock = excluded.stock, min_stock = excluded.min_stock;

  insert into public.dishes (household_id, id, name, note, type, meals, with_side, recipe_portions, times)
  select hid, x.id, coalesce(x.name, ''), coalesce(x.note, ''), coalesce(x.type, 'main'),
         coalesce(array(select jsonb_array_elements_text(public._arr(x.meals))), '{}'),
         coalesce(x."withSide", false), coalesce(x.portions, 0), coalesce(x.times, 1)
  from jsonb_to_recordset(public._arr(changes -> 'dishes' -> 'upsert'))
       as x(id text, name text, note text, type text, meals jsonb, "withSide" boolean, portions double precision, times double precision)
  on conflict (household_id, id) do update set name = excluded.name, note = excluded.note, type = excluded.type, meals = excluded.meals,
       with_side = excluded.with_side, recipe_portions = excluded.recipe_portions, times = excluded.times;

  insert into public.dish_items (household_id, dish_id, product_id, qty, recipe_unit)
  select hid, x.dish, x.product, coalesce(x.qty, 0), coalesce(x.unit, '')
  from jsonb_to_recordset(public._arr(changes -> 'ing' -> 'upsert')) as x(dish text, product text, qty double precision, unit text)
  on conflict (household_id, dish_id, product_id) do update set qty = excluded.qty, recipe_unit = excluded.recipe_unit;

  insert into public.plan (household_id, id, day, meal, kind, dish_id, side_id, done, done_at, leftover, portions, from_id)
  select hid, x.id, coalesce(x.day, 0), coalesce(x.meal, ''), coalesce(x.kind, 'main'), coalesce(x.dish, ''), coalesce(x.side, ''),
         coalesce(x.done, false), coalesce(x.date, ''), coalesce(x."left", false), coalesce(x.portions, 0), coalesce(x."from", '')
  from jsonb_to_recordset(public._arr(changes -> 'plan' -> 'upsert'))
       as x(id text, day int, meal text, kind text, dish text, side text, done boolean, date text, "left" boolean, portions double precision, "from" text)
  on conflict (household_id, id) do update set day = excluded.day, meal = excluded.meal, kind = excluded.kind, dish_id = excluded.dish_id,
       side_id = excluded.side_id, done = excluded.done, done_at = excluded.done_at, leftover = excluded.leftover,
       portions = excluded.portions, from_id = excluded.from_id;

  -- настройки
  update public.households h set
    week_start = case when s ? 'weekStart' then coalesce(s ->> 'weekStart', '') else h.week_start end,
    portions   = case when s ? 'portions'  then nullif((s ->> 'portions')::numeric, 0)::int else h.portions end,
    email      = case when s ? 'email'     then nullif(s ->> 'email', '') else h.email end
  where h.id = hid;

  -- журнал и приходы (в порядке массива)
  insert into public.log (household_id, when_str, action, obj, details)
  select hid, coalesce(x."when", ''), coalesce(x.action, ''), coalesce(x.obj, ''), coalesce(x.details, '')
  from jsonb_array_elements(public._arr(changes -> 'log')) with ordinality as e(v, n),
       lateral jsonb_to_record(e.v) as x("when" text, action text, obj text, details text)
  order by e.n;

  insert into public.purchases (household_id, when_str, product_id, qty, unit, total, unit_price)
  select hid, coalesce(x."when", ''), coalesce(x.product, ''), coalesce(x.qty, 0), coalesce(x.unit, ''), x.total, coalesce(x.price, x."unitPrice")
  from jsonb_array_elements(public._arr(changes -> 'purchases')) with ordinality as e(v, n),
       lateral jsonb_to_record(e.v) as x("when" text, product text, qty double precision, unit text, total double precision, price double precision, "unitPrice" double precision)
  order by e.n;

  update public.households h set version = h.version + 1 where h.id = hid returning h.version into cur;
  return cur;
end $$;

-- ───────────────────────── Приглашения и регистрация ─────────────────────────
-- Ссылка для близкого человека в свою семью (только владелец). Токен показывается один раз, в базе — только sha256.
create or replace function public.create_invite() returns text
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  hid uuid;
  r text;
  tok text;
begin
  if uid is null then raise exception 'Войдите заново'; end if;
  select m.household_id, m.role into hid, r from public.members m where m.user_id = uid;
  if hid is null then raise exception 'Нет доступа к семье'; end if;
  if r <> 'owner' then raise exception 'Приглашать может только владелец семьи'; end if;
  tok := public._token();
  insert into public.invites (household_id, kind, token_hash, created_by, expires_at)
  values (hid, 'join', public._hash(tok), uid, now() + interval '7 days');
  return tok;
end $$;

-- Ссылка для новой семьи: только из SQL Editor (владелец проекта).
create or replace function public.admin_new_family_invite(name text) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := public._token();
begin
  insert into public.invites (household_id, kind, family_name, token_hash, expires_at)
  values (null, 'new_family', coalesce(name, ''), public._hash(tok), now() + interval '7 days');
  return tok;
end $$;

-- Срабатывает при создании пользователя (signUp). Любая ошибка отменяет регистрацию целиком.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  tok text := new.raw_user_meta_data ->> 'invite';
  inv public.invites%rowtype;
  hid uuid;
  r text;
begin
  if tok is null or tok = '' then raise exception 'Регистрация только по ссылке-приглашению'; end if;
  -- одно условие в одном update: при двух одновременных регистрациях второй дождётся первого и увидит used_at
  update public.invites i set used_at = now(), used_by = new.id
  where i.token_hash = public._hash(tok) and i.used_at is null and i.expires_at > now()
  returning i.* into inv;
  if inv.id is null then raise exception 'Ссылка не подходит: она использована или устарела'; end if;
  if inv.kind = 'new_family' then
    insert into public.households (name) values (inv.family_name) returning id into hid;
    r := 'owner';
  else
    hid := inv.household_id;
    r := 'member';
  end if;
  insert into public.members (household_id, user_id, role) values (hid, new.id, r);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ───────────────────────── Права на функции ─────────────────────────
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.get_state() to authenticated;
grant execute on function public.apply_changes(bigint, jsonb) to authenticated;
grant execute on function public.create_invite() to authenticated;
-- admin_new_family_invite и handle_new_user: только владелец базы (SQL Editor)
