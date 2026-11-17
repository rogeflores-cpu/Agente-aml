-- Agente AML · Liberación de expedientes alcanzados por un bloqueo preventivo
--
-- Criterio del oficial de cumplimiento (17-nov-2026): el bloqueo preventivo se
-- extiende por nombre a los demás expedientes de la organización; en cada uno
-- de ellos el oficial debe marcar, con su nombre y justificación, si se trata
-- de un HOMÓNIMO (otra persona) o de un CHEQUEO VERIFICADO (comparó documentos
-- y datos de identificación y concluyó que no es la persona de la coincidencia).
-- Al hacerlo asume la responsabilidad de liberar ese expediente. La liberación
-- es solo para ese expediente y ese bloqueo: no levanta el bloqueo ni libera el
-- expediente donde se confirmó la coincidencia (ahí el bloqueo se levanta con
-- levantar_bloqueo y una resolución). No se modifica ni se borra.

create table aml.liberaciones_bloqueo (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null,
  bloqueo_id       uuid not null,
  expediente_id    uuid not null,
  tipo             text not null check (tipo in ('homonimo', 'verificado')),
  justificacion    text not null check (length(trim(justificacion)) >= 20),
  documento_id     uuid,
  liberado_por     uuid not null,
  rol              aml.rol_usuario not null,
  liberado_en      timestamptz not null default now(),
  foreign key (organizacion_id, bloqueo_id) references aml.bloqueos_preventivos(organizacion_id, id) on delete restrict,
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict,
  foreign key (organizacion_id, documento_id) references aml.documentos(organizacion_id, id) on delete restrict,
  unique (bloqueo_id, expediente_id)
);

create trigger liberaciones_inmutables before update or delete on aml.liberaciones_bloqueo
  for each row execute function aml.impedir_cambios();
create trigger liberaciones_sin_truncate before truncate on aml.liberaciones_bloqueo
  for each statement execute function aml.impedir_truncate();
create trigger liberaciones_bloqueo_bitacora after insert on aml.liberaciones_bloqueo
  for each row execute function aml.registrar_evento();

alter table aml.liberaciones_bloqueo enable row level security;
create policy liberaciones_ver on aml.liberaciones_bloqueo for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));
revoke all on aml.liberaciones_bloqueo from public, anon, authenticated;
grant select on aml.liberaciones_bloqueo to authenticated;
grant select on aml.liberaciones_bloqueo to service_role;

-- true si el bloqueo alcanza al expediente por el nombre de alguna de sus personas.
create or replace function aml.bloqueo_alcanza_por_nombre(p_bloqueo uuid, p_expediente uuid)
returns boolean
language sql
stable
security definer
set search_path = aml, public, pg_temp
as $$
  select exists (
    select 1 from aml.bloqueos_preventivos b
     where b.id = p_bloqueo
       and (b.nombre_normalizado in (select aml.normalizar_nombre(n.nombre) from aml.nombres_identificados(p_expediente) n)
            or b.nombre_normalizado in (select aml.normalizar_nombre(v.nombre_consultado)
                                          from aml.verificaciones v where v.expediente_id = p_expediente))
  )
$$;
revoke execute on function aml.bloqueo_alcanza_por_nombre(uuid, uuid) from public;

-- Misma función de la migración del art. 43, ahora respetando las liberaciones.
-- En el expediente de origen del bloqueo no hay liberación posible.
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
            or (aml.bloqueo_alcanza_por_nombre(b.id, e.id)
                and not exists (select 1 from aml.liberaciones_bloqueo l
                                 where l.bloqueo_id = b.id and l.expediente_id = e.id)))
  )
$$;

