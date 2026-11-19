-- Agente AML · Compatibilidad de pgcrypto (se ejecuta antes que todas)
--
-- En Supabase la extensión pgcrypto vive en el esquema 'extensions', fuera
-- del search_path fijo (aml, public, pg_temp) de las funciones SECURITY
-- DEFINER: digest() no se encontraría y la bitácora fallaría al sellar cada
-- evento. aml.digest() delega en el digest() real, esté donde esté, y como
-- 'aml' va primero en ese search_path, las llamadas sin calificar lo usan.

create schema if not exists aml;
create extension if not exists pgcrypto;

do $$
declare
  esquema text;
begin
  select n.nspname into esquema
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';
  if esquema is null then
    raise exception 'La extensión pgcrypto no está instalada';
  end if;
  if esquema <> 'aml' then
    execute format(
      'create or replace function aml.digest(text, text) returns bytea language sql immutable strict parallel safe as $f$ select %I.digest($1, $2) $f$',
      esquema);
    execute format(
      'create or replace function aml.digest(bytea, text) returns bytea language sql immutable strict parallel safe as $f$ select %I.digest($1, $2) $f$',
      esquema);
  end if;
end;
$$;
