-- Agente AML · Correcciones de seguridad y cumplimiento
-- Atiende los hallazgos de docs/revision-independiente-2026-11-16.md que
-- corresponden a la base de datos (C1, C2, A1, A2, A3, A4, A6 parcial, M1, M2,
-- M4, M6 parcial, M9 parcial, B1 parcial, B2, B4, B6, B8).
--
-- Principio general: los usuarios finales (rol 'authenticated' vía PostgREST)
-- solo cambian datos de cumplimiento por los caminos previstos (decisiones,
-- disposición de coincidencias, ajuste único del nivel, cierre de alertas).
-- Todo lo demás lo hace el servidor (service_role) o funciones SECURITY
-- DEFINER con search_path fijo. Las reglas de integridad que no dependen de
-- quién escribe (inmutabilidad, transiciones) aplican a todos los roles.

-- ===========================================================================
-- 0. Auxiliares
-- ===========================================================================

-- true cuando escribe un usuario final a través de la API pública. Dentro de
-- funciones SECURITY DEFINER current_user es el dueño, así que no aplica.
create or replace function aml.es_usuario_final()
returns boolean
language sql
stable
as $$ select current_user in ('authenticated', 'anon') $$;

-- Normalización simple de nombres para comparar el nombre vigente con el
-- nombre cotejado (mayúsculas/minúsculas, tildes y espacios).
create or replace function aml.normalizar_nombre(p text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(lower(translate(coalesce(p, ''),
         'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑáàäâéèëêíìïîóòöôúùüûñ',
         'AAAAEEEEIIIIOOOOUUUUNaaaaeeeeiiiioooouuuun')), '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function aml.impedir_truncate()
returns trigger
language plpgsql
as $$
begin
  raise exception 'La tabla % no se puede vaciar (registro de conservación obligatoria)', tg_table_name
    using errcode = 'P0001';
end;
$$;

-- ===========================================================================
-- 1. Bitácora (A2): orden bajo candado, sin TRUNCATE, más tablas auditadas,
--    actor correcto.
-- ===========================================================================

-- El orden de la cadena lo da 'secuencia', asignada dentro del candado por
-- organización. El id de identidad se asigna antes del candado y por eso no
-- sirve para ordenar (falsa alteración con transacciones concurrentes).
alter table aml.bitacora add column secuencia bigint;

alter table aml.bitacora disable trigger bitacora_inmutable;
update aml.bitacora b
   set secuencia = s.n
  from (select id, row_number() over (partition by organizacion_id order by id) as n from aml.bitacora) s
 where s.id = b.id;
alter table aml.bitacora enable trigger bitacora_inmutable;

alter table aml.bitacora alter column secuencia set not null;
create unique index bitacora_org_secuencia on aml.bitacora (organizacion_id, secuencia);

create or replace function aml.bitacora_encadenar()
returns trigger
language plpgsql
as $$
declare
  previo char(64);
  v_sec bigint;
begin
  -- Con REPEATABLE READ o SERIALIZABLE la transacción no ve las filas que otra
  -- confirmó mientras esperaba el candado y la cadena se bifurcaría.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'La bitácora requiere aislamiento READ COMMITTED' using errcode = '25001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('aml.bitacora:' || new.organizacion_id::text, 0));
  -- Consulta nueva (función volátil): ve lo confirmado por otras transacciones
  -- antes de obtener el candado.
  select b.secuencia, b.hash into v_sec, previo
    from aml.bitacora b
   where b.organizacion_id = new.organizacion_id
   order by b.secuencia desc
   limit 1;
  new.secuencia := coalesce(v_sec, 0) + 1;
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

-- Verificación por secuencia: detecta contenido alterado, eslabones
-- cambiados y huecos (filas faltantes en medio de la cadena).
create or replace function aml.verificar_bitacora(p_organizacion uuid)
returns table (id bigint, problema text)
language plpgsql
stable
as $$
declare
  r record;
  previo char(64) := null;
  esperado char(64);
  v_sec bigint := 0;
begin
  for r in select * from aml.bitacora b where b.organizacion_id = p_organizacion order by b.secuencia loop
    v_sec := v_sec + 1;
    if r.secuencia <> v_sec then
      id := r.id; problema := format('falta el eslabón %s', v_sec); return next; return;
    end if;
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

-- Ancla externa: el servidor guarda periódicamente fuera de la base (correo a
-- cumplimiento, sello de tiempo) el último eslabón, y luego verifica que siga
-- existiendo con el mismo hash. Detecta el borrado del final de la cadena.
create or replace function aml.ultimo_eslabon_bitacora(p_organizacion uuid)
returns table (secuencia bigint, hash char(64), ocurrido_en timestamptz)
language sql
stable
as $$
  select b.secuencia, b.hash, b.ocurrido_en from aml.bitacora b
   where b.organizacion_id = p_organizacion order by b.secuencia desc limit 1
$$;

create or replace function aml.verificar_ancla_bitacora(p_organizacion uuid, p_secuencia bigint, p_hash text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from aml.bitacora b
                  where b.organizacion_id = p_organizacion and b.secuencia = p_secuencia and b.hash = p_hash)
     and not exists (select 1 from aml.verificar_bitacora(p_organizacion))
$$;

revoke execute on function aml.ultimo_eslabon_bitacora(uuid) from public;
revoke execute on function aml.verificar_ancla_bitacora(uuid, bigint, text) from public;
grant execute on function aml.ultimo_eslabon_bitacora(uuid) to service_role;
grant execute on function aml.verificar_ancla_bitacora(uuid, bigint, text) to service_role;

-- Registro de eventos con actor correcto.
-- Prioridad del actor:
--   1. usuario autenticado (auth.uid()), que no se puede suplantar;
--   2. variables de transacción aml.actor_tipo / aml.actor_id, fijadas con
--      set_config(..., true) DENTRO de la misma transacción (funciones del
--      servidor). Fuera de una función SQL no persisten entre llamadas REST;
--   3. actor deducido de la fila (quién decidió, dispuso, ajustó o de dónde
--      vino el dato);
--   4. 'sistema'.
create or replace function aml.registrar_evento()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  fila jsonb := to_jsonb(coalesce(new, old));
  v_org uuid;
  v_uid text := auth.uid()::text;
  v_tipo text;
  v_actor text;
  v_guc_tipo text := nullif(current_setting('aml.actor_tipo', true), '');
begin
  v_org := coalesce((fila->>'organizacion_id')::uuid,
                    case when tg_table_name = 'organizaciones' then (fila->>'id')::uuid end);
  if v_org is null then
    return coalesce(new, old);
  end if;

  if v_uid is not null then
    v_tipo := 'usuario'; v_actor := v_uid;
  elsif v_guc_tipo in ('usuario', 'cliente', 'agente', 'sistema') then
    v_tipo := v_guc_tipo; v_actor := nullif(current_setting('aml.actor_id', true), '');
  else
    case tg_table_name
      when 'datos_expediente' then
        v_tipo := case fila->>'origen' when 'cliente' then 'cliente' when 'documento' then 'agente'
                                       when 'revisor' then 'usuario' else 'sistema' end;
        v_actor := case when fila->>'origen' = 'revisor' then fila->>'confirmado_por' end;
      when 'decisiones' then
        v_tipo := 'usuario'; v_actor := fila->>'decidido_por';
      when 'verificaciones' then
        if tg_op = 'UPDATE' and fila->>'dispuesto_por' is not null then
          v_tipo := 'usuario'; v_actor := fila->>'dispuesto_por';
        end if;
      when 'evaluaciones_riesgo' then
        if tg_op = 'UPDATE' and fila->>'ajustado_por' is not null then
          v_tipo := 'usuario'; v_actor := fila->>'ajustado_por';
        elsif fila->'entrada'->>'evaluadoPor' is not null then
          v_tipo := 'usuario'; v_actor := fila->'entrada'->>'evaluadoPor';
        end if;
      when 'alertas' then
        if tg_op = 'UPDATE' and fila->>'responsable' is not null then
          v_tipo := 'usuario'; v_actor := fila->>'responsable';
        end if;
      when 'pagos_efectivo' then
        if fila->>'registrado_por' is not null then v_tipo := 'usuario'; v_actor := fila->>'registrado_por'; end if;
      else null;
    end case;
    v_tipo := coalesce(v_tipo, 'sistema');
  end if;

  -- No se copian a la bitácora secretos ni contenidos extensos
  if fila ? 'parametros' then
    fila := fila || jsonb_build_object('parametros_sha256', encode(digest((fila->'parametros')::text, 'sha256'), 'hex'));
  end if;
  fila := fila - 'enlace_token_hash' - 'codigo_vinculacion_hash' - 'token_secret_id'
               - 'entrada' - 'datos' - 'valor' - 'parametros';

  insert into aml.bitacora (organizacion_id, actor_tipo, actor_id, evento, entidad, entidad_id, datos)
  values (v_org, v_tipo, v_actor, lower(tg_op), tg_table_name, (fila->>'id')::uuid, fila);
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['miembros', 'clientes', 'configuraciones_riesgo', 'organizaciones', 'canales_whatsapp'] loop
    execute format(
      'create trigger %I after insert or update or delete on aml.%I
         for each row execute function aml.registrar_evento()', t || '_bitacora', t);
  end loop;
  -- Registros de conservación obligatoria: ni TRUNCATE ni DELETE.
  foreach t in array array['bitacora', 'decisiones', 'verificaciones', 'evaluaciones_riesgo', 'documentos',
                           'datos_expediente', 'alertas', 'listas_gafi', 'configuraciones_riesgo', 'pagos_efectivo'] loop
    execute format('create trigger %I before truncate on aml.%I for each statement execute function aml.impedir_truncate()',
                   t || '_sin_truncate', t);
    execute format('revoke truncate on aml.%I from service_role, authenticated', t);
  end loop;
end;
$$;

create trigger verificaciones_sin_borrar before delete on aml.verificaciones
  for each row execute function aml.impedir_cambios();
create trigger evaluaciones_sin_borrar before delete on aml.evaluaciones_riesgo
  for each row execute function aml.impedir_cambios();
create trigger documentos_sin_borrar before delete on aml.documentos
  for each row execute function aml.impedir_cambios();
create trigger datos_sin_borrar before delete on aml.datos_expediente
  for each row execute function aml.impedir_cambios();
create trigger alertas_sin_borrar before delete on aml.alertas
  for each row execute function aml.impedir_cambios();

-- ===========================================================================
-- 2. Miembros (C1): el administrador no toca roles de cumplimiento ni su fila
-- ===========================================================================
drop policy miembros_admin on aml.miembros;

create policy miembros_admin_insertar on aml.miembros for insert to authenticated
  with check (aml.es_administrador(organizacion_id)
              and rol in ('administrador', 'ejecutivo')
              and usuario_id <> auth.uid());
create policy miembros_admin_actualizar on aml.miembros for update to authenticated
  using (aml.es_administrador(organizacion_id) and rol in ('administrador', 'ejecutivo') and usuario_id <> auth.uid())
  with check (aml.es_administrador(organizacion_id) and rol in ('administrador', 'ejecutivo') and usuario_id <> auth.uid());
create policy miembros_admin_borrar on aml.miembros for delete to authenticated
  using (aml.es_administrador(organizacion_id) and rol in ('administrador', 'ejecutivo') and usuario_id <> auth.uid());

-- Defensa adicional con mensaje explícito (las políticas filtran en silencio).
-- Los roles de cumplimiento (art. 16: los nombra el órgano de dirección) solo
-- se asignan desde la plataforma (service_role).
create or replace function aml.proteger_miembros()
returns trigger
language plpgsql
as $$
begin
  if aml.es_usuario_final() then
    if (tg_op <> 'INSERT' and old.rol in ('oficial', 'oficial_suplente', 'auditor'))
       or (tg_op <> 'DELETE' and new.rol in ('oficial', 'oficial_suplente', 'auditor')) then
      raise exception 'Los roles de cumplimiento solo se asignan desde la plataforma' using errcode = '42501';
    end if;
    if (tg_op <> 'INSERT' and old.usuario_id = auth.uid()) or (tg_op <> 'DELETE' and new.usuario_id = auth.uid()) then
      raise exception 'Un usuario no puede modificar su propia membresía' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.organizacion_id <> old.organizacion_id or new.usuario_id <> old.usuario_id) then
    raise exception 'No se cambia la organización ni el usuario de una membresía' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger miembros_proteger before insert or update or delete on aml.miembros
  for each row execute function aml.proteger_miembros();

-- ===========================================================================
-- 3. Expedientes (C2, A4): sin UPDATE directo; estado comercial estable
-- ===========================================================================
drop policy expedientes_gestionar on aml.expedientes;
revoke insert, update, delete on aml.expedientes from authenticated;

drop policy clientes_gestionar on aml.clientes;
revoke insert, update, delete on aml.clientes from authenticated;

-- Estado que ven el cliente y el área comercial. Solo avanza con el proceso
-- con el cliente; un examen (art. 29) nunca lo cambia, y una vez que se vio
-- 'aprobado' o 'no_aprobado' ya no regresa a 'en_revision' (art. 38).
alter table aml.expedientes
  add column estado_comercial text not null default 'invitado'
    check (estado_comercial in ('invitado', 'en_captura', 'en_revision', 'aprobado', 'no_aprobado')),
  add column actualizado_comercial_en timestamptz not null default now();

create or replace function aml.mapear_estado_comercial(p aml.estado_expediente)
returns text
language sql
immutable
as $$
  select case
           when p in ('invitado', 'en_captura') then p::text
           when p in ('aprobado', 'aprobado_condicionado') then 'aprobado'
           when p in ('rechazado', 'abstenido') then 'no_aprobado'
           else 'en_revision'
         end
$$;

alter table aml.expedientes disable trigger user;
update aml.expedientes set estado_comercial = aml.mapear_estado_comercial(estado), actualizado_comercial_en = actualizado_en;
alter table aml.expedientes enable trigger user;

create or replace function aml.calcular_estado_comercial()
returns trigger
language plpgsql
as $$
declare
  nuevo text;
begin
  if tg_op = 'INSERT' then
    new.estado_comercial := aml.mapear_estado_comercial(new.estado);
    new.actualizado_comercial_en := now();
    return new;
  end if;
  -- Nadie fija el estado comercial a mano
  new.estado_comercial := old.estado_comercial;
  new.actualizado_comercial_en := old.actualizado_comercial_en;
  if new.estado is distinct from old.estado then
    nuevo := case when new.estado = 'en_examen' then old.estado_comercial
                  else aml.mapear_estado_comercial(new.estado) end;
    if old.estado_comercial in ('aprobado', 'no_aprobado') and nuevo not in ('aprobado', 'no_aprobado') then
      nuevo := old.estado_comercial;
    end if;
    if nuevo is distinct from old.estado_comercial then
      new.estado_comercial := nuevo;
      new.actualizado_comercial_en := now();
    end if;
  end if;
  if (new.contacto_nombre, new.contacto_telefono, new.contacto_correo, new.whatsapp_vinculado_en)
     is distinct from (old.contacto_nombre, old.contacto_telefono, old.contacto_correo, old.whatsapp_vinculado_en) then
    new.actualizado_comercial_en := now();
  end if;
  return new;
end;
$$;

create trigger expedientes_estado_comercial before insert or update on aml.expedientes
  for each row execute function aml.calcular_estado_comercial();

-- Vistas operativas: estado comercial y su propia marca de tiempo (la de
-- actualizado_en cambiaba al abrir un examen).
create or replace view aml.expedientes_comercial as
select e.id, e.organizacion_id, e.operacion_id, e.cliente_id, e.parte,
       e.estado_comercial as estado,
       e.contacto_nombre, e.contacto_telefono, e.contacto_correo,
       e.whatsapp_vinculado_en is not null as whatsapp_vinculado,
       e.creado_en, e.actualizado_comercial_en as actualizado_en
  from aml.expedientes e
 where aml.es_miembro(e.organizacion_id);

create or replace view aml.operaciones_comercial as
select o.id                         as operacion_id,
       o.organizacion_id,
       o.codigo,
       o.tipo,
       o.precio,
       o.moneda,
       o.inmueble,
       o.estado                     as estado_operacion,
       o.creado_en                  as operacion_creada_en,
       e.id                         as expediente_id,
       e.parte,
       e.tipo_persona,
       e.contacto_nombre,
       e.contacto_telefono,
       e.contacto_correo,
       e.estado_comercial           as estado,
       (select count(*) from aml.pendientes p
         where p.expediente_id = e.id and p.estado = 'abierto') as pendientes,
       e.whatsapp_vinculado_en is not null as whatsapp_vinculado,
       e.actualizado_comercial_en   as actualizado_en
  from aml.operaciones o
  join aml.expedientes e on e.operacion_id = o.id and e.organizacion_id = o.organizacion_id
 where aml.es_miembro(o.organizacion_id);

-- El portal recibe el estado comercial, nunca el real.
drop function aml.expediente_por_enlace(text);
create function aml.expediente_por_enlace(p_token_hash text)
returns table (
  expediente_id uuid,
  organizacion_id uuid,
  vigente boolean,
  estado text,
  marca jsonb,
  nombre_comercial text
)
language sql
stable
security definer
set search_path = aml, public, pg_temp
as $$
  select e.id, e.organizacion_id, coalesce(e.enlace_expira_en > now(), false), e.estado_comercial,
         o.marca, o.nombre_comercial
    from aml.expedientes e
    join aml.organizaciones o on o.id = e.organizacion_id
   where e.enlace_token_hash = p_token_hash
$$;
revoke execute on function aml.expediente_por_enlace(text) from public;
grant execute on function aml.expediente_por_enlace(text) to service_role;

-- ===========================================================================
-- 4. Verificaciones (C2, A6): solo se disponen las posibles coincidencias
-- ===========================================================================
revoke update on aml.verificaciones from authenticated;
grant update (resultado, justificacion, dispuesto_por, dispuesto_en) on aml.verificaciones to authenticated;

create or replace function aml.proteger_verificacion()
returns trigger
language plpgsql
as $$
begin
  if (new.organizacion_id, new.expediente_id, new.persona_relacionada_id, new.nombre_consultado, new.fuente,
      new.version_fuente, new.consultado_en, new.coincidencias)
     is distinct from
     (old.organizacion_id, old.expediente_id, old.persona_relacionada_id, old.nombre_consultado, old.fuente,
      old.version_fuente, old.consultado_en, old.coincidencias) then
    raise exception 'El resultado de una consulta a listas no se modifica' using errcode = 'P0001';
  end if;
  if old.resultado <> 'posible_coincidencia' then
    raise exception 'Una verificación ya dispuesta no se modifica' using errcode = 'P0001';
  end if;
  if new.resultado not in ('descartada', 'coincidencia_confirmada') then
    raise exception 'Una posible coincidencia solo se descarta o se confirma' using errcode = 'P0001';
  end if;
  if new.dispuesto_por is null or length(trim(coalesce(new.justificacion, ''))) < 20 then
    raise exception 'La disposición requiere responsable y justificación de al menos 20 caracteres' using errcode = '23514';
  end if;
  new.dispuesto_en := now();
  return new;
end;
$$;

create trigger verificaciones_proteger before update on aml.verificaciones
  for each row execute function aml.proteger_verificacion();

-- A6: el plazo del art. 43 corre desde que existe la coincidencia. Una posible
-- coincidencia abre de inmediato una alerta con vencimiento a 24 horas desde
-- la consulta; al disponerse, la alerta se cierra o sigue como confirmada.
create or replace function aml.alerta_por_verificacion()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.resultado = 'posible_coincidencia' then
    insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion, evidencia, vence_en)
    values (new.organizacion_id, new.expediente_id, 'ONU_POSIBLE',
            'Posible coincidencia con lista del Consejo de Seguridad. Disponer y, si se confirma, comunicar al Ministerio Público dentro de 24 horas desde su detección.',
            jsonb_build_object('verificacionId', new.id, 'detectadaEn', new.consultado_en),
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
  end if;
  return new;
end;
$$;

create trigger verificaciones_alerta after insert or update on aml.verificaciones
  for each row execute function aml.alerta_por_verificacion();

-- ===========================================================================
-- 5. Alertas (C2, A6, B4): columnas protegidas, sin reabrir, sin duplicados
-- ===========================================================================
revoke update on aml.alertas from authenticated;
grant update (estado, cierre, cerrada_en, responsable) on aml.alertas to authenticated;

create or replace function aml.preparar_alerta()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_detectada timestamptz;
begin
  -- B4: no se duplica una alerta abierta con la misma señal y la misma evidencia
  if exists (select 1 from aml.alertas a
              where a.expediente_id = new.expediente_id and a.senal = new.senal and a.estado <> 'cerrada'
                and coalesce(a.evidencia->>'verificacionId', '') = coalesce(new.evidencia->>'verificacionId', '')) then
    return null;
  end if;
  -- A6: la alerta de coincidencia confirmada conserva el vencimiento contado
  -- desde la detección, aunque quien la cree calcule otro.
  if new.senal = 'ONU_CONFIRMADA' and new.evidencia ? 'verificacionId' then
    select v.consultado_en into v_detectada
      from aml.verificaciones v where v.id = (new.evidencia->>'verificacionId')::uuid;
    if v_detectada is not null then
      new.vence_en := least(coalesce(new.vence_en, 'infinity'::timestamptz), v_detectada + interval '24 hours');
    end if;
  end if;
  return new;
end;
$$;

create trigger alertas_preparar before insert on aml.alertas
  for each row execute function aml.preparar_alerta();

create or replace function aml.proteger_alerta()
returns trigger
language plpgsql
as $$
begin
  if (new.organizacion_id, new.expediente_id, new.senal, new.descripcion, new.vence_en, new.creado_en)
     is distinct from (old.organizacion_id, old.expediente_id, old.senal, old.descripcion, old.vence_en, old.creado_en) then
    raise exception 'La señal, la descripción y el vencimiento de una alerta no se modifican' using errcode = 'P0001';
  end if;
  if old.estado = 'cerrada' then
    raise exception 'Una alerta cerrada no se reabre ni se modifica' using errcode = 'P0001';
  end if;
  if aml.es_usuario_final() and new.evidencia is distinct from old.evidencia then
    raise exception 'La evidencia de una alerta no se modifica' using errcode = '42501';
  end if;
  if new.estado = 'cerrada' and length(trim(coalesce(new.cierre, ''))) < 20 then
    raise exception 'El cierre de una alerta requiere al menos 20 caracteres' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger alertas_proteger before update on aml.alertas
  for each row execute function aml.proteger_alerta();

-- ===========================================================================
-- 6. Evaluaciones (C2, M1): el motor no se reescribe; ajuste único y no por
--    debajo del nivel mínimo que imponen las reglas
-- ===========================================================================
alter table aml.evaluaciones_riesgo add column nivel_minimo aml.nivel_riesgo;

revoke update on aml.evaluaciones_riesgo from authenticated;
grant update (nivel_ajustado, justificacion_ajuste, ajustado_por) on aml.evaluaciones_riesgo to authenticated;

create or replace function aml.preparar_evaluacion()
returns trigger
language plpgsql
as $$
declare
  v_min aml.nivel_riesgo := 'bajo';
  r jsonb;
begin
  if tg_op = 'INSERT' then
    for r in select * from jsonb_array_elements(coalesce(new.reglas_impuestas, '[]'::jsonb)) loop
      if r->>'nivelMinimo' in ('bajo', 'medio', 'alto') and (r->>'nivelMinimo')::aml.nivel_riesgo > v_min then
        v_min := (r->>'nivelMinimo')::aml.nivel_riesgo;
      end if;
      if r->>'codigo' = 'ONU_CONFIRMADA' then v_min := 'alto'; end if;
    end loop;
    new.nivel_minimo := v_min;
    if new.nivel_calculado < v_min then
      raise exception 'El nivel calculado no puede ser menor que el mínimo de las reglas' using errcode = '23514';
    end if;
    if new.nivel_ajustado is not null then
      raise exception 'El ajuste se registra después de la evaluación' using errcode = '23514';
    end if;
    return new;
  end if;

  if (new.organizacion_id, new.expediente_id, new.configuracion_id, new.entrada, new.puntajes, new.puntaje_total,
      new.nivel_calculado, new.medidas, new.reglas_impuestas, new.senales, new.calculado_en, new.nivel_minimo)
     is distinct from
     (old.organizacion_id, old.expediente_id, old.configuracion_id, old.entrada, old.puntajes, old.puntaje_total,
      old.nivel_calculado, old.medidas, old.reglas_impuestas, old.senales, old.calculado_en, old.nivel_minimo) then
    raise exception 'El resultado del motor de riesgo no se modifica' using errcode = 'P0001';
  end if;
  if old.nivel_ajustado is not null then
    raise exception 'El nivel de esta evaluación ya fue ajustado; calcule una evaluación nueva' using errcode = 'P0001';
  end if;
  if new.nivel_ajustado is not null and new.nivel_ajustado < coalesce(old.nivel_minimo, 'bajo') then
    raise exception 'El nivel ajustado no puede ser menor que el mínimo impuesto por las reglas (%)', old.nivel_minimo
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger evaluaciones_preparar before insert or update on aml.evaluaciones_riesgo
  for each row execute function aml.preparar_evaluacion();

-- ===========================================================================
-- 7. Datos, pendientes y documentos (C2, M4, M9)
-- ===========================================================================
drop policy datos_gestionar on aml.datos_expediente;
revoke insert, update, delete on aml.datos_expediente from authenticated;

alter table aml.datos_expediente add column nota text;

create or replace function aml.proteger_dato()
returns trigger
language plpgsql
as $$
begin
  if aml.es_usuario_final() then
    raise exception 'Los datos del expediente solo se registran por las funciones del servidor' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.organizacion_id, new.expediente_id, new.campo, new.valor, new.origen,
                           new.documento_id, new.pagina, new.confianza, new.creado_en)
                          is distinct from
                          (old.organizacion_id, old.expediente_id, old.campo, old.valor, old.origen,
                           old.documento_id, old.pagina, old.confianza, old.creado_en) then
    raise exception 'Un dato registrado no se modifica: se registra uno nuevo' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.vigente and not old.vigente then
    raise exception 'Un dato sin vigencia no se reactiva' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger datos_proteger before insert or update on aml.datos_expediente
  for each row execute function aml.proteger_dato();

-- Estados en que el cliente ya no modifica su expediente.
create or replace function aml.expediente_cerrado_para_cliente(p aml.estado_expediente)
returns boolean language sql immutable as $$ select p in ('aprobado', 'rechazado', 'abstenido') $$;

-- guardar_dato (servidor): mismas firmas; ahora respeta el estado. Si el
-- cliente aporta información con el expediente en revisión, vuelve a captura
-- para que se revise de nuevo. En examen o con verificación diferida acepta
-- datos sin cambiar el estado (no se delata el examen).
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
  v_estado aml.estado_expediente;
  v_id uuid;
begin
  select organizacion_id, estado into v_org, v_estado from aml.expedientes where id = p_expediente for update;
  if v_org is null then
    raise exception 'Expediente inexistente' using errcode = '22023';
  end if;
  if p_origen in ('cliente', 'documento') and aml.expediente_cerrado_para_cliente(v_estado) then
    raise exception 'El expediente no admite cambios en este momento' using errcode = 'P0001';
  end if;
  update aml.datos_expediente set vigente = false
   where expediente_id = p_expediente and campo = p_campo and vigente;
  insert into aml.datos_expediente (organizacion_id, expediente_id, campo, valor, origen, documento_id,
                                    pagina, confianza, confirmado_por, confirmado_en)
  values (v_org, p_expediente, p_campo, p_valor, p_origen, p_documento, p_pagina, p_confianza,
          p_confirmado_por, case when p_confirmado_por is null then null else now() end)
  returning id into v_id;

  if v_estado = 'invitado' then
    update aml.expedientes set estado = 'en_captura' where id = p_expediente;
  elsif v_estado in ('en_revision', 'listo_para_decision') and p_origen in ('cliente', 'documento') then
    update aml.expedientes set estado = 'en_captura' where id = p_expediente;
  end if;
  return v_id;
end;
$$;

create or replace function aml.confirmar_dato(p_expediente uuid, p_campo text, p_confirmado_por text)
returns boolean
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_estado aml.estado_expediente;
begin
  select estado into v_estado from aml.expedientes where id = p_expediente for update;
  if v_estado is null then
    raise exception 'Expediente inexistente' using errcode = '22023';
  end if;
  if aml.expediente_cerrado_para_cliente(v_estado) then
    raise exception 'El expediente no admite cambios en este momento' using errcode = 'P0001';
  end if;
  update aml.datos_expediente
     set confirmado_por = p_confirmado_por, confirmado_en = now()
   where expediente_id = p_expediente and campo = p_campo and vigente;
  if not found then
    return false;
  end if;
  if v_estado in ('en_revision', 'listo_para_decision') then
    update aml.expedientes set estado = 'en_captura' where id = p_expediente;
  end if;
  return true;
end;
$$;

-- El oficial corrige un dato con su nombre: origen 'revisor', nunca 'cliente'.
create or replace function aml.corregir_dato_oficial(p_expediente uuid, p_campo text, p_valor jsonb, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  select organizacion_id into v_org from aml.expedientes where id = p_expediente for update;
  if v_org is null or not aml.puede_decidir(v_org) then
    raise exception 'Solo el oficial de cumplimiento corrige datos del expediente' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Indique el motivo de la corrección' using errcode = '23514';
  end if;
  update aml.datos_expediente set vigente = false where expediente_id = p_expediente and campo = p_campo and vigente;
  insert into aml.datos_expediente (organizacion_id, expediente_id, campo, valor, origen, confirmado_por, confirmado_en, nota)
  values (v_org, p_expediente, p_campo, p_valor, 'revisor', auth.uid()::text, now(), p_motivo)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function aml.corregir_dato_oficial(uuid, text, jsonb, text) from public;
grant execute on function aml.corregir_dato_oficial(uuid, text, jsonb, text) to authenticated;

-- Pendientes: el oficial resuelve o justifica, pero no reescribe el texto que
-- ve el cliente (M9).
revoke update on aml.pendientes from authenticated;
grant update (estado, justificacion, resuelto_en) on aml.pendientes to authenticated;

-- Documentos: el archivo, su sello y su tipo no cambian (art. 34).
revoke update on aml.documentos from authenticated;
grant update (estado) on aml.documentos to authenticated;

create or replace function aml.proteger_documento()
returns trigger
language plpgsql
as $$
begin
  if (new.organizacion_id, new.expediente_id, new.persona_relacionada_id, new.tipo, new.ruta_storage, new.sha256,
      new.mime, new.tamano_bytes, new.canal, new.creado_en)
     is distinct from
     (old.organizacion_id, old.expediente_id, old.persona_relacionada_id, old.tipo, old.ruta_storage, old.sha256,
      old.mime, old.tamano_bytes, old.canal, old.creado_en) then
    raise exception 'Un documento recibido no se modifica' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger documentos_proteger before update on aml.documentos
  for each row execute function aml.proteger_documento();

-- ===========================================================================
-- 8. Decisiones (A1, M4, B8, B1): transiciones, cotejo ONU obligatorio,
--    evaluación vigente, motivo del suplente y fin de la relación
-- ===========================================================================
alter table aml.decisiones add column motivo_suplencia text;

create or replace function aml.aplicar_decision()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  rol_actual aml.rol_usuario;
  v_exp aml.expedientes;
  verif_pendientes integer;
  v_nombre text;
  v_representante text;
  v_ev aml.evaluaciones_riesgo;
  v_ultimo_dato timestamptz;
  permitidos aml.estado_expediente[];
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
  -- Art. 16: el suplente actúa en ausencia del titular; queda el motivo.
  if rol_actual = 'oficial_suplente' and length(trim(coalesce(new.motivo_suplencia, ''))) < 10 then
    raise exception 'El suplente debe indicar el motivo de la suplencia (ausencia del titular)' using errcode = '23514';
  end if;

  select * into v_exp from aml.expedientes
   where id = new.expediente_id and organizacion_id = new.organizacion_id
   for update;
  if v_exp.id is null then
    raise exception 'Expediente inexistente' using errcode = '22023';
  end if;

  -- Transiciones permitidas
  permitidos := (case new.tipo
    when 'aprobar'          then array['en_revision', 'listo_para_decision', 'en_examen', 'aprobado_condicionado']
    when 'aprobar_diferida' then array['en_revision', 'listo_para_decision', 'en_examen']
    when 'intensificar'     then array['en_captura', 'en_revision', 'listo_para_decision', 'en_examen']
    when 'abrir_examen'     then array['invitado', 'en_captura', 'en_revision', 'listo_para_decision', 'aprobado',
                                       'aprobado_condicionado', 'rechazado', 'abstenido']
    else                         array['invitado', 'en_captura', 'en_revision', 'listo_para_decision', 'en_examen',
                                       'aprobado', 'aprobado_condicionado']
  end)::aml.estado_expediente[];
  if not (v_exp.estado = any (permitidos)) then
    raise exception 'La decisión "%" no procede con el expediente en estado "%"', new.tipo, v_exp.estado
      using errcode = 'P0001';
  end if;

  if new.evaluacion_id is not null
     and not exists (select 1 from aml.evaluaciones_riesgo ev where ev.id = new.evaluacion_id and ev.expediente_id = new.expediente_id) then
    raise exception 'La evaluación indicada no corresponde al expediente' using errcode = '22023';
  end if;

  if new.tipo in ('aprobar', 'aprobar_diferida') then
    -- No se aprueba con coincidencias sin descartar
    select count(*) into verif_pendientes
      from aml.verificaciones v
     where v.expediente_id = new.expediente_id
       and v.resultado in ('posible_coincidencia', 'coincidencia_confirmada');
    if verif_pendientes > 0 then
      raise exception 'Hay % verificación(es) con coincidencia sin descartar', verif_pendientes
        using errcode = 'P0001';
    end if;

    -- A1: debe existir cotejo ONU del nombre vigente del cliente (art. 43)
    select d.valor #>> '{}' into v_nombre
      from aml.datos_expediente d
     where d.expediente_id = new.expediente_id and d.vigente
       and d.campo = case when v_exp.tipo_persona = 'individual' then 'cliente.nombre_completo' else 'entidad.razon_social' end;
    if v_nombre is null or length(trim(v_nombre)) = 0 then
      raise exception 'El expediente no tiene identificado el nombre del cliente' using errcode = 'P0001';
    end if;
    if not exists (select 1 from aml.verificaciones v
                    where v.expediente_id = new.expediente_id and v.fuente = 'onu'
                      and v.resultado in ('sin_coincidencia', 'descartada')
                      and aml.normalizar_nombre(v.nombre_consultado) = aml.normalizar_nombre(v_nombre)) then
      raise exception 'No hay cotejo con la lista de la ONU para el nombre vigente del cliente' using errcode = 'P0001';
    end if;
    select d.valor #>> '{}' into v_representante
      from aml.datos_expediente d
     where d.expediente_id = new.expediente_id and d.vigente and d.campo = 'representante.nombre_completo';
    if v_representante is not null and length(trim(v_representante)) > 0
       and not exists (select 1 from aml.verificaciones v
                        where v.expediente_id = new.expediente_id and v.fuente = 'onu'
                          and v.resultado in ('sin_coincidencia', 'descartada')
                          and aml.normalizar_nombre(v.nombre_consultado) = aml.normalizar_nombre(v_representante)) then
      raise exception 'No hay cotejo con la lista de la ONU para el representante' using errcode = 'P0001';
    end if;

    -- M4: la evaluación usada debe ser posterior al último cambio de datos
    select * into v_ev from aml.evaluaciones_riesgo ev
     where ev.expediente_id = new.expediente_id
     order by ev.calculado_en desc limit 1;
    if v_ev.id is null then
      raise exception 'Evalúe el riesgo antes de aprobar' using errcode = 'P0001';
    end if;
    select max(greatest(d.creado_en, coalesce(d.confirmado_en, d.creado_en))) into v_ultimo_dato
      from aml.datos_expediente d where d.expediente_id = new.expediente_id;
    if v_ultimo_dato is not null and v_ultimo_dato > v_ev.calculado_en then
      raise exception 'Los datos del expediente cambiaron después de la última evaluación: vuelva a evaluar'
        using errcode = 'P0001';
    end if;
    if new.evaluacion_id is null then
      new.evaluacion_id := v_ev.id;
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
         -- Art. 34: sin relación (rechazo o abstención) el plazo corre desde hoy
         fin_relacion = case when new.tipo in ('rechazar', 'abstener')
                             then coalesce(e.fin_relacion, (now() at time zone 'America/Guatemala')::date)
                             else e.fin_relacion end,
         actualizado_en = now()
   where e.id = new.expediente_id
     and e.organizacion_id = new.organizacion_id;
  return new;
end;
$$;

-- ===========================================================================
-- 9. Fin de la relación al cerrar la operación (art. 34, B1)
-- ===========================================================================
create or replace function aml.fin_relacion_por_operacion()
returns trigger
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
begin
  if new.estado in ('cerrada', 'cancelada') and old.estado = 'abierta' then
    new.cerrada_en := coalesce(new.cerrada_en, now());
    update aml.expedientes
       set fin_relacion = coalesce(fin_relacion, (new.cerrada_en at time zone 'America/Guatemala')::date)
     where operacion_id = new.id and organizacion_id = new.organizacion_id;
  elsif new.estado is distinct from old.estado then
    raise exception 'Una operación cerrada o cancelada no se reabre' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger operaciones_fin_relacion before update of estado on aml.operaciones
  for each row execute function aml.fin_relacion_por_operacion();

-- La inmobiliaria cierra (escritura otorgada) o cancela la operación.
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
  update aml.operaciones set estado = p_estado, cerrada_en = now() where id = p_operacion and estado = 'abierta';
  if not found then
    raise exception 'La operación ya está cerrada o cancelada' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function aml.cerrar_operacion(uuid, aml.estado_operacion) from public;
grant execute on function aml.cerrar_operacion(uuid, aml.estado_operacion) to authenticated, service_role;

-- ===========================================================================
-- 10. Vinculación de WhatsApp (A3, B6): código con sal, ligado al teléfono
--     registrado y con límite de intentos
-- ===========================================================================
create table aml.intentos_vinculacion (
  id               bigint generated always as identity primary key,
  organizacion_id  uuid not null references aml.organizaciones(id) on delete restrict,
  wa_id            text not null,
  exito            boolean not null,
  intentado_en     timestamptz not null default now()
);
create index on aml.intentos_vinculacion (wa_id, intentado_en);
create index on aml.intentos_vinculacion (organizacion_id, intentado_en);
alter table aml.intentos_vinculacion enable row level security;
grant all on aml.intentos_vinculacion to service_role;

-- El servidor fija el código del expediente. El hash lleva como sal el id del
-- expediente: el mismo código en dos expedientes no colisiona y una copia de
-- la tabla no revela los códigos con una tabla de 10^6 valores.
create or replace function aml.fijar_codigo_vinculacion(p_expediente uuid, p_codigo text, p_minutos integer default 30)
returns timestamptz
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_expira timestamptz := now() + make_interval(mins => least(greatest(coalesce(p_minutos, 30), 5), 60));
begin
  if p_codigo !~ '^\d{6}$' then
    raise exception 'El código debe tener 6 dígitos' using errcode = '22023';
  end if;
  update aml.expedientes
     set codigo_vinculacion_hash = encode(digest(id::text || ':' || p_codigo, 'sha256'), 'hex'),
         codigo_vinculacion_expira = v_expira
   where id = p_expediente;
  if not found then
    raise exception 'Expediente inexistente' using errcode = '22023';
  end if;
  return v_expira;
end;
$$;
revoke execute on function aml.fijar_codigo_vinculacion(uuid, text, integer) from public;
grant execute on function aml.fijar_codigo_vinculacion(uuid, text, integer) to service_role;

create or replace function aml.vincular_whatsapp(p_phone_number_id text, p_wa_id text, p_codigo text)
returns uuid
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_org uuid;
  v_exp uuid;
  v_wa text := regexp_replace(coalesce(p_wa_id, ''), '\D', '', 'g');
begin
  select organizacion_id into v_org from aml.canales_whatsapp where phone_number_id = p_phone_number_id;
  if v_org is null or v_wa = '' then
    return null;
  end if;

  -- Límites: 5 fallos por número en una hora; 30 fallos por organización en
  -- 10 minutos (frena el intento masivo desde muchos números).
  if (select count(*) from aml.intentos_vinculacion
       where wa_id = v_wa and not exito and intentado_en > now() - interval '1 hour') >= 5
     or (select count(*) from aml.intentos_vinculacion
          where organizacion_id = v_org and not exito and intentado_en > now() - interval '10 minutes') >= 30 then
    insert into aml.intentos_vinculacion (organizacion_id, wa_id, exito) values (v_org, v_wa, false);
    return null;
  end if;

  if coalesce(p_codigo, '') ~ '^\d{6}$' then
    select e.id into v_exp
      from aml.expedientes e
     where e.organizacion_id = v_org
       and e.codigo_vinculacion_expira > now()
       and e.codigo_vinculacion_hash = encode(digest(e.id::text || ':' || p_codigo, 'sha256'), 'hex')
       -- Si el ejecutivo registró un teléfono, solo ese número puede vincularse
       and (e.contacto_telefono is null or regexp_replace(e.contacto_telefono, '\D', '', 'g') = v_wa)
     order by e.codigo_vinculacion_expira desc
     limit 1
     for update;
  end if;

  if v_exp is null then
    insert into aml.intentos_vinculacion (organizacion_id, wa_id, exito) values (v_org, v_wa, false);
    return null;
  end if;

  update aml.expedientes
     set whatsapp_wa_id = v_wa,
         whatsapp_vinculado_en = now(),
         codigo_vinculacion_hash = null,
         codigo_vinculacion_expira = null
   where id = v_exp;
  insert into aml.intentos_vinculacion (organizacion_id, wa_id, exito) values (v_org, v_wa, true);
  return v_exp;
end;
$$;

-- ===========================================================================
-- 11. Metodología de riesgo (M2): el oficial propone, la plataforma registra
--     la aprobación del órgano de dirección (art. 8); validación en la base
-- ===========================================================================
drop policy config_crear on aml.configuraciones_riesgo;
create policy config_proponer on aml.configuraciones_riesgo for insert to authenticated
  with check (aml.puede_decidir(organizacion_id) and aprobada_en is null and aprobada_por is null);
revoke update, delete on aml.configuraciones_riesgo from authenticated;

-- Reglas mínimas que la ley impone a cualquier metodología (mismas que
-- validarConfiguracion en packages/riesgo). Devuelve el motivo o null.
create or replace function aml.motivo_configuracion_invalida(p jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_suma numeric;
begin
  if p is null or jsonb_typeof(p->'pesosFactores') <> 'object' or jsonb_typeof(p->'umbrales') <> 'object'
     or jsonb_typeof(p->'actualizacionMeses') <> 'object' then
    return 'Faltan pesosFactores, umbrales o actualizacionMeses';
  end if;
  v_suma := coalesce((p->'pesosFactores'->>'cliente')::numeric, 0) + coalesce((p->'pesosFactores'->>'geografia')::numeric, 0)
          + coalesce((p->'pesosFactores'->>'canal')::numeric, 0) + coalesce((p->'pesosFactores'->>'producto')::numeric, 0);
  if abs(v_suma - 1) > 0.000001 then
    return format('Los pesos de los factores suman %s, deben sumar 1', v_suma);
  end if;
  if not ((p->'umbrales'->>'medio')::numeric > 0
          and (p->'umbrales'->>'medio')::numeric < (p->'umbrales'->>'alto')::numeric
          and (p->'umbrales'->>'alto')::numeric <= 100) then
    return 'Umbrales inválidos: se requiere 0 < medio < alto <= 100';
  end if;
  if coalesce((p->'actualizacionMeses'->>'alto')::numeric, 999) > 12 then
    return 'Clientes de riesgo alto: actualización al menos anual (art. 22)';
  end if;
  if coalesce((p->>'umbralEfectivoUsd')::numeric, 0) > 10000 or (p->>'umbralEfectivoUsd') is null then
    return 'El umbral de efectivo debe existir y no superar USD 10,000 (art. 31)';
  end if;
  return null;
exception when others then
  return 'Parámetros con formato inválido';
end;
$$;

create or replace function aml.validar_aprobacion_configuracion()
returns trigger
language plpgsql
as $$
declare
  v_motivo text;
begin
  if new.aprobada_en is not null and (tg_op = 'INSERT' or old.aprobada_en is null) then
    if aml.es_usuario_final() then
      raise exception 'La aprobación de la metodología la registra la plataforma con el acta del órgano de dirección (art. 8)'
        using errcode = '42501';
    end if;
    v_motivo := aml.motivo_configuracion_invalida(new.parametros);
    if v_motivo is not null then
      raise exception 'Metodología inválida: %', v_motivo using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger configuraciones_validar before insert or update on aml.configuraciones_riesgo
  for each row execute function aml.validar_aprobacion_configuracion();

-- ===========================================================================
-- 12. Listas GAFI (M6): la fecha del pleno no puede ser futura
-- ===========================================================================
create or replace function aml.validar_lista_gafi()
returns trigger
language plpgsql
as $$
begin
  if new.plenario > (now() at time zone 'America/Guatemala')::date then
    raise exception 'La fecha del pleno no puede ser futura' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger listas_gafi_validar before insert on aml.listas_gafi
  for each row execute function aml.validar_lista_gafi();

-- ===========================================================================
-- 13. Efectivo estructurado en varios días (B2, art. 31)
-- ===========================================================================
-- Suma móvil de 30 días por cliente (o por expediente mientras no hay
-- cliente). Señala fraccionamientos que no se ven en el corte diario.
create view aml.efectivo_acumulado_30_dias with (security_invoker = true) as
select p.organizacion_id, p.cliente_id, p.expediente_id, p.fecha,
       (select sum(q.monto_usd) from aml.pagos_efectivo q
         where q.organizacion_id = p.organizacion_id
           and coalesce(q.cliente_id, q.expediente_id) = coalesce(p.cliente_id, p.expediente_id)
           and q.fecha between p.fecha - 29 and p.fecha) as total_30_dias_usd,
       (select sum(q.monto_usd) from aml.pagos_efectivo q
         where q.organizacion_id = p.organizacion_id
           and coalesce(q.cliente_id, q.expediente_id) = coalesce(p.cliente_id, p.expediente_id)
           and q.fecha between p.fecha - 29 and p.fecha) >= 10000 as revisar_estructuracion
  from (select distinct organizacion_id, cliente_id, expediente_id, fecha from aml.pagos_efectivo) p;

grant select on aml.efectivo_acumulado_30_dias to authenticated, service_role;
