-- Agente AML · Lista SDN de la OFAC (EE. UU.)
--
-- Criterio del responsable de cumplimiento (19-nov-2026, opción A): la OFAC no
-- es una lista del art. 43 del Decreto 15-2026. Una posible coincidencia abre
-- una alerta al oficial; si la confirma, el riesgo sube a alto con debida
-- diligencia intensificada. NO hay bloqueo preventivo, ni plazo de 24 horas,
-- ni comunicación al Ministerio Público. Mientras una posible coincidencia
-- con OFAC no se disponga, el expediente no se aprueba.
--
-- El valor 'ofac' ya existe en aml.fuente_verificacion desde 20261111000100.

-- ===========================================================================
-- 1. La lista: común a todas las organizaciones (igual que la de la ONU)
-- ===========================================================================
create table if not exists aml.lista_ofac_versiones (
  sha256            char(64) primary key,
  generada_el       text,
  registros         integer not null,
  cargada_en        timestamptz not null default now()
);
create table if not exists aml.lista_ofac_registros (
  referencia        text primary key,
  tipo              text not null check (tipo in ('individual', 'entidad')),
  datos             jsonb not null,
  version_sha256    char(64) not null references aml.lista_ofac_versiones(sha256),
  actualizado_en    timestamptz not null default now()
);

alter table aml.lista_ofac_versiones enable row level security;
alter table aml.lista_ofac_registros enable row level security;
drop policy if exists lista_ofac_ver on aml.lista_ofac_versiones;
create policy lista_ofac_ver on aml.lista_ofac_versiones for select to authenticated using (true);
grant select on aml.lista_ofac_versiones to authenticated;
grant all on aml.lista_ofac_versiones, aml.lista_ofac_registros to service_role;

-- ===========================================================================
-- 2. Alertas por verificación: OFAC con su propia señal y sin vencimiento
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
  -- OFAC: alerta al oficial, sin plazo del art. 43
  if new.fuente::text = 'ofac' then
    if tg_op = 'INSERT' and new.resultado = 'posible_coincidencia' then
      insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion, evidencia)
      values (new.organizacion_id, new.expediente_id, 'OFAC_POSIBLE',
              'Posible coincidencia con la lista SDN de la OFAC (EE. UU.). Dispóngala antes de decidir: si se confirma, '
              || 'aplique debida diligencia intensificada y evalúe un reporte de transacción sospechosa. '
              || 'No es lista del art. 43: no hay bloqueo preventivo ni comunicación al Ministerio Público.',
              jsonb_build_object('verificacionId', new.id, 'detectadaEn', new.consultado_en, 'fuente', new.fuente));
    elsif tg_op = 'UPDATE' and old.resultado = 'posible_coincidencia' and new.resultado <> old.resultado then
      update aml.alertas a
         set estado = 'cerrada',
             cierre = case new.resultado
                        when 'descartada' then 'Coincidencia con OFAC descartada por el oficial: ' || new.justificacion
                        else 'Coincidencia con OFAC confirmada: continúa en la alerta OFAC_CONFIRMADA.'
                      end,
             cerrada_en = now(),
             responsable = new.dispuesto_por
       where a.expediente_id = new.expediente_id
         and a.senal = 'OFAC_POSIBLE'
         and a.evidencia->>'verificacionId' = new.id::text
         and a.estado <> 'cerrada';
      if new.resultado = 'coincidencia_confirmada' then
        insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion, evidencia)
        values (new.organizacion_id, new.expediente_id, 'OFAC_CONFIRMADA',
                'Coincidencia confirmada con la lista SDN de la OFAC (EE. UU.). Aplique debida diligencia intensificada, '
                || 'documente el análisis y evalúe si procede un reporte de transacción sospechosa. '
                || 'No activa el bloqueo preventivo del art. 43 ni la comunicación al Ministerio Público.',
                jsonb_build_object('verificacionId', new.id, 'detectadaEn', new.consultado_en,
                                   'confirmadaEn', coalesce(new.dispuesto_en, now()), 'fuente', new.fuente));
      end if;
    end if;
    return new;
  end if;

  -- ONU y designaciones 1373 (art. 43): sin cambios respecto de 20261118001500
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
-- 3. El bloqueo preventivo es solo para las listas del art. 43
-- ===========================================================================
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
  if new.fuente::text not in ('onu', 'designacion_1373') then
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
            || 'El bloqueo preventivo se extiende a este expediente por el nombre: no se aprueba ni se cierra su operación '
            || 'hasta que el oficial lo marque como homónimo o chequeo verificado.',
            jsonb_build_object('verificacionId', new.id, 'expedienteOrigen', new.expediente_id));
  end loop;
  return new;
end;
$$;

-- ===========================================================================
-- 4. Decisiones: una posible coincidencia (de cualquier lista) impide aprobar;
--    una coincidencia con OFAC confirmada no, porque no es lista del art. 43.
--    Copia de 20261117001200 con ese único cambio.
-- ===========================================================================
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
    -- No se aprueba con coincidencias sin descartar. Excepción (20261119001800):
    -- una coincidencia con OFAC confirmada no impide aprobar; exige debida
    -- diligencia intensificada (la evaluación sube a riesgo alto).
    select count(*) into verif_pendientes
      from aml.verificaciones v
     where v.expediente_id = new.expediente_id
       and (v.resultado = 'posible_coincidencia'
            or (v.resultado = 'coincidencia_confirmada' and v.fuente::text <> 'ofac'));
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
