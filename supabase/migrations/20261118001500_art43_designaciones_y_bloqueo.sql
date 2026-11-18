-- Agente AML · Art. 43: designaciones de la S/RES/1373, bloqueo preventivo y
-- cotejo exigido de cada persona identificada
--
-- Cierra los tres puntos que la revisión independiente (M10 y A1) dejó
-- abiertos por decisión de diseño:
--
-- 1. Designaciones de la resolución S/RES/1373(2001). No están en la lista
--    consolidada de la ONU: las hace Guatemala u otro Estado y llegan por
--    comunicación oficial, sin archivo descargable. La plataforma las registra
--    a mano (como las listas del GAFI), con la autoridad y la referencia del
--    documento, y nunca se borran: una designación se revoca con su propia
--    referencia. El flujo de cotejo las consulta junto con la lista de la ONU.
-- 2. Bloqueo preventivo. Al confirmarse una coincidencia (ONU o 1373) la base
--    registra en la misma transacción un bloqueo de la persona en toda la
--    organización: no se aprueba ningún expediente donde aparezca, no se cierra
--    (escritura otorgada) ninguna operación suya y cualquier pago en efectivo
--    que se registre avisa de urgencia a cumplimiento. La alerta de la
--    coincidencia confirmada no se cierra sin registrar antes la comunicación
--    escrita al Ministerio Público (fecha, referencia y documento).
-- 3. Cotejo de cada persona identificada. Aprobar exige un cotejo sin
--    coincidencia (o descartado) de cada nombre identificado: cliente o razón
--    social, representante y CADA beneficiario final; y, si la plataforma ya
--    registró designaciones 1373, también el cotejo contra ellas.
--
-- Mensajes hacia roles operativos (art. 38): neutros, sin mencionar listas,
-- coincidencias ni bloqueos.

-- ===========================================================================
-- 1. Designaciones de la S/RES/1373 (plataforma)
-- ===========================================================================
create table aml.designaciones_1373 (
  id                     uuid primary key default gen_random_uuid(),
  tipo                   text not null check (tipo in ('individual', 'entidad')),
  nombre                 text not null check (length(trim(nombre)) >= 3),
  alias                  text[] not null default '{}',
  documentos             text[] not null default '{}',
  fechas_nacimiento      text[] not null default '{}',   -- AAAA-MM-DD o AAAA
  nacionalidades         text[] not null default '{}',   -- ISO 3166-1 alfa-2
  autoridad              text not null check (length(trim(autoridad)) >= 3),   -- quién designa
  referencia             text not null check (length(trim(referencia)) >= 3),  -- resolución, oficio
  fuente_url             text,
  designada_el           date not null,
  cargada_por            text not null,
  cargada_en             timestamptz not null default now(),
  revocada_el            date,
  revocacion_referencia  text,
  revocada_por           text,
  revocada_en            timestamptz,
  constraint fechas_validas check (
    array_to_string(fechas_nacimiento, ',') ~ '^((\d{4}(-\d{2}-\d{2})?)(,\d{4}(-\d{2}-\d{2})?)*)?$'
  ),
  constraint revocacion_completa check (
    (revocada_el is null and revocacion_referencia is null and revocada_por is null and revocada_en is null)
    or (revocada_el is not null and length(trim(revocacion_referencia)) >= 3 and revocada_por is not null
        and revocada_en is not null and revocada_el >= designada_el)
  )
);
create index on aml.designaciones_1373 (revocada_el) where revocada_el is null;

create or replace function aml.proteger_designacion_1373()
returns trigger
language plpgsql
as $$
declare
  hoy date := (now() at time zone 'America/Guatemala')::date;
