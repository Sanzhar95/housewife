#!/bin/sh
# Локальный PostgreSQL для проверки базы без Supabase: sh tools/local-pg.sh  → печатает SUPABASE_DB_URL.
# Нужны PostgreSQL 15+ (initdb, pg_ctl) и права запускать их (в песочнице — от пользователя postgres).
D=${DK_PG_DIR:-/tmp/pgl}; B=$(ls -d /usr/lib/postgresql/*/bin | tail -1); R=""; [ "$(id -u)" = 0 ] && R="runuser -u postgres --"
mkdir -p "$D" && [ "$(id -u)" = 0 ] && chown postgres "$D"
[ -d "$D/data" ] || $R $B/initdb -D "$D/data" -A trust >/dev/null
$R $B/pg_ctl -D "$D/data" -o "-p 54329 -k $D -c listen_addresses=''" -l "$D/log" -w start >/dev/null 2>&1
P="psql -X -q -h $D -p 54329 -U postgres"
$P -d postgres -tc "select 1 from pg_database where datname='dk'" | grep -q 1 || { $P -d postgres -c "create database dk" && $P -d dk -v ON_ERROR_STOP=1 -f "$(dirname "$0")/../tests/helpers/supabase-stub.sql"; }
for f in "$(dirname "$0")"/../supabase/migrations/*.sql; do $P -d dk -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -v NOTICE; done
echo "postgresql://postgres@/dk?host=$D&port=54329"
