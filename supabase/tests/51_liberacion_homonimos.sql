-- Pruebas de la liberación por homónimo o chequeo verificado (migración 20261118001600).
-- Ejecutar sobre una base con todas las migraciones.

begin;

-- Datos base: oficial f6, ejecutivo e6 (org C6)
insert into aml.organizaciones (id, nombre_legal, nombre_comercial, nit, subdominio)
values ('00000000-0000-0000-0000-000000000c06', 'Inmuebles Homónimos, S.A.', 'Homónimos', '1111111-1', 'homonimos');
insert into aml.miembros (organizacion_id, usuario_id, rol) values
  ('00000000-0000-0000-0000-000000000c06', 'f6000000-0000-0000-0000-000000000000', 'oficial'),
  ('00000000-0000-0000-0000-000000000c06', 'e6000000-0000-0000-0000-000000000000', 'ejecutivo');
insert into aml.configuraciones_riesgo (id, organizacion_id, version, parametros, aprobada_por, aprobada_en)
values ('00000000-0000-0000-0000-00000000cf06', '00000000-0000-0000-0000-000000000c06', 1,
        '{"pesosFactores":{"cliente":0.4,"geografia":0.2,"canal":0.15,"producto":0.25},"umbrales":{"medio":30,"alto":55},"actualizacionMeses":{"bajo":36,"medio":24,"alto":12},"umbralEfectivoUsd":10000}',
        'Consejo de Administración · acta 3-2026', current_date);
insert into aml.operaciones (id, organizacion_id, tipo) values
  ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-000000000c06', 'compraventa'),
  ('00000000-0000-0000-0000-0000000006a2', '00000000-0000-0000-0000-000000000c06', 'compraventa'),
  ('00000000-0000-0000-0000-0000000006a3', '00000000-0000-0000-0000-000000000c06', 'compraventa');

-- O: origen de la coincidencia; H y V: el mismo nombre en otras operaciones
insert into aml.expedientes (id, organizacion_id, operacion_id, parte, contacto_nombre, contacto_correo) values
  ('00000000-0000-0000-0000-0000000006e1', '00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-0000000006a1', 'vendedor', 'Origen', 'o@example.com'),
  ('00000000-0000-0000-0000-0000000006e2', '00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-0000000006a2', 'comprador', 'Homónimo', 'h@example.com'),
  ('00000000-0000-0000-0000-0000000006e3', '00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-0000000006a3', 'comprador', 'Verificado', 'v@example.com');
select aml.guardar_dato(x, 'cliente.nombre_completo', '"Mario López García"', 'cliente', null, null, null, 'cliente')
  from unnest(array['00000000-0000-0000-0000-0000000006e1', '00000000-0000-0000-0000-0000000006e2',
                    '00000000-0000-0000-0000-0000000006e3']::uuid[]) x;
insert into aml.verificaciones (id, organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado, coincidencias)
values ('00000000-0000-0000-0000-0000000006b1', '00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-0000000006e1',
        'Mario López García', 'onu', 'v1', 'posible_coincidencia', '[{"referencia":"QDi.777"}]');
insert into aml.verificaciones (organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado) values
  ('00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-0000000006e2', 'Mario López García', 'onu', 'v1', 'sin_coincidencia'),
  ('00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-0000000006e3', 'Mario López García', 'onu', 'v1', 'sin_coincidencia');
update aml.expedientes set estado = 'listo_para_decision'
 where id in ('00000000-0000-0000-0000-0000000006e2', '00000000-0000-0000-0000-0000000006e3');
insert into aml.evaluaciones_riesgo (organizacion_id, expediente_id, configuracion_id, entrada, puntajes, puntaje_total, nivel_calculado, medidas)
select '00000000-0000-0000-0000-000000000c06', x, '00000000-0000-0000-0000-00000000cf06', '{}', '{}', 20, 'bajo', 'estandar'
  from unnest(array['00000000-0000-0000-0000-0000000006e2', '00000000-0000-0000-0000-0000000006e3']::uuid[]) x;

-- El oficial confirma la coincidencia en O: el bloqueo alcanza a H y V por el nombre
set local role authenticated;
set local request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000000';
select * from aml.disponer_verificacion('00000000-0000-0000-0000-0000000006b1', 'coincidencia_confirmada',
  'Coinciden nombre, fecha de nacimiento y documento con QDi.777');
reset role;
do $$ begin
  if not aml.expediente_bloqueado('00000000-0000-0000-0000-0000000006e2')
     or not aml.expediente_bloqueado('00000000-0000-0000-0000-0000000006e3') then
    raise exception 'FALLO: el bloqueo no alcanzó a los expedientes con el mismo nombre';
  end if;
end $$;

-- =============================================================================
-- 1. Quién y cómo puede liberar
-- =============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'e6000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    perform aml.liberar_expediente_bloqueo((select id from aml.bloqueos_preventivos limit 1),
      '00000000-0000-0000-0000-0000000006e2', 'homonimo', 'El ejecutivo intenta liberar el expediente');
    raise exception 'FALLO: el ejecutivo liberó un expediente';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    perform * from aml.bloqueos_relacionados('00000000-0000-0000-0000-0000000006e2');
    raise exception 'FALLO: el ejecutivo consultó los bloqueos relacionados';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;

