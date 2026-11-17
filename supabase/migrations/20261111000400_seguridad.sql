-- Agente AML · Fase 1 · Seguridad por organización y por rol (RLS)
--
-- Principio (art. 38, prohibición de revelación): solo los roles de
-- cumplimiento (oficial, oficial_suplente, auditor) ven el estado real del
-- expediente, el nivel de riesgo, las verificaciones, las alertas, las
-- decisiones y la bitácora. Los roles operativos (administrador, ejecutivo)
-- trabajan con vistas que enmascaran esa información.
-- El cliente nunca entra por aquí: el portal y WhatsApp usan funciones del
-- servidor con la llave de servicio y validan el token del enlace.

-- ---------------------------------------------------------------------------
-- Funciones auxiliares
-- ---------------------------------------------------------------------------
create or replace function aml.rol_en(p_org uuid)
returns aml.rol_usuario
language sql stable security definer
set search_path = aml, public, pg_temp
as $$
  select m.rol from aml.miembros m
   where m.organizacion_id = p_org and m.usuario_id = auth.uid() and m.activo
$$;

create or replace function aml.es_miembro(p_org uuid)
returns boolean language sql stable security definer
set search_path = aml, public, pg_temp
as $$ select aml.rol_en(p_org) is not null $$;

create or replace function aml.es_cumplimiento(p_org uuid)
returns boolean language sql stable security definer
set search_path = aml, public, pg_temp
as $$ select coalesce(aml.rol_en(p_org) in ('oficial', 'oficial_suplente', 'auditor'), false) $$;

create or replace function aml.puede_decidir(p_org uuid)
returns boolean language sql stable security definer
set search_path = aml, public, pg_temp
as $$ select coalesce(aml.rol_en(p_org) in ('oficial', 'oficial_suplente'), false) $$;

create or replace function aml.es_administrador(p_org uuid)
returns boolean language sql stable security definer
set search_path = aml, public, pg_temp
as $$ select coalesce(aml.rol_en(p_org) = 'administrador', false) $$;

-- ---------------------------------------------------------------------------
-- Activar RLS en todas las tablas
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'aml' loop
    execute format('alter table aml.%I enable row level security', t);
  end loop;
end;
$$;

-- Organización, miembros, canal y configuración
create policy org_ver on aml.organizaciones for select to authenticated
  using (aml.es_miembro(id));
create policy org_editar on aml.organizaciones for update to authenticated
  using (aml.es_administrador(id)) with check (aml.es_administrador(id));

create policy miembros_ver on aml.miembros for select to authenticated
  using (aml.es_miembro(organizacion_id));
create policy miembros_admin on aml.miembros for all to authenticated
  using (aml.es_administrador(organizacion_id)) with check (aml.es_administrador(organizacion_id));

create policy canal_ver on aml.canales_whatsapp for select to authenticated
  using (aml.es_administrador(organizacion_id));

create policy config_ver on aml.configuraciones_riesgo for select to authenticated
  using (aml.es_cumplimiento(organizacion_id) or aml.es_administrador(organizacion_id));
create policy config_crear on aml.configuraciones_riesgo for insert to authenticated
  with check (aml.puede_decidir(organizacion_id));

-- Datos del expediente que no revelan verificaciones: todos los miembros leen
create policy operaciones_ver on aml.operaciones for select to authenticated
  using (aml.es_miembro(organizacion_id));
create policy personas_ver on aml.personas_relacionadas for select to authenticated
  using (aml.es_miembro(organizacion_id));
create policy documentos_ver on aml.documentos for select to authenticated
  using (aml.es_miembro(organizacion_id));
create policy datos_ver on aml.datos_expediente for select to authenticated
  using (aml.es_miembro(organizacion_id));
create policy pendientes_ver on aml.pendientes for select to authenticated
  using (aml.es_miembro(organizacion_id));

-- Cumplimiento gestiona pendientes, datos y documentos
create policy pendientes_gestionar on aml.pendientes for update to authenticated
  using (aml.puede_decidir(organizacion_id)) with check (aml.puede_decidir(organizacion_id));
create policy datos_gestionar on aml.datos_expediente for all to authenticated
  using (aml.puede_decidir(organizacion_id)) with check (aml.puede_decidir(organizacion_id));
create policy documentos_gestionar on aml.documentos for update to authenticated
  using (aml.puede_decidir(organizacion_id)) with check (aml.puede_decidir(organizacion_id));

-- Expedientes y clientes completos: solo cumplimiento
create policy expedientes_ver on aml.expedientes for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));
create policy expedientes_gestionar on aml.expedientes for update to authenticated
  using (aml.puede_decidir(organizacion_id)) with check (aml.puede_decidir(organizacion_id));