begin
  if tg_op = 'INSERT' then
    if new.designada_el > hoy then
      raise exception 'La fecha de la designación no puede ser futura' using errcode = '23514';
    end if;
    if new.revocada_el is not null then
      raise exception 'Una designación se registra vigente; la revocación se registra después' using errcode = '23514';
    end if;
    new.cargada_en := now();
    return new;
  end if;
  -- Solo se permite registrar la revocación, una vez
  if (new.id, new.tipo, new.nombre, new.alias, new.documentos, new.fechas_nacimiento, new.nacionalidades,
      new.autoridad, new.referencia, new.fuente_url, new.designada_el, new.cargada_por, new.cargada_en)
     is distinct from
     (old.id, old.tipo, old.nombre, old.alias, old.documentos, old.fechas_nacimiento, old.nacionalidades,
      old.autoridad, old.referencia, old.fuente_url, old.designada_el, old.cargada_por, old.cargada_en) then
    raise exception 'Una designación registrada no se modifica; si cambió, revóquela y registre la nueva' using errcode = 'P0001';
  end if;
  if old.revocada_el is not null then
    raise exception 'La designación ya fue revocada' using errcode = 'P0001';
  end if;
  if new.revocada_el is not null and new.revocada_el > hoy then
    raise exception 'La fecha de revocación no puede ser futura' using errcode = '23514';
  end if;
  new.revocada_en := case when new.revocada_el is null then null else now() end;
  return new;
end;
$$;

create trigger designaciones_1373_proteger before insert or update on aml.designaciones_1373
  for each row execute function aml.proteger_designacion_1373();
create trigger designaciones_1373_sin_borrar before delete on aml.designaciones_1373
  for each row execute function aml.impedir_cambios();
create trigger designaciones_1373_sin_truncate before truncate on aml.designaciones_1373
  for each statement execute function aml.impedir_truncate();

create view aml.designaciones_1373_vigentes with (security_invoker = true) as
select * from aml.designaciones_1373 where revocada_el is null;

-- Versión del conjunto de designaciones: cambia con cada alta o revocación.
-- Se guarda como version_fuente en cada verificación. Null si nunca se ha
-- registrado ninguna.
create or replace function aml.version_designaciones_1373()
returns text
language sql
stable
security definer
set search_path = aml, public, pg_temp
as $$
  select encode(digest(string_agg(d.id::text || ':' || coalesce(d.revocada_en::text, ''), ',' order by d.id), 'sha256'), 'hex')
    from aml.designaciones_1373 d
$$;

alter table aml.designaciones_1373 enable row level security;
revoke all on aml.designaciones_1373, aml.designaciones_1373_vigentes from public, anon, authenticated;
grant select, insert, update on aml.designaciones_1373 to service_role;
grant select on aml.designaciones_1373_vigentes to service_role;
revoke truncate, delete on aml.designaciones_1373 from service_role;
revoke execute on function aml.version_designaciones_1373() from public;
grant execute on function aml.version_designaciones_1373() to service_role;

-- ===========================================================================
-- 2. Personas identificadas del expediente (misma lectura que la aplicación)
-- ===========================================================================