set local request.jwt.claim.sub = 'f6000000-0000-0000-0000-000000000000';
do $$
declare b uuid := (select id from aml.bloqueos_preventivos where verificacion_id = '00000000-0000-0000-0000-0000000006b1');
begin
  begin
    perform aml.liberar_expediente_bloqueo(b, '00000000-0000-0000-0000-0000000006e1', 'homonimo', 'Intento de liberar el expediente de origen');
    raise exception 'FALLO: se liberó el expediente de la coincidencia confirmada';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    perform aml.liberar_expediente_bloqueo(b, '00000000-0000-0000-0000-0000000006e2', 'homonimo', 'Corto');
    raise exception 'FALLO: se liberó sin justificación suficiente';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    perform aml.liberar_expediente_bloqueo(b, '00000000-0000-0000-0000-0000000006e2', 'otro', 'Tipo de liberación que no existe en el catálogo');
    raise exception 'FALLO: se aceptó un tipo de liberación inválido';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;

  -- H: homónimo
  perform aml.liberar_expediente_bloqueo(b, '00000000-0000-0000-0000-0000000006e2', 'homonimo',
    'DPI 2987 65432 0101 y fecha de nacimiento 1990-05-02 distintos del listado (1961)');
  -- expediente_bloqueado es solo del servidor (art. 38): se comprueba como dueño
  perform set_config('role', 'postgres', true);
  if aml.expediente_bloqueado('00000000-0000-0000-0000-0000000006e2') then raise exception 'FALLO: H sigue bloqueado tras liberarlo'; end if;
  if not aml.expediente_bloqueado('00000000-0000-0000-0000-0000000006e3') then raise exception 'FALLO: liberar H liberó también a V'; end if;
  if not aml.expediente_bloqueado('00000000-0000-0000-0000-0000000006e1') then raise exception 'FALLO: liberar H liberó el origen'; end if;
  if exists (select 1 from aml.alertas where expediente_id = '00000000-0000-0000-0000-0000000006e2'
               and senal = 'BLOQUEO_RELACIONADO' and estado <> 'cerrada') then
    raise exception 'FALLO: la alerta relacionada de H sigue abierta';
  end if;
  perform set_config('role', 'authenticated', true);
  if (select liberacion_tipo from aml.bloqueos_relacionados('00000000-0000-0000-0000-0000000006e2')) is distinct from 'homonimo' then
    raise exception 'FALLO: bloqueos_relacionados no muestra la liberación';
  end if;
  begin
    perform aml.liberar_expediente_bloqueo(b, '00000000-0000-0000-0000-0000000006e2', 'verificado', 'Segunda liberación del mismo expediente');
    raise exception 'FALLO: se liberó dos veces';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;

-- H se aprueba; V todavía no
insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
values ('00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-0000000006e2', 'aprobar',
        'Homónimo documentado; cotejos sin coincidencia propia', auth.uid());
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    values ('00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-0000000006e3', 'aprobar',
            'Intento de aprobar V sin liberarlo', auth.uid());
    raise exception 'FALLO: se aprobó V sin liberarlo';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;

-- V: chequeo verificado; luego se aprueba y el ejecutivo puede cerrar su operación
select aml.liberar_expediente_bloqueo((select id from aml.bloqueos_preventivos where verificacion_id = '00000000-0000-0000-0000-0000000006b1'),
  '00000000-0000-0000-0000-0000000006e3', 'verificado',
  'Pasaporte y nacionalidad comparados con el listado: no corresponde a la persona designada');
insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
values ('00000000-0000-0000-0000-000000000c06', '00000000-0000-0000-0000-0000000006e3', 'aprobar',
        'Chequeo verificado por el oficial; cotejos sin coincidencia propia', auth.uid());
set local request.jwt.claim.sub = 'e6000000-0000-0000-0000-000000000000';
select aml.cerrar_operacion('00000000-0000-0000-0000-0000000006a3', 'cerrada');
reset role;

do $$ begin
  if (select string_agg(estado::text, ',' order by id) from aml.expedientes
       where id in ('00000000-0000-0000-0000-0000000006e2', '00000000-0000-0000-0000-0000000006e3')) <> 'aprobado,aprobado' then
    raise exception 'FALLO: H y V debieron aprobarse tras liberarlos';
  end if;
  if (select count(*) from aml.liberaciones_bloqueo where liberado_por = 'f6000000-0000-0000-0000-000000000000' and rol = 'oficial') <> 2 then
    raise exception 'FALLO: las liberaciones no registran al oficial responsable';
  end if;
  if not exists (select 1 from aml.bitacora where entidad = 'liberaciones_bloqueo' and evento = 'insert') then
    raise exception 'FALLO: la liberación no quedó en la bitácora';
  end if;
  begin
    update aml.liberaciones_bloqueo set justificacion = 'Justificación reescrita después del hecho';
    raise exception 'FALLO: se modificó una liberación';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    delete from aml.liberaciones_bloqueo;
    raise exception 'FALLO: se borró una liberación';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;

select 'OK: 3 grupos de pruebas de liberación por homónimo o chequeo verificado superados' as resultado;
rollback;
