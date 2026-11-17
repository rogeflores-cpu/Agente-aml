-- Agente AML · Vista de bandeja para la consola de cumplimiento.
-- security_invoker: aplica la RLS de quien consulta (solo roles de cumplimiento).
create view aml.bandeja_cumplimiento with (security_invoker = true) as
select e.id,
       e.organizacion_id,
       o.codigo as codigo_operacion,
       e.parte,
       e.tipo_persona,
       coalesce(c.nombre, e.contacto_nombre) as nombre,
       e.estado,
       (select coalesce(ev.nivel_ajustado, ev.nivel_calculado)
          from aml.evaluaciones_riesgo ev
         where ev.expediente_id = e.id
         order by ev.calculado_en desc limit 1) as nivel,
       (select count(*) from aml.pendientes p where p.expediente_id = e.id and p.estado = 'abierto') as pendientes,
       (select count(*) from aml.verificaciones v where v.expediente_id = e.id and v.resultado = 'posible_coincidencia') as coincidencias_sin_disponer,
       (select count(*) from aml.alertas a where a.expediente_id = e.id and a.estado <> 'cerrada') as alertas_abiertas,
       e.actualizado_en
  from aml.expedientes e
  join aml.operaciones o on o.id = e.operacion_id
  left join aml.clientes c on c.id = e.cliente_id;

grant select on aml.bandeja_cumplimiento to authenticated;

-- Organizaciones del usuario con su rol (para el selector de la consola).
create view aml.mis_organizaciones as
select o.id, o.nombre_comercial as nombre, m.rol
  from aml.miembros m
  join aml.organizaciones o on o.id = m.organizacion_id
 where m.usuario_id = auth.uid() and m.activo;

grant select on aml.mis_organizaciones to authenticated;
