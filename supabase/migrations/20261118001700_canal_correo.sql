-- Agente AML · Canal de correo electrónico
--
-- Mientras no haya WhatsApp (o si el cliente no dio teléfono), el enlace del
-- portal y sus recordatorios se envían por correo. Se registran en
-- aml.mensajes como cualquier mensaje saliente, con canal 'correo', la
-- plantilla usada y el id del proveedor. El texto no se guarda: es fijo y
-- lleva el enlace con el token, que nunca se conserva.

alter table aml.mensajes drop constraint if exists mensajes_canal_check;
alter table aml.mensajes add constraint mensajes_canal_check check (canal in ('whatsapp', 'web', 'correo'));
alter table aml.mensajes add column correo_id text unique;
alter table aml.mensajes
  add constraint correo_saliente_con_expediente check (canal <> 'correo' or (direccion = 'saliente' and expediente_id is not null));
