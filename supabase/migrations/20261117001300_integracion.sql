-- Agente AML · Integración aplicación ↔ base después de las correcciones de seguridad
--
-- 1. Las acciones del oficial que antes eran UPDATE directos con el JWT del
--    usuario (disponer una coincidencia, cerrar una alerta, ajustar el nivel)
--    pasan por funciones SECURITY DEFINER con search_path fijo que validan el
--    rol, fijan al responsable con auth.uid() y devuelven lo que la API
--    necesita. Se retiran los permisos de columna que dejaban la vía directa.
-- 2. El actor de la bitácora para escrituras del servidor (service_role) se
--    toma de las cabeceras x-aml-actor-tipo / x-aml-actor-id que envía la
--    aplicación (PostgREST las expone en request.headers). Solo se aceptan si
--    la solicitud viene con la llave de servicio; un usuario final no puede
--    suplantar a otro actor porque para él manda auth.uid().
-- 3. Tabla de anclas de la bitácora, solo para el servidor, inmutable.

-- ===========================================================================
-- 1. Acciones del oficial
-- ===========================================================================

create or replace function aml.disponer_verificacion(p_verificacion uuid, p_resultado text, p_justificacion text)
returns table (verificacion_id uuid, organizacion_id uuid, expediente_id uuid, consultado_en timestamptz)
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v aml.verificaciones;
begin
  select * into v from aml.verificaciones x where x.id = p_verificacion for update;
  if v.id is null or not aml.puede_decidir(v.organizacion_id) then
    raise exception 'Solo el oficial de cumplimiento dispone coincidencias' using errcode = '42501';
  end if;
  if p_resultado not in ('descartada', 'coincidencia_confirmada') then
    raise exception 'Una posible coincidencia solo se descarta o se confirma' using errcode = '22023';
  end if;
  if v.resultado <> 'posible_coincidencia' then
    raise exception 'La verificación ya fue dispuesta' using errcode = 'P0001';
  end if;
  update aml.verificaciones x
     set resultado = p_resultado::aml.resultado_verificacion,
         justificacion = p_justificacion,
         dispuesto_por = auth.uid(),
         dispuesto_en = now()
   where x.id = p_verificacion;
  return query select v.id, v.organizacion_id, v.expediente_id, v.consultado_en;
end;
$$;

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
  update aml.alertas x
     set estado = 'cerrada', cierre = p_cierre, cerrada_en = now(), responsable = auth.uid()
   where x.id = p_alerta;
  return query select a.id, a.organizacion_id, a.expediente_id;
end;
$$;

create or replace function aml.ajustar_nivel_evaluacion(p_evaluacion uuid, p_nivel aml.nivel_riesgo, p_justificacion text)
returns void
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_org uuid;
begin
  select ev.organizacion_id into v_org from aml.evaluaciones_riesgo ev where ev.id = p_evaluacion for update;
  if v_org is null or not aml.puede_decidir(v_org) then
    raise exception 'Solo el oficial de cumplimiento ajusta el nivel de riesgo' using errcode = '42501';
  end if;
  -- El disparador evaluaciones_preparar impide ajustar dos veces o por debajo del mínimo de las reglas.
  update aml.evaluaciones_riesgo
     set nivel_ajustado = p_nivel, justificacion_ajuste = p_justificacion, ajustado_por = auth.uid()
   where id = p_evaluacion;
end;
$$;

revoke execute on function aml.disponer_verificacion(uuid, text, text) from public;
revoke execute on function aml.cerrar_alerta(uuid, text) from public;
revoke execute on function aml.ajustar_nivel_evaluacion(uuid, aml.nivel_riesgo, text) from public;
grant execute on function aml.disponer_verificacion(uuid, text, text) to authenticated;
grant execute on function aml.cerrar_alerta(uuid, text) to authenticated;
grant execute on function aml.ajustar_nivel_evaluacion(uuid, aml.nivel_riesgo, text) to authenticated;

-- La vía directa queda cerrada: solo las funciones anteriores modifican estas tablas por un usuario final.
revoke update (resultado, justificacion, dispuesto_por, dispuesto_en) on aml.verificaciones from authenticated;
revoke update (estado, cierre, cerrada_en, responsable) on aml.alertas from authenticated;
revoke update (nivel_ajustado, justificacion_ajuste, ajustado_por) on aml.evaluaciones_riesgo from authenticated;
revoke update on aml.verificaciones, aml.alertas, aml.evaluaciones_riesgo from authenticated;
drop policy if exists verificaciones_disponer on aml.verificaciones;
drop policy if exists alertas_gestionar on aml.alertas;
drop policy if exists evaluaciones_ajustar on aml.evaluaciones_riesgo;

