-- Agente AML · Administración de la plataforma y alta de organizaciones

-- ---------------------------------------------------------------------------
-- Metodología de riesgo: una versión aprobada por el órgano de dirección
-- (art. 8) ya no se modifica ni se borra. Un cambio es una versión nueva.
-- La aprobación misma es la única actualización permitida, y solo una vez.
-- ---------------------------------------------------------------------------
create or replace function aml.proteger_configuracion_aprobada()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.aprobada_en is not null then
      raise exception 'Una metodología aprobada no se puede borrar' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if old.aprobada_en is not null then
    raise exception 'Una metodología aprobada no se modifica: cree una versión nueva' using errcode = 'P0001';
  end if;
  if new.version <> old.version or new.organizacion_id <> old.organizacion_id then
    raise exception 'No se puede cambiar la versión ni la organización de una metodología' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger configuraciones_protegidas before update or delete on aml.configuraciones_riesgo
  for each row execute function aml.proteger_configuracion_aprobada();

alter table aml.configuraciones_riesgo
  add constraint aprobacion_completa check (
    (aprobada_en is null and aprobada_por is null)
    or (aprobada_en is not null and aprobada_por is not null and length(trim(aprobada_por)) > 0)
  ) not valid;
alter table aml.configuraciones_riesgo validate constraint aprobacion_completa;

-- ---------------------------------------------------------------------------
-- Token de WhatsApp de cada organización en Supabase Vault.
-- SQL dinámico: la función se crea aunque el esquema vault no exista
-- (Postgres local); al ejecutarse sin Vault, falla con un mensaje claro.
-- ---------------------------------------------------------------------------
create or replace function aml.guardar_token_canal(p_organizacion uuid, p_token text)
returns uuid
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_canal aml.canales_whatsapp;
  v_secreto uuid;
begin
  if p_token is null or length(trim(p_token)) < 20 then
    raise exception 'Token de WhatsApp inválido' using errcode = '22023';
  end if;
  if not exists (select 1 from information_schema.schemata where schema_name = 'vault') then
    raise exception 'Supabase Vault no está disponible en esta base' using errcode = '55000';
  end if;
  select * into v_canal from aml.canales_whatsapp where organizacion_id = p_organizacion for update;
  if v_canal.id is null then
    raise exception 'La organización no tiene canal de WhatsApp registrado' using errcode = '22023';
  end if;

  if v_canal.token_secret_id is null then
    execute 'select vault.create_secret($1, $2, $3)'
      into v_secreto
      using p_token, 'whatsapp_' || v_canal.phone_number_id, 'Token de WhatsApp de la organización ' || p_organizacion;
    update aml.canales_whatsapp set token_secret_id = v_secreto where id = v_canal.id;
  else
    v_secreto := v_canal.token_secret_id;
    execute 'select vault.update_secret($1, $2)' using v_secreto, p_token;
  end if;
  return v_secreto;
end;
$$;

revoke execute on function aml.guardar_token_canal(uuid, text) from public;
grant execute on function aml.guardar_token_canal(uuid, text) to service_role;

-- Busca un usuario existente por correo (para vincularlo sin reinvitarlo).
create or replace function aml.usuario_por_correo(p_correo text)
returns uuid
language plpgsql
stable
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users') then
    return null;
  end if;
  execute 'select id from auth.users where lower(email) = lower($1) limit 1' into v_id using p_correo;
  return v_id;
end;
$$;

revoke execute on function aml.usuario_por_correo(text) from public;
grant execute on function aml.usuario_por_correo(text) to service_role;

-- ---------------------------------------------------------------------------
-- Estado de alta de cada organización. Solo la llave de servicio la consulta
-- (la API de la plataforma); los usuarios de las organizaciones no.
-- ---------------------------------------------------------------------------
create view aml.estado_alta_organizaciones as
select o.id,
       o.nombre_legal,
       o.nombre_comercial,
       o.nit,
       o.actividad,
       o.subdominio,
       o.inscripcion_ive,
       o.marca,
       o.creado_en,
       (select max(c.version) from aml.configuraciones_riesgo c
         where c.organizacion_id = o.id and c.aprobada_en is not null)                      as metodologia_version_aprobada,
       exists (select 1 from aml.configuraciones_riesgo c
                where c.organizacion_id = o.id and c.aprobada_en is null)                    as metodologia_pendiente,
       (select count(*) from aml.miembros m
         where m.organizacion_id = o.id and m.activo and m.rol = 'oficial')                  as oficiales,
       (select count(*) from aml.miembros m
         where m.organizacion_id = o.id and m.activo and m.rol = 'oficial_suplente')         as suplentes,
       (select count(*) from aml.miembros m where m.organizacion_id = o.id and m.activo)    as usuarios,
       (select c.estado from aml.canales_whatsapp c where c.organizacion_id = o.id)          as whatsapp_estado,
       (select c.numero_visible from aml.canales_whatsapp c where c.organizacion_id = o.id)  as whatsapp_numero,
       (
         o.inscripcion_ive is not null
         and exists (select 1 from aml.configuraciones_riesgo c where c.organizacion_id = o.id and c.aprobada_en is not null)
         and exists (select 1 from aml.miembros m where m.organizacion_id = o.id and m.activo and m.rol = 'oficial')
         and exists (select 1 from aml.canales_whatsapp c where c.organizacion_id = o.id and c.estado = 'activo')
       )                                                                                     as lista_para_operar
  from aml.organizaciones o;

revoke all on aml.estado_alta_organizaciones from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on aml.estado_alta_organizaciones from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on aml.estado_alta_organizaciones from authenticated';
  end if;
end;
$$;
grant select on aml.estado_alta_organizaciones to service_role;

grant select, update on aml.avisos_plataforma to service_role;
