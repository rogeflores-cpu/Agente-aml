-- Agente AML · Portal web del cliente
--
-- La conversación del cliente puede ocurrir por WhatsApp o por el portal web.
-- En el canal web no hay número de WhatsApp, así que wa_id deja de ser
-- obligatorio y se registra el canal de cada mensaje.

alter table aml.mensajes alter column wa_id drop not null;

alter table aml.mensajes
  add column canal text not null default 'whatsapp' check (canal in ('whatsapp', 'web'));

alter table aml.mensajes
  add constraint whatsapp_requiere_wa_id check (canal <> 'whatsapp' or wa_id is not null);

-- Un mensaje del portal siempre pertenece a un expediente.
alter table aml.mensajes
  add constraint web_requiere_expediente check (canal <> 'web' or expediente_id is not null);

-- Historial de conversación por expediente (lo usa el agente en cada turno).
create index mensajes_expediente_recibido on aml.mensajes (expediente_id, recibido_en desc);

-- Busca el expediente por el hash del token del enlace. Solo para el servidor.
-- Devuelve únicamente lo que el portal necesita para identificar el expediente
-- y mostrar la marca; nada de cumplimiento (art. 38).
create or replace function aml.expediente_por_enlace(p_token_hash text)
returns table (
  expediente_id uuid,
  organizacion_id uuid,
  vigente boolean,
  estado aml.estado_expediente,
  marca jsonb,
  nombre_comercial text
)
language sql
stable
security definer
set search_path = aml, public, pg_temp
as $$
  select e.id, e.organizacion_id, coalesce(e.enlace_expira_en > now(), false), e.estado,
         o.marca, o.nombre_comercial
    from aml.expedientes e
    join aml.organizaciones o on o.id = e.organizacion_id
   where e.enlace_token_hash = p_token_hash
$$;

revoke execute on function aml.expediente_por_enlace(text) from public;
grant execute on function aml.expediente_por_enlace(text) to service_role;