-- Al confirmar una posible coincidencia, la base ya cerraba la alerta
-- ONU_POSIBLE remitiendo a "la alerta ONU_CONFIRMADA", pero esa alerta solo la
-- creaba después el flujo plazoOnu24h: entre ambos momentos el expediente
-- quedaba sin alerta abierta y, si el evento se perdía, sin ninguna. Ahora la
-- alerta confirmada se abre en la misma transacción que la disposición, con el
-- vencimiento contado desde la detección (art. 43).
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
    if new.resultado = 'coincidencia_confirmada' then
      -- preparar_alerta evita el duplicado si ya existe una abierta para esta verificación
      insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion, evidencia, vence_en)
      values (new.organizacion_id, new.expediente_id, 'ONU_CONFIRMADA',
              'Coincidencia confirmada con las listas del Consejo de Seguridad (art. 43). Limite con efecto preventivo la disposición de fondos o activos bajo su administración y comunique por escrito al Ministerio Público, con la documentación, dentro de las 24 horas desde la detección.',
              jsonb_build_object('verificacionId', new.id, 'detectadaEn', new.consultado_en,
                                 'confirmadaEn', coalesce(new.dispuesto_en, now())),
              new.consultado_en + interval '24 hours');
    end if;
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 2. Actor de la bitácora para escrituras del servidor
-- ===========================================================================

-- true si la solicitud actual viene de PostgREST con la llave de servicio.
create or replace function aml.solicitud_de_servicio()
returns boolean
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    nullif(current_setting('request.jwt.claim.role', true), '')
  ) = 'service_role'
$$;

-- Actor declarado por el servidor: variables de transacción (funciones SQL)
-- o cabeceras HTTP (llamadas REST con la llave de servicio).
create or replace function aml.actor_declarado(out tipo text, out actor text)
language plpgsql
stable
as $$
declare
  cab jsonb;
begin
  tipo := nullif(current_setting('aml.actor_tipo', true), '');
  actor := nullif(current_setting('aml.actor_id', true), '');
  if tipo is null and aml.solicitud_de_servicio() then
    cab := nullif(current_setting('request.headers', true), '')::jsonb;
    tipo := nullif(cab->>'x-aml-actor-tipo', '');
    actor := left(nullif(cab->>'x-aml-actor-id', ''), 120);
  end if;
  if tipo not in ('usuario', 'cliente', 'agente', 'sistema') then
    tipo := null; actor := null;
  end if;
exception when others then
  tipo := null; actor := null;
end;
$$;

-- Misma función de la migración de correcciones, con el actor declarado por
-- el servidor (variables o cabeceras) en el paso 2 de la prioridad.
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
  v_decl record;
begin
  v_org := coalesce((fila->>'organizacion_id')::uuid,
                    case when tg_table_name = 'organizaciones' then (fila->>'id')::uuid end);
  if v_org is null then
    return coalesce(new, old);
  end if;

  select * into v_decl from aml.actor_declarado();

  if v_uid is not null then
    v_tipo := 'usuario'; v_actor := v_uid;
  elsif v_decl.tipo is not null then
    v_tipo := v_decl.tipo; v_actor := v_decl.actor;
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

-- ===========================================================================
-- 3. Anclas de la bitácora (solo servidor, inmutables)
-- ===========================================================================
create table aml.anclas_bitacora (
  id               bigint generated always as identity primary key,
  organizacion_id  uuid not null references aml.organizaciones(id) on delete restrict,
  secuencia        bigint not null,
  hash             char(64) not null,
  verificada_previa boolean,
  registrada_en    timestamptz not null default now(),
  unique (organizacion_id, secuencia)
);
alter table aml.anclas_bitacora enable row level security;
revoke all on aml.anclas_bitacora from public, authenticated, anon;
grant select, insert on aml.anclas_bitacora to service_role;

create trigger anclas_inmutables before update or delete on aml.anclas_bitacora
  for each row execute function aml.impedir_cambios();
create trigger anclas_sin_truncate before truncate on aml.anclas_bitacora
  for each statement execute function aml.impedir_truncate();