-- Nombres de la lista de beneficiarios finales, como los interpreta
-- interpretarBeneficiarios() en packages/agente: objetos {nombre, ...} o
-- cadenas "Ana Pérez, DPI 123, 30 %" (de las que se toma solo el nombre).
create or replace function aml.nombres_beneficiarios(p jsonb)
returns setof text
language sql
immutable
as $$
  select n from (
    select trim(case jsonb_typeof(e)
                  when 'object' then coalesce(e->>'nombre', '')
                  when 'string' then regexp_replace(
                                       trim((regexp_split_to_array(e #>> '{}', '[,;]'))[1]),
                                       '\s*\d{1,3}([.,]\d+)?\s*%.*$', '')
                  else ''
                end) as n
      from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
  ) x
  where length(n) >= 3
$$;

-- Toda persona que debe cotejarse según los datos vigentes del expediente.
create or replace function aml.nombres_identificados(p_expediente uuid)
returns table (rol text, nombre text)
language sql
stable
security definer
set search_path = aml, public, pg_temp
as $$
  with e as (select id, tipo_persona from aml.expedientes where id = p_expediente),
  d as (
    select dx.campo, dx.valor from aml.datos_expediente dx
     where dx.expediente_id = p_expediente and dx.vigente
       and dx.campo in ('cliente.nombre_completo', 'entidad.razon_social', 'representante.nombre_completo', 'beneficiarios_finales')
  )
  select 'cliente', trim(d.valor #>> '{}') from d, e
   where e.tipo_persona = 'individual' and d.campo = 'cliente.nombre_completo' and length(trim(d.valor #>> '{}')) > 0
  union all
  select 'entidad', trim(d.valor #>> '{}') from d, e
   where e.tipo_persona <> 'individual' and d.campo = 'entidad.razon_social' and length(trim(d.valor #>> '{}')) > 0
  union all
  select 'representante', trim(d.valor #>> '{}') from d
   where d.campo = 'representante.nombre_completo' and jsonb_typeof(d.valor) = 'string' and length(trim(d.valor #>> '{}')) > 0
  union all
  select 'beneficiario_final', b from d, e, aml.nombres_beneficiarios(d.valor) b
   where e.tipo_persona <> 'individual' and d.campo = 'beneficiarios_finales'
$$;
revoke execute on function aml.nombres_identificados(uuid) from public;
grant execute on function aml.nombres_identificados(uuid) to service_role;

-- Primer cotejo que falta para aprobar, o null si están todos.
create or replace function aml.cotejo_art43_faltante(p_expediente uuid)
returns text
language plpgsql
stable
security definer
set search_path = aml, public, pg_temp
as $$
declare
  p record;
  hay_designaciones boolean := exists (select 1 from aml.designaciones_1373);
begin
  for p in select * from aml.nombres_identificados(p_expediente) loop
    if not exists (select 1 from aml.verificaciones v
                    where v.expediente_id = p_expediente and v.fuente = 'onu'
                      and v.resultado in ('sin_coincidencia', 'descartada')
                      and aml.normalizar_nombre(v.nombre_consultado) = aml.normalizar_nombre(p.nombre)) then
      return format('No hay cotejo con la lista de la ONU para %s (%s)', p.nombre, replace(p.rol, '_', ' '));
    end if;
    if hay_designaciones and not exists (
         select 1 from aml.verificaciones v
          where v.expediente_id = p_expediente and v.fuente::text = 'designacion_1373'
            and v.resultado in ('sin_coincidencia', 'descartada')
            and aml.normalizar_nombre(v.nombre_consultado) = aml.normalizar_nombre(p.nombre)) then
      return format('No hay cotejo con las designaciones de la S/RES/1373 para %s (%s)', p.nombre, replace(p.rol, '_', ' '));
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function aml.cotejo_art43_faltante(uuid) from public;
grant execute on function aml.cotejo_art43_faltante(uuid) to service_role;

-- ===========================================================================
-- 3. Bloqueos preventivos (art. 43: "limitar con efecto preventivo")
-- ===========================================================================
create table aml.bloqueos_preventivos (
  id                          uuid primary key default gen_random_uuid(),
  organizacion_id             uuid not null,
  expediente_id               uuid not null,
  verificacion_id             uuid not null unique references aml.verificaciones(id) on delete restrict,
  fuente                      aml.fuente_verificacion not null,
  nombre                      text not null,
  nombre_normalizado          text not null,
  detectada_en                timestamptz not null,
  creado_en                   timestamptz not null default now(),
  -- Comunicación por escrito al Ministerio Público
  comunicado_mp_en            timestamptz,
  comunicacion_referencia     text,
  comunicacion_documento_id   uuid,
  comunicacion_registrada_por uuid,
  comunicacion_dentro_plazo   boolean,              -- la fija registrar_comunicacion_mp
  -- Levantamiento (p. ej., exclusión de la lista o resolución de autoridad competente)
  levantado_en                timestamptz,
  levantado_por               uuid,
  levantamiento_motivo        text,
  levantamiento_referencia    text,
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict,
  foreign key (organizacion_id, comunicacion_documento_id) references aml.documentos(organizacion_id, id) on delete restrict,
  unique (organizacion_id, id),
  constraint comunicacion_completa check (
    (comunicado_mp_en is null and comunicacion_referencia is null and comunicacion_registrada_por is null)
    or (comunicado_mp_en is not null and length(trim(comunicacion_referencia)) >= 3 and comunicacion_registrada_por is not null)
  ),
  constraint levantamiento_completo check (
    (levantado_en is null and levantado_por is null and levantamiento_motivo is null and levantamiento_referencia is null)
    or (levantado_en is not null and levantado_por is not null and length(trim(levantamiento_motivo)) >= 20
        and length(trim(levantamiento_referencia)) >= 3 and comunicado_mp_en is not null)
  )
);
create index on aml.bloqueos_preventivos (organizacion_id, nombre_normalizado) where levantado_en is null;

create or replace function aml.proteger_bloqueo()
returns trigger
language plpgsql
as $$
begin
  if (new.organizacion_id, new.expediente_id, new.verificacion_id, new.fuente, new.nombre, new.nombre_normalizado,
      new.detectada_en, new.creado_en)
     is distinct from
     (old.organizacion_id, old.expediente_id, old.verificacion_id, old.fuente, old.nombre, old.nombre_normalizado,
      old.detectada_en, old.creado_en) then
    raise exception 'Un bloqueo preventivo no se modifica' using errcode = 'P0001';
  end if;
  if old.comunicado_mp_en is not null
     and (new.comunicado_mp_en, new.comunicacion_referencia, new.comunicacion_documento_id, new.comunicacion_registrada_por,
          new.comunicacion_dentro_plazo)
         is distinct from
         (old.comunicado_mp_en, old.comunicacion_referencia, old.comunicacion_documento_id, old.comunicacion_registrada_por,
          old.comunicacion_dentro_plazo) then
    raise exception 'La comunicación al Ministerio Público ya fue registrada' using errcode = 'P0001';
  end if;
  if old.levantado_en is not null then
    raise exception 'El bloqueo ya fue levantado' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger bloqueos_proteger before update on aml.bloqueos_preventivos
  for each row execute function aml.proteger_bloqueo();
create trigger bloqueos_sin_borrar before delete on aml.bloqueos_preventivos
  for each row execute function aml.impedir_cambios();
create trigger bloqueos_sin_truncate before truncate on aml.bloqueos_preventivos
  for each statement execute function aml.impedir_truncate();
create trigger bloqueos_preventivos_bitacora after insert or update on aml.bloqueos_preventivos
  for each row execute function aml.registrar_evento();

alter table aml.bloqueos_preventivos enable row level security;
create policy bloqueos_ver on aml.bloqueos_preventivos for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));
revoke all on aml.bloqueos_preventivos from public, anon, authenticated;
grant select on aml.bloqueos_preventivos to authenticated;
grant select, insert, update on aml.bloqueos_preventivos to service_role;
revoke truncate, delete on aml.bloqueos_preventivos from service_role;

-- true si alguna persona del expediente tiene un bloqueo vigente en la
-- organización (en este o en cualquier otro expediente).
create or replace function aml.expediente_bloqueado(p_expediente uuid)
returns boolean
language sql
stable
security definer
set search_path = aml, public, pg_temp
as $$
  select exists (
    select 1
      from aml.expedientes e
      join aml.bloqueos_preventivos b on b.organizacion_id = e.organizacion_id and b.levantado_en is null
     where e.id = p_expediente
       and (b.expediente_id = e.id
            or b.nombre_normalizado in (select aml.normalizar_nombre(n.nombre) from aml.nombres_identificados(e.id) n)
            or b.nombre_normalizado in (select aml.normalizar_nombre(v.nombre_consultado)
                                          from aml.verificaciones v where v.expediente_id = e.id))
  )
$$;
revoke execute on function aml.expediente_bloqueado(uuid) from public;
grant execute on function aml.expediente_bloqueado(uuid) to service_role;

-- Al confirmarse una coincidencia: bloqueo en la misma transacción y alerta
-- en los demás expedientes abiertos de la organización donde aparece la
-- misma persona.
create or replace function aml.bloqueo_por_confirmacion()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_norm text := aml.normalizar_nombre(new.nombre_consultado);
  r record;
begin
  if not (tg_op = 'UPDATE' and old.resultado = 'posible_coincidencia' and new.resultado = 'coincidencia_confirmada') then
    return new;
  end if;
  insert into aml.bloqueos_preventivos (organizacion_id, expediente_id, verificacion_id, fuente, nombre,
                                        nombre_normalizado, detectada_en)
  values (new.organizacion_id, new.expediente_id, new.id, new.fuente, new.nombre_consultado, v_norm, new.consultado_en)
  on conflict (verificacion_id) do nothing;

  for r in
    select distinct e.id
      from aml.expedientes e
     where e.organizacion_id = new.organizacion_id
       and e.id <> new.expediente_id
       and e.fin_relacion is null
       and e.estado not in ('rechazado', 'abstenido')
       and (exists (select 1 from aml.verificaciones v
                     where v.expediente_id = e.id and aml.normalizar_nombre(v.nombre_consultado) = v_norm)
            or exists (select 1 from aml.nombres_identificados(e.id) n where aml.normalizar_nombre(n.nombre) = v_norm))
  loop
    insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion, evidencia)
    values (new.organizacion_id, r.id, 'BLOQUEO_RELACIONADO',
            'La persona ' || new.nombre_consultado || ' tiene una coincidencia confirmada (art. 43) en otro expediente. '
            || 'El bloqueo preventivo se extiende a este expediente: no se aprueba ni se cierra su operación.',
            jsonb_build_object('verificacionId', new.id, 'expedienteOrigen', new.expediente_id));
  end loop;
  return new;
end;
$$;

create trigger verificaciones_bloqueo after update on aml.verificaciones
  for each row execute function aml.bloqueo_por_confirmacion();

-- El oficial registra la comunicación escrita al Ministerio Público.
create or replace function aml.registrar_comunicacion_mp(
  p_bloqueo uuid,
  p_comunicado_en timestamptz,
  p_referencia text,
  p_documento uuid default null
)
returns table (bloqueo_id uuid, dentro_de_plazo boolean)
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  b aml.bloqueos_preventivos;
begin
  select * into b from aml.bloqueos_preventivos x where x.id = p_bloqueo for update;
  if b.id is null or not aml.puede_decidir(b.organizacion_id) then
    raise exception 'Solo el oficial de cumplimiento registra la comunicación al Ministerio Público' using errcode = '42501';
  end if;
  if b.comunicado_mp_en is not null then
    raise exception 'La comunicación al Ministerio Público ya fue registrada' using errcode = 'P0001';
  end if;
  if p_comunicado_en is null or p_comunicado_en > now() + interval '5 minutes' then
    raise exception 'Indique la fecha y hora en que se entregó la comunicación (no puede ser futura)' using errcode = '23514';
  end if;
  if p_comunicado_en < b.detectada_en then
    raise exception 'La comunicación no puede ser anterior a la detección de la coincidencia' using errcode = '23514';
  end if;
  if length(trim(coalesce(p_referencia, ''))) < 3 then
    raise exception 'Indique la referencia de la comunicación (número de oficio o de recepción)' using errcode = '23514';
  end if;
  if p_documento is not null and not exists (select 1 from aml.documentos d
                                              where d.id = p_documento and d.organizacion_id = b.organizacion_id) then
    raise exception 'El documento indicado no pertenece a la organización' using errcode = '22023';
  end if;
  update aml.bloqueos_preventivos x
     set comunicado_mp_en = p_comunicado_en,
         comunicacion_referencia = trim(p_referencia),
         comunicacion_documento_id = p_documento,
         comunicacion_registrada_por = auth.uid(),
         comunicacion_dentro_plazo = p_comunicado_en <= b.detectada_en + interval '24 hours'
   where x.id = p_bloqueo;
  return query select b.id, p_comunicado_en <= b.detectada_en + interval '24 hours';
end;
$$;

-- El oficial levanta el bloqueo con motivo y referencia de la resolución.
create or replace function aml.levantar_bloqueo(p_bloqueo uuid, p_motivo text, p_referencia text)
returns void
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  b aml.bloqueos_preventivos;
begin
  select * into b from aml.bloqueos_preventivos x where x.id = p_bloqueo for update;
  if b.id is null or not aml.puede_decidir(b.organizacion_id) then
    raise exception 'Solo el oficial de cumplimiento levanta un bloqueo preventivo' using errcode = '42501';
  end if;
  if b.levantado_en is not null then
    raise exception 'El bloqueo ya fue levantado' using errcode = 'P0001';
  end if;
  if b.comunicado_mp_en is null then
    raise exception 'Registre primero la comunicación al Ministerio Público' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 20 or length(trim(coalesce(p_referencia, ''))) < 3 then
    raise exception 'Indique el motivo (al menos 20 caracteres) y la referencia de la resolución' using errcode = '23514';
  end if;
  update aml.bloqueos_preventivos x
     set levantado_en = now(), levantado_por = auth.uid(),
         levantamiento_motivo = trim(p_motivo), levantamiento_referencia = trim(p_referencia)
   where x.id = p_bloqueo;
end;
$$;

revoke execute on function aml.registrar_comunicacion_mp(uuid, timestamptz, text, uuid) from public;
revoke execute on function aml.levantar_bloqueo(uuid, text, text) from public;
grant execute on function aml.registrar_comunicacion_mp(uuid, timestamptz, text, uuid) to authenticated;
grant execute on function aml.levantar_bloqueo(uuid, text, text) to authenticated;

-- La alerta de una coincidencia confirmada no se cierra sin la comunicación
-- registrada. Misma función de la migración de integración, con esa regla.
create or replace function aml.cerrar_alerta(p_alerta uuid, p_cierre text)
returns table (alerta_id uuid, organizacion_id uuid, expediente_id uuid)
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  a aml.alertas;
begin
  select * into a from aml.alertas x where x.id = p_alerta for update;
  if a.id is null or not aml.puede_decidir(a.organizacion_id) then
    raise exception 'Solo el oficial de cumplimiento cierra alertas' using errcode = '42501';
  end if;
  if a.estado = 'cerrada' then
    raise exception 'La alerta ya está cerrada' using errcode = 'P0001';
  end if;
  if a.senal = 'ONU_CONFIRMADA' and a.evidencia ? 'verificacionId'
     and exists (select 1 from aml.bloqueos_preventivos b
                  where b.verificacion_id = (a.evidencia->>'verificacionId')::uuid and b.comunicado_mp_en is null) then
    raise exception 'Registre la comunicación al Ministerio Público antes de cerrar esta alerta (art. 43)' using errcode = 'P0001';
  end if;
  update aml.alertas x
     set estado = 'cerrada', cierre = p_cierre, cerrada_en = now(), responsable = auth.uid()
   where x.id = p_alerta;
  return query select a.id, a.organizacion_id, a.expediente_id;
end;
$$;

-- ===========================================================================
-- 4. Alertas por verificación: texto según la fuente (ONU o 1373)
-- ===========================================================================
create or replace function aml.alerta_por_verificacion()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_lista text := case new.fuente::text
                    when 'designacion_1373' then 'las designaciones de la S/RES/1373(2001)'
                    else 'la lista del Consejo de Seguridad' end;
begin
  if tg_op = 'INSERT' and new.resultado = 'posible_coincidencia' then
    insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion, evidencia, vence_en)
    values (new.organizacion_id, new.expediente_id, 'ONU_POSIBLE',
            'Posible coincidencia con ' || v_lista || '. Disponer y, si se confirma, comunicar al Ministerio Público dentro de 24 horas desde su detección.',
            jsonb_build_object('verificacionId', new.id, 'detectadaEn', new.consultado_en, 'fuente', new.fuente),
            new.consultado_en + interval '24 hours');
  elsif tg_op = 'UPDATE' and old.resultado = 'posible_coincidencia' and new.resultado <> old.resultado then
    update aml.alertas a
       set estado = 'cerrada',
           cierre = case new.resultado
                      when 'descartada' then 'Coincidencia descartada por el oficial: ' || new.justificacion
                      else 'Coincidencia confirmada: continúa en la alerta ONU_CONFIRMADA con el mismo vencimiento.'
                    end,
           cerrada_en = now(),
           responsable = new.dispuesto_por
     where a.expediente_id = new.expediente_id
       and a.senal = 'ONU_POSIBLE'
       and a.evidencia->>'verificacionId' = new.id::text
       and a.estado <> 'cerrada';
    if new.resultado = 'coincidencia_confirmada' then
      insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion, evidencia, vence_en)
      values (new.organizacion_id, new.expediente_id, 'ONU_CONFIRMADA',
              'Coincidencia confirmada con ' || v_lista || ' (art. 43). Quedó un bloqueo preventivo sobre la persona en toda la organización. '
              || 'Comunique por escrito al Ministerio Público, con la documentación, dentro de las 24 horas desde la detección, y registre la comunicación.',
              jsonb_build_object('verificacionId', new.id, 'detectadaEn', new.consultado_en,
                                 'confirmadaEn', coalesce(new.dispuesto_en, now()), 'fuente', new.fuente),
              new.consultado_en + interval '24 hours');
    end if;
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 5. Decisiones: cotejo de cada persona y bloqueo vigente
-- ===========================================================================
-- Se ejecuta después de decisiones_aplicar (orden alfabético de disparadores),
-- que ya validó el rol, la transición y el cotejo del cliente y del representante.
create or replace function aml.decision_art43()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  falta text;
begin
  if new.tipo not in ('aprobar', 'aprobar_diferida') then
    return new;
  end if;
  falta := aml.cotejo_art43_faltante(new.expediente_id);
  if falta is not null then
    raise exception '%', falta using errcode = 'P0001';
  end if;
  if aml.expediente_bloqueado(new.expediente_id) then
    raise exception 'Hay un bloqueo preventivo vigente (art. 43) sobre una persona de este expediente' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger decisiones_art43 before insert on aml.decisiones
  for each row execute function aml.decision_art43();

-- ===========================================================================
-- 6. Operaciones y efectivo
-- ===========================================================================
-- Cerrar (escritura otorgada) una operación con una persona bloqueada no
-- procede. Cancelarla sí. Mensaje neutro para el área comercial (art. 38).
create or replace function aml.cerrar_operacion(p_operacion uuid, p_estado aml.estado_operacion)
returns void
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_org uuid;
  v_rol aml.rol_usuario;
begin
  select organizacion_id into v_org from aml.operaciones where id = p_operacion;
  v_rol := aml.rol_en(v_org);
  if v_org is null or v_rol is null or v_rol = 'auditor' then
    raise exception 'Sin permiso para cerrar la operación' using errcode = '42501';
  end if;
  if p_estado not in ('cerrada', 'cancelada') then
    raise exception 'Estado de cierre inválido' using errcode = '22023';
  end if;
  if p_estado = 'cerrada' and exists (select 1 from aml.expedientes e
                                       where e.operacion_id = p_operacion and aml.expediente_bloqueado(e.id)) then
    raise exception 'La operación no puede cerrarse en este momento. Consulte con el área de cumplimiento.' using errcode = 'P0001';
  end if;
  update aml.operaciones set estado = p_estado, cerrada_en = now() where id = p_operacion and estado = 'abierta';
  if not found then
    raise exception 'La operación ya está cerrada o cancelada' using errcode = 'P0001';
  end if;
end;
$$;

-- Un pago en efectivo se registra siempre (art. 31: el registro es
-- obligatorio), pero si la persona está bloqueada se avisa de urgencia a
-- cumplimiento, sin decir nada al área comercial.
create or replace function aml.efectivo_con_bloqueo()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
begin
  if exists (select 1 from aml.expedientes e
              where e.organizacion_id = new.organizacion_id
                and (e.operacion_id = new.operacion_id or e.cliente_id = new.cliente_id)
                and aml.expediente_bloqueado(e.id)) then
    insert into aml.notificaciones (organizacion_id, destinatario_rol, prioridad, asunto, cuerpo)
    values (new.organizacion_id, 'cumplimiento', 'urgente',
            'Pago en efectivo de una persona con bloqueo preventivo',
            format('Se registró un pago de %s %s el %s en una operación con bloqueo preventivo vigente (art. 43). Revise la limitación de fondos.',
                   new.moneda, new.monto, new.fecha));
  end if;
  return new;
end;
$$;

create trigger pagos_efectivo_bloqueo after insert on aml.pagos_efectivo
  for each row execute function aml.efectivo_con_bloqueo();
