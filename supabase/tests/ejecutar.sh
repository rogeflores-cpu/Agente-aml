#!/usr/bin/env bash
# Aplica las migraciones en una base vacía y corre todas las pruebas SQL (tests/[1-9]*.sql).
# Uso: DATABASE_URL=postgres://postgres@localhost:5432/aml_test bash supabase/tests/ejecutar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Defina DATABASE_URL apuntando a una base vacía de pruebas}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f tests/00_stub_supabase.sql
for f in migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
for f in tests/[1-9]*.sql; do
  echo "== $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