create policy clientes_ver on aml.clientes for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));
create policy clientes_gestionar on aml.clientes for update to authenticated
  using (aml.puede_decidir(organizacion_id)) with check (aml.puede_decidir(organizacion_id));

-- Zona reservada
create policy verificaciones_ver on aml.verificaciones for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));
create policy verificaciones_disponer on aml.verificaciones for update to authenticated
  using (aml.puede_decidir(organizacion_id))
  with check (aml.puede_decidir(organizacion_id) and dispuesto_por = auth.uid());

create policy alertas_ver on aml.alertas for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));
create policy alertas_gestionar on aml.alertas for update to authenticated
  using (aml.puede_decidir(organizacion_id)) with check (aml.puede_decidir(organizacion_id));

create policy evaluaciones_ver on aml.evaluaciones_riesgo for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));
create policy evaluaciones_ajustar on aml.evaluaciones_riesgo for update to authenticated
  using (aml.puede_decidir(organizacion_id))
  with check (aml.puede_decidir(organizacion_id) and ajustado_por = auth.uid());

create policy decisiones_ver on aml.decisiones for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));
create policy decisiones_crear on aml.decisiones for insert to authenticated
  with check (aml.puede_decidir(organizacion_id) and decidido_por = auth.uid());

create policy bitacora_ver on aml.bitacora for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));

create policy efectivo_ver on aml.pagos_efectivo for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));
create policy efectivo_registrar on aml.pagos_efectivo for insert to authenticated
  with check (aml.es_miembro(organizacion_id) and aml.rol_en(organizacion_id) <> 'auditor'
              and registrado_por = auth.uid());

-- ---------------------------------------------------------------------------
-- Vistas para roles operativos: estado enmascarado y sin nivel de riesgo.
-- Se ejecutan con los permisos del dueño y filtran por membresía.
-- ---------------------------------------------------------------------------
create view aml.expedientes_comercial as
select e.id, e.organizacion_id, e.operacion_id, e.cliente_id, e.parte,
       case
         when e.estado in ('invitado', 'en_captura')  then e.estado::text
         when e.estado in ('aprobado', 'aprobado_condicionado') then 'aprobado'
         when e.estado in ('rechazado', 'abstenido') then 'no_aprobado'
         else 'en_revision'   -- incluye en_examen: no se revela (art. 38)
       end as estado,
       e.contacto_nombre, e.contacto_telefono, e.contacto_correo,
       e.whatsapp_vinculado_en is not null as whatsapp_vinculado,
       e.creado_en, e.actualizado_en
  from aml.expedientes e
 where aml.es_miembro(e.organizacion_id);

create view aml.clientes_comercial as
select c.id, c.organizacion_id, c.tipo_persona, c.nombre,
       c.identificacion_tipo, c.identificacion_num, c.nacionalidad, c.creado_en
  from aml.clientes c
 where aml.es_miembro(c.organizacion_id);

-- ---------------------------------------------------------------------------
-- Alta de operación desde la consola (administrador, ejecutivo u oficial).
-- Crea la operación y un expediente por cada parte. Los enlaces y mensajes
-- los genera el flujo 'expediente/creado'.
-- p_partes: [{"parte":"comprador","contacto_nombre":"...","contacto_telefono":"+502...","contacto_correo":"..."}]
-- ---------------------------------------------------------------------------
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
    insert into aml.expedientes (organizacion_id, operacion_id, parte, contacto_nombre,
                                 contacto_telefono, contacto_correo)
    values (p_organizacion, op.id, (p->>'parte')::aml.parte_operacion, p->>'contacto_nombre',
            p->>'contacto_telefono', p->>'contacto_correo')
    returning op.id, op.codigo, aml.expedientes.id, aml.expedientes.parte
      into operacion_id, codigo, expediente_id, parte;
    return next;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de API (Supabase expone el esquema 'aml' si se agrega en la config)
-- ---------------------------------------------------------------------------
grant usage on schema aml to authenticated, service_role;
grant select on all tables in schema aml to authenticated;
grant insert, update on aml.organizaciones, aml.miembros, aml.configuraciones_riesgo,
  aml.pendientes, aml.datos_expediente, aml.documentos, aml.expedientes, aml.clientes,
  aml.verificaciones, aml.alertas, aml.evaluaciones_riesgo, aml.decisiones, aml.pagos_efectivo
  to authenticated;
grant delete on aml.miembros to authenticated;
revoke all on aml.contadores from authenticated;
grant all on all tables in schema aml to service_role;
grant usage on all sequences in schema aml to service_role;
grant execute on function aml.crear_operacion(uuid, aml.tipo_operacion, jsonb, numeric, char, jsonb, jsonb) to authenticated;
revoke execute on function aml.verificar_bitacora(uuid) from public;
grant execute on function aml.verificar_bitacora(uuid) to service_role;