-- El oficial libera un expediente alcanzado por nombre.
create or replace function aml.liberar_expediente_bloqueo(
  p_bloqueo uuid,
  p_expediente uuid,
  p_tipo text,
  p_justificacion text,
  p_documento uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  b aml.bloqueos_preventivos;
  v_org uuid;
  v_rol aml.rol_usuario;
  v_id uuid;
begin
  select * into b from aml.bloqueos_preventivos x where x.id = p_bloqueo for update;
  select organizacion_id into v_org from aml.expedientes where id = p_expediente for update;
  if b.id is null or v_org is null or v_org <> b.organizacion_id or not aml.puede_decidir(b.organizacion_id) then
    raise exception 'Solo el oficial de cumplimiento libera un expediente de un bloqueo preventivo' using errcode = '42501';
  end if;
  v_rol := aml.rol_en(b.organizacion_id);
  if b.levantado_en is not null then
    raise exception 'El bloqueo ya fue levantado: el expediente no necesita liberarse' using errcode = 'P0001';
  end if;
  if b.expediente_id = p_expediente then
    raise exception 'En el expediente de la coincidencia confirmada el bloqueo no se libera: se levanta con la resolución que corresponda'
      using errcode = 'P0001';
  end if;
  if not aml.bloqueo_alcanza_por_nombre(p_bloqueo, p_expediente) then
    raise exception 'El bloqueo no alcanza a este expediente' using errcode = 'P0001';
  end if;
  if p_tipo not in ('homonimo', 'verificado') then
    raise exception 'Indique si es un homónimo o un chequeo verificado' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_justificacion, ''))) < 20 then
    raise exception 'Justifique la liberación con al menos 20 caracteres (datos comparados y conclusión)' using errcode = '23514';
  end if;
  if p_documento is not null and not exists (select 1 from aml.documentos d where d.id = p_documento and d.organizacion_id = v_org) then
    raise exception 'El documento indicado no pertenece a la organización' using errcode = '22023';
  end if;
  if exists (select 1 from aml.liberaciones_bloqueo l where l.bloqueo_id = p_bloqueo and l.expediente_id = p_expediente) then
    raise exception 'El expediente ya fue liberado de este bloqueo' using errcode = 'P0001';
  end if;

  insert into aml.liberaciones_bloqueo (organizacion_id, bloqueo_id, expediente_id, tipo, justificacion, documento_id, liberado_por, rol)
  values (v_org, p_bloqueo, p_expediente, p_tipo, trim(p_justificacion), p_documento, auth.uid(), v_rol)
  returning id into v_id;

  -- La alerta de bloqueo relacionado de este expediente queda resuelta con la liberación
  update aml.alertas a
     set estado = 'cerrada',
         cierre = case p_tipo when 'homonimo' then 'Homónimo' else 'Chequeo verificado' end
                  || ': el oficial liberó el expediente bajo su responsabilidad. ' || trim(p_justificacion),
         cerrada_en = now(),
         responsable = auth.uid()
   where a.expediente_id = p_expediente
     and a.senal = 'BLOQUEO_RELACIONADO'
     and a.evidencia->>'verificacionId' = b.verificacion_id::text
     and a.estado <> 'cerrada';
  return v_id;
end;
$$;
revoke execute on function aml.liberar_expediente_bloqueo(uuid, uuid, text, text, uuid) from public;
grant execute on function aml.liberar_expediente_bloqueo(uuid, uuid, text, text, uuid) to authenticated;

-- Bloqueos de OTROS expedientes que alcanzan a este por nombre, con su
-- liberación si la hay. Solo para cumplimiento.
create or replace function aml.bloqueos_relacionados(p_expediente uuid)
returns table (
  bloqueo_id uuid, expediente_origen uuid, nombre text, fuente aml.fuente_verificacion, detectada_en timestamptz,
  liberacion_tipo text, liberacion_justificacion text, liberado_en timestamptz
)
language plpgsql
stable
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organizacion_id into v_org from aml.expedientes where id = p_expediente;
  if v_org is null or not aml.es_cumplimiento(v_org) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  return query
    select b.id, b.expediente_id, b.nombre, b.fuente, b.detectada_en, l.tipo, l.justificacion, l.liberado_en
      from aml.bloqueos_preventivos b
      left join aml.liberaciones_bloqueo l on l.bloqueo_id = b.id and l.expediente_id = p_expediente
     where b.organizacion_id = v_org
       and b.levantado_en is null
       and b.expediente_id <> p_expediente
       and aml.bloqueo_alcanza_por_nombre(b.id, p_expediente)
     order by b.detectada_en desc;
end;
$$;
revoke execute on function aml.bloqueos_relacionados(uuid) from public;
grant execute on function aml.bloqueos_relacionados(uuid) to authenticated;

-- El texto de la alerta relacionada indica qué hacer
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
            || 'El bloqueo preventivo se extiende a este expediente por el nombre: no se aprueba ni se cierra su operación '
            || 'hasta que el oficial lo marque como homónimo o chequeo verificado.',
            jsonb_build_object('verificacionId', new.id, 'expedienteOrigen', new.expediente_id));
  end loop;
  return new;
end;
$$;
