-- Agente AML · Fase 1 · Bitácora encadenada, inmutabilidad y reglas de negocio

-- ---------------------------------------------------------------------------
-- Bitácora: solo inserción, encadenada con SHA-256 por organización.
-- Permite demostrar ante la IVE que el historial no fue alterado (art. 34).
-- ---------------------------------------------------------------------------
create table aml.bitacora (
  id                bigint generated always as identity primary key,
  organizacion_id   uuid not null references aml.organizaciones(id) on delete restrict,
  ocurrido_en       timestamptz not null default clock_timestamp(),
  actor_tipo        text not null check (actor_tipo in ('usuario', 'cliente', 'agente', 'sistema')),
  actor_id          text,
  evento            text not null,
  entidad           text not null,
  entidad_id        uuid,
  datos             jsonb not null default '{}'::jsonb,
  hash_anterior     char(64),
  hash              char(64) not null
);
create index on aml.bitacora (organizacion_id, id);
create index on aml.bitacora (entidad, entidad_id);

create or replace function aml.bitacora_encadenar()
returns trigger
language plpgsql
as $$
declare
  previo char(64);
begin
  -- Serializa las inserciones de una misma organización para que la cadena no se bifurque.
  perform pg_advisory_xact_lock(hashtextextended('aml.bitacora:' || new.organizacion_id::text, 0));
  select b.hash into previo
    from aml.bitacora b
   where b.organizacion_id = new.organizacion_id
   order by b.id desc
   limit 1;
  new.hash_anterior := previo;
  new.hash := encode(digest(
      coalesce(previo, repeat('0', 64)) || '|' ||
      new.organizacion_id::text || '|' ||
      to_char(new.ocurrido_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
      new.actor_tipo || '|' || coalesce(new.actor_id, '') || '|' ||
      new.evento || '|' || new.entidad || '|' || coalesce(new.entidad_id::text, '') || '|' ||
      new.datos::text,
    'sha256'), 'hex');
  return new;
end;
$$;

create trigger bitacora_encadenar before insert on aml.bitacora
  for each row execute function aml.bitacora_encadenar();

-- Inmutabilidad: ninguna fila de estas tablas se modifica ni se borra.
create or replace function aml.impedir_cambios()
returns trigger
language plpgsql
as $$
begin
  raise exception 'La tabla % es de solo inserción (registro inmutable)', tg_table_name
    using errcode = 'P0001';
end;
$$;

create trigger bitacora_inmutable before update or delete on aml.bitacora
  for each row execute function aml.impedir_cambios();
create trigger decisiones_inmutables before update or delete on aml.decisiones
  for each row execute function aml.impedir_cambios();

-- Verificación de la cadena: devuelve el primer registro alterado, o nada.
create or replace function aml.verificar_bitacora(p_organizacion uuid)
returns table (id bigint, problema text)
language plpgsql
stable
as $$
declare
  r record;
  previo char(64) := null;
  esperado char(64);
begin
  for r in select * from aml.bitacora b where b.organizacion_id = p_organizacion order by b.id loop
    esperado := encode(digest(
        coalesce(previo, repeat('0', 64)) || '|' ||
        r.organizacion_id::text || '|' ||
        to_char(r.ocurrido_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
        r.actor_tipo || '|' || coalesce(r.actor_id, '') || '|' ||
        r.evento || '|' || r.entidad || '|' || coalesce(r.entidad_id::text, '') || '|' ||
        r.datos::text,
      'sha256'), 'hex');
    if r.hash_anterior is distinct from previo then
      id := r.id; problema := 'hash_anterior no coincide'; return next; return;
    end if;
    if r.hash <> esperado then
      id := r.id; problema := 'hash no coincide con el contenido'; return next; return;
    end if;
    previo := r.hash;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Registro automático de eventos en la bitácora
-- ---------------------------------------------------------------------------
create or replace function aml.registrar_evento()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  fila jsonb;
  actor text := auth.uid()::text;
  actor_tipo text := coalesce(nullif(current_setting('aml.actor_tipo', true), ''),
                              case when actor is null then 'sistema' else 'usuario' end);
begin
  fila := to_jsonb(coalesce(new, old));
  -- No se copian a la bitácora tokens ni datos extensos
  fila := fila - 'enlace_token_hash' - 'entrada' - 'datos' - 'valor';
  insert into aml.bitacora (organizacion_id, actor_tipo, actor_id, evento, entidad, entidad_id, datos)
  values (
    (fila->>'organizacion_id')::uuid,
    actor_tipo,
    coalesce(nullif(current_setting('aml.actor_id', true), ''), actor),
    lower(tg_op),
    tg_table_name,
    (fila->>'id')::uuid,
    fila
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'operaciones', 'expedientes', 'personas_relacionadas', 'documentos', 'datos_expediente',
    'pendientes', 'verificaciones', 'alertas', 'evaluaciones_riesgo', 'decisiones', 'pagos_efectivo'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on aml.%I
         for each row execute function aml.registrar_evento()', t || '_bitacora', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Código correlativo de operación por organización y año: OP-2026-00001
-- ---------------------------------------------------------------------------
create or replace function aml.asignar_codigo_operacion()
returns trigger
language plpgsql
as $$
declare
  v_anio integer := extract(year from (now() at time zone 'America/Guatemala'))::integer;
  n integer;
begin
  if new.codigo is not null then
    return new;
  end if;
  insert into aml.contadores (organizacion_id, anio, ultimo)
  values (new.organizacion_id, v_anio, 1)
  on conflict (organizacion_id, anio) do update set ultimo = aml.contadores.ultimo + 1
  returning ultimo into n;
  new.codigo := format('OP-%s-%s', v_anio, lpad(n::text, 5, '0'));
  return new;
end;
$$;

-- El NOT NULL de codigo se evalúa después de este trigger.
create trigger operaciones_codigo before insert on aml.operaciones
  for each row execute function aml.asignar_codigo_operacion();

-- ---------------------------------------------------------------------------
-- Una decisión actualiza el estado del expediente, y solo la toma
-- un oficial de cumplimiento (titular o suplente) de la organización.
-- ---------------------------------------------------------------------------
create or replace function aml.aplicar_decision()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  rol_actual aml.rol_usuario;
  verif_pendientes integer;
begin
  select m.rol into rol_actual
    from aml.miembros m
   where m.organizacion_id = new.organizacion_id
     and m.usuario_id = new.decidido_por
     and m.activo;
  if rol_actual is null or rol_actual not in ('oficial', 'oficial_suplente') then
    raise exception 'Solo el oficial de cumplimiento puede registrar decisiones'
      using errcode = '42501';
  end if;

  -- No se aprueba con posibles coincidencias sin disponer
  if new.tipo in ('aprobar', 'aprobar_diferida') then
    select count(*) into verif_pendientes
      from aml.verificaciones v
     where v.expediente_id = new.expediente_id
       and v.resultado in ('posible_coincidencia', 'coincidencia_confirmada');
    if verif_pendientes > 0 then
      raise exception 'Hay % verificación(es) con coincidencia sin descartar', verif_pendientes
        using errcode = 'P0001';
    end if;
  end if;

  update aml.expedientes e
     set estado = case new.tipo
                    when 'aprobar'          then 'aprobado'::aml.estado_expediente
                    when 'aprobar_diferida' then 'aprobado_condicionado'
                    when 'intensificar'     then 'en_revision'
                    when 'rechazar'         then 'rechazado'
                    when 'abstener'         then 'abstenido'
                    when 'abrir_examen'     then 'en_examen'
                  end,
         verificacion_diferida_hasta = coalesce(new.verificacion_diferida_hasta, e.verificacion_diferida_hasta),
         actualizado_en = now()
   where e.id = new.expediente_id
     and e.organizacion_id = new.organizacion_id;
  return new;
end;
$$;

create trigger decisiones_aplicar before insert on aml.decisiones
  for each row execute function aml.aplicar_decision();

-- Marca de actualización
create or replace function aml.tocar_actualizado()
returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end;
$$;
create trigger expedientes_actualizado before update on aml.expedientes
  for each row execute function aml.tocar_actualizado();
