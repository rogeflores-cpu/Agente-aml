-- Agente AML · Fase 1 · Soporte para flujos durables y WhatsApp

-- Vinculación del número de WhatsApp del cliente con su expediente:
-- el portal web muestra un código de 6 dígitos que el cliente envía por WhatsApp.
alter table aml.expedientes
  add column codigo_vinculacion_hash text,
  add column codigo_vinculacion_expira timestamptz;

-- Mensajes de WhatsApp recibidos y enviados (los procesa el agente).
create table aml.mensajes (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references aml.organizaciones(id) on delete restrict,
  expediente_id     uuid,
  direccion         text not null check (direccion in ('entrante', 'saliente')),
  wa_id             text not null,
  wa_message_id     text unique,
  tipo              text not null,              -- text, image, document, template...
  texto             text,
  media_id          text,
  plantilla         text,
  recibido_en       timestamptz not null default now(),
  procesado_en      timestamptz,
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict
);
create index on aml.mensajes (organizacion_id, wa_id, recibido_en desc);

-- Avisos internos para la consola (oficial, suplente, ejecutivos).
-- Los avisos de cumplimiento solo los ven los roles de cumplimiento.
create table aml.notificaciones (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references aml.organizaciones(id) on delete restrict,
  destinatario_rol  text not null check (destinatario_rol in ('cumplimiento', 'operativo')),
  expediente_id     uuid,
  prioridad         text not null default 'normal' check (prioridad in ('normal', 'alta', 'urgente')),
  asunto            text not null,
  cuerpo            text not null,
  creada_en         timestamptz not null default now(),
  leida_en          timestamptz,
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict
);
create index on aml.notificaciones (organizacion_id, destinatario_rol, leida_en);

-- Lista consolidada de la ONU: común a todas las organizaciones.
create table aml.lista_onu_versiones (
  sha256            char(64) primary key,
  generada_el       text,
  registros         integer not null,
  cargada_en        timestamptz not null default now()
);
create table aml.lista_onu_registros (
  referencia        text primary key,
  tipo              text not null check (tipo in ('individual', 'entidad')),
  datos             jsonb not null,
  version_sha256    char(64) not null references aml.lista_onu_versiones(sha256),
  actualizado_en    timestamptz not null default now()
);

alter table aml.mensajes enable row level security;
alter table aml.notificaciones enable row level security;
alter table aml.lista_onu_versiones enable row level security;
alter table aml.lista_onu_registros enable row level security;

create policy mensajes_ver on aml.mensajes for select to authenticated
  using (aml.es_cumplimiento(organizacion_id));
create policy notificaciones_ver on aml.notificaciones for select to authenticated
  using (case destinatario_rol
           when 'cumplimiento' then aml.es_cumplimiento(organizacion_id)
           else aml.es_miembro(organizacion_id) end);
create policy notificaciones_leer on aml.notificaciones for update to authenticated
  using (case destinatario_rol
           when 'cumplimiento' then aml.es_cumplimiento(organizacion_id)
           else aml.es_miembro(organizacion_id) end);
create policy lista_onu_ver on aml.lista_onu_versiones for select to authenticated using (true);

grant select on aml.mensajes, aml.notificaciones, aml.lista_onu_versiones to authenticated;
grant update (leida_en) on aml.notificaciones to authenticated;
grant all on aml.mensajes, aml.notificaciones, aml.lista_onu_versiones, aml.lista_onu_registros to service_role;

-- Token de WhatsApp del canal, leído desde Supabase Vault. Solo service_role.
create or replace function aml.token_canal(p_phone_number_id text)
returns text
language plpgsql
stable
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_secret uuid;
  v_token text;
begin
  select c.token_secret_id into v_secret
    from aml.canales_whatsapp c
   where c.phone_number_id = p_phone_number_id and c.estado = 'activo';
  if v_secret is null then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where id = $1' into v_token using v_secret;
  return v_token;
end;
$$;
revoke execute on function aml.token_canal(text) from public;
grant execute on function aml.token_canal(text) to service_role;

-- Vinculación por código: devuelve el expediente si el código es válido y lo consume.
create or replace function aml.vincular_whatsapp(p_phone_number_id text, p_wa_id text, p_codigo text)
returns uuid
language plpgsql
security definer
set search_path = aml, public, pg_temp
as $$
declare
  v_org uuid;
  v_exp uuid;
begin
  select organizacion_id into v_org from aml.canales_whatsapp where phone_number_id = p_phone_number_id;
  if v_org is null then
    return null;
  end if;
  update aml.expedientes e
     set whatsapp_wa_id = p_wa_id,
         whatsapp_vinculado_en = now(),
         codigo_vinculacion_hash = null,
         codigo_vinculacion_expira = null
   where e.organizacion_id = v_org
     and e.codigo_vinculacion_hash = encode(digest(p_codigo, 'sha256'), 'hex')
     and e.codigo_vinculacion_expira > now()
  returning e.id into v_exp;
  return v_exp;
end;
$$;
revoke execute on function aml.vincular_whatsapp(text, text, text) from public;
grant execute on function aml.vincular_whatsapp(text, text, text) to service_role;
