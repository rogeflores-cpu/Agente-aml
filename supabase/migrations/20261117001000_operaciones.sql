-- Agente AML · Vista operativa para la inmobiliaria (administrador y ejecutivo)
--
-- Art. 38: esta vista no expone verificaciones, alertas, riesgo, decisiones ni
-- el estado real del expediente. 'en_examen' y 'listo_para_decision' se
-- muestran igual que 'en_revision'. Se ejecuta con los permisos del dueño y
-- filtra por membresía, como aml.expedientes_comercial.

create view aml.operaciones_comercial as
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
       case
         when e.estado in ('invitado', 'en_captura') then e.estado::text
         when e.estado in ('aprobado', 'aprobado_condicionado') then 'aprobado'
         when e.estado in ('rechazado', 'abstenido') then 'no_aprobado'
         else 'en_revision'
       end                          as estado,
       (select count(*) from aml.pendientes p
         where p.expediente_id = e.id and p.estado = 'abierto') as pendientes,
       e.whatsapp_vinculado_en is not null as whatsapp_vinculado,
       e.actualizado_en
  from aml.operaciones o
  join aml.expedientes e on e.operacion_id = o.id and e.organizacion_id = o.organizacion_id
 where aml.es_miembro(o.organizacion_id);

grant select on aml.operaciones_comercial to authenticated;

-- Pagos en efectivo (art. 31): el ejecutivo los registra al recibirlos, aunque
-- el registro de cliente todavía no exista (se crea al evaluar o aprobar).
-- Se vinculan al expediente y, cuando se conoce, al cliente.
alter table aml.pagos_efectivo
  add column expediente_id uuid,
  alter column cliente_id drop not null,
  add constraint pagos_efectivo_expediente_fk
    foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict,
  add constraint pagos_efectivo_sujeto check (cliente_id is not null or expediente_id is not null);

create index on aml.pagos_efectivo (organizacion_id, expediente_id, fecha);

-- La vista agrega por cliente; mientras no hay cliente, por expediente.
create or replace view aml.registro_efectivo_diario with (security_invoker = true) as
select organizacion_id, cliente_id, fecha,
       count(*)        as pagos,
       sum(monto_usd)  as total_usd,
       sum(monto_usd) >= 10000 as sujeto_a_registro,   -- única o estructurada
       case when cliente_id is null then expediente_id end as expediente_id
from aml.pagos_efectivo
group by organizacion_id, cliente_id, fecha, case when cliente_id is null then expediente_id end;
