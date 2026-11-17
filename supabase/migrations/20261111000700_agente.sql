-- Agente AML · Soporte para el agente conversacional

-- El tipo de persona se conoce desde el alta (lo indica el ejecutivo) y define
-- qué información y documentos se piden.
alter table aml.expedientes
  add column tipo_persona aml.tipo_persona not null default 'individual';

-- Alta de operación: ahora acepta "tipo_persona" en cada parte.
create or replace function aml.crear_operacion(
  p_organizacion uuid,
  p_tipo aml.tipo_operacion,
  p_inmueble jsonb,
  p_precio numeric,
  p_moneda char(3),
  p_forma_pago jsonb,
  p_partes jsonb
)
returns table (operacion_id uuid, codigo text, expediente_id uuid, parte aml.parte_operacion)
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
#variable_conflict use_column
declare
  rol aml.rol_usuario := aml.rol_en(p_organizacion);
  op aml.operaciones;
  p jsonb;
begin
  if rol is null or rol = 'auditor' then
    raise exception 'Sin permiso para registrar operaciones' using errcode = '42501';
  end if;
  if jsonb_typeof(p_partes) <> 'array' or jsonb_array_length(p_partes) = 0 then
    raise exception 'Debe indicar al menos una parte' using errcode = '22023';
  end if;

  insert into aml.operaciones (organizacion_id, tipo, inmueble, precio, moneda, forma_pago, creada_por)
  values (p_organizacion, p_tipo, coalesce(p_inmueble, '{}'), p_precio, coalesce(p_moneda, 'GTQ'),
          coalesce(p_forma_pago, '[]'), auth.uid())
  returning * into op;

  for p in select * from jsonb_array_elements(p_partes) loop
    insert into aml.expedientes (organizacion_id, operacion_id, parte, tipo_persona, contacto_nombre,
                                 contacto_telefono, contacto_correo)
    values (p_organizacion, op.id, (p->>'parte')::aml.parte_operacion,
            coalesce((p->>'tipo_persona')::aml.tipo_persona, 'individual'),
            p->>'contacto_nombre', p->>'contacto_telefono', p->>'contacto_correo')
    returning op.id, op.codigo, aml.expedientes.id, aml.expedientes.parte
      into operacion_id, codigo, expediente_id, parte;
    return next;
  end loop;
end;
$$;

-- Guarda un dato del expediente: deja sin vigencia el valor anterior y
-- registra el nuevo con su procedencia, en una sola transacción.
create or replace function aml.guardar_dato(
  p_expediente uuid,
  p_campo text,
  p_valor jsonb,
  p_origen aml.origen_dato,
  p_documento uuid default null,
  p_pagina integer default null,
  p_confianza numeric default null,
  p_confirmado_por text default null
)
returns uuid
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select organizacion_id into v_org from aml.expedientes where id = p_expediente;
  if v_org is null then
    raise exception 'Expediente inexistente' using errcode = '22023';
  end if;
  update aml.datos_expediente set vigente = false
   where expediente_id = p_expediente and campo = p_campo and vigente;
  insert into aml.datos_expediente (organizacion_id, expediente_id, campo, valor, origen, documento_id,
                                    pagina, confianza, confirmado_por, confirmado_en)
  values (v_org, p_expediente, p_campo, p_valor, p_origen, p_documento, p_pagina, p_confianza,
          p_confirmado_por, case when p_confirmado_por is null then null else now() end)
  returning id into v_id;
  -- El cliente empezó a entregar información
  update aml.expedientes set estado = 'en_captura'
   where id = p_expediente and estado = 'invitado';
  return v_id;
end;
$$;

create or replace function aml.confirmar_dato(p_expediente uuid, p_campo text, p_confirmado_por text)
returns boolean
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
begin
  update aml.datos_expediente
     set confirmado_por = p_confirmado_por, confirmado_en = now()
   where expediente_id = p_expediente and campo = p_campo and vigente;
  return found;
end;
$$;

revoke execute on function aml.guardar_dato(uuid, text, jsonb, aml.origen_dato, uuid, integer, numeric, text) from public;
revoke execute on function aml.confirmar_dato(uuid, text, text) from public;
grant execute on function aml.guardar_dato(uuid, text, jsonb, aml.origen_dato, uuid, integer, numeric, text) to service_role;
grant execute on function aml.confirmar_dato(uuid, text, text) to service_role;

-- Bucket privado para los documentos (solo existe en Supabase).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('expedientes', 'expedientes', false)
    on conflict (id) do nothing;
  end if;
end;
$$;
