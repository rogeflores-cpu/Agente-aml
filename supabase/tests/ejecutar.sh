#!/usr/bin/env bash
# Aplica las migraciones en una base vacía y corre las pruebas de reglas.
# Uso: DATABASE_URL=postgres://postgres@localhost:5432/aml_test bash supabase/tests/ejecutar.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?Defina DATABASE_URL apuntando a una base vacía de pruebas}"
for f in tests/00_stub_supabase.sql migrations/*.sql tests/10_pruebas_reglas.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
