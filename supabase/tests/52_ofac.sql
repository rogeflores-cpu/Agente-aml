-- Pruebas de la lista SDN de la OFAC (migración 20261119001800).
-- Criterio: alerta al oficial y riesgo alto; sin bloqueo del art. 43 ni plazo de 24 horas.

begin;

-- Datos base: oficial f7, ejecutivo e7 (org C7)
insert into aml.organizaciones (id, nombre_legal, nombre_comercial, nit, subdominio)
values ('00000000-0000-0000-0000-000000000c07', 'Inmuebles OFAC, S.A.', 'OFAC Prueba', '1234567-9', 'ofac-prueba');
insert into aml.miembros (organizacion_id, usuario_id, rol) values
  ('00000000-0000-0000-0000-000000000c07', 'f7000000-0000-0000-0000-000000000000', 'oficial'),
  ('00000000-0000-0000-0000-000000000c07', 'e7000000-0000-0000-0000-000000000000', 'ejecutivo');
insert into aml.configuraciones_riesgo (id, organizacion_id, version, parametros, aprobada_por, aprobada_en)
values ('00000000-0000-0000-0000-00000000cf07', '00000000-0000-0000-0000-000000000c07', 1,
        '{"pesosFactores":{"cliente":0.4,"geografia":0.2,"canal":0.15,"producto":0.25},"umbrales":{"medio":30,"alto":55},"actualizacionMeses":{"bajo":36,"medio":24,"alto":12},"umbralEfectivoUsd":10000}',
        'Consejo de Administración · acta 3-2026', current_date);
insert into aml.operaciones (id, organizacion_id, tipo) values
  ('00000000-0000-0000-0000-0000000007a1', '00000000-0000-0000-0000-000000000c07', 'compraventa');
insert into aml.expedientes (id, organizacion_id, operacion_id, parte, contacto_nombre, contacto_correo) values
  ('00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-000000000c07', '00000000-0000-0000-0000-0000000007a1', 'comprador', 'Cliente', 'c@example.com');
select aml.guardar_dato('00000000-0000-0000-0000-0000000007e1', 'cliente.nombre_completo', '"Ana Beatriz Solís"', 'cliente', null, null, null, 'cliente');
update aml.expedientes set estado = 'listo_para_decision' where id = '00000000-0000-0000-0000-0000000007e1';
insert into aml.evaluaciones_riesgo (organizacion_id, expediente_id, configuracion_id, entrada, puntajes, puntaje_total, nivel_calculado, medidas)
values ('00000000-0000-0000-0000-000000000c07', '00000000-0000-0000-0000-0000000007e1', '00000000-0000-0000-0000-00000000cf07', '{}', '{}', 70, 'alto', 'intensificada');

-- La ONU sin coincidencia; OFAC con posible coincidencia
insert into aml.verificaciones (organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado) values
  ('00000000-0000-0000-0000-000000000c07', '00000000-0000-0000-0000-0000000007e1', 'Ana Beatriz Solís', 'onu', 'v1', 'sin_coincidencia');
insert into aml.verificaciones (id, organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado, coincidencias)
values ('00000000-0000-0000-0000-0000000007b1', '00000000-0000-0000-0000-000000000c07', '00000000-0000-0000-0000-0000000007e1',
        'Ana Beatriz Solís', 'ofac', 'sha-ofac', 'posible_coincidencia', '[{"referencia":"OFAC-1001"}]');

-- =============================================================================
-- 1. La posible coincidencia abre OFAC_POSIBLE, sin vencimiento ni alerta del art. 43
-- =============================================================================
do $$ begin
  if not exists (select 1 from aml.alertas where expediente_id = '00000000-0000-0000-0000-0000000007e1'
                   and senal = 'OFAC_POSIBLE' and estado = 'abierta' and vence_en is null) then
    raise exception 'FALLO: no se abrió la alerta OFAC_POSIBLE sin vencimiento';
  end if;
  if exists (select 1 from aml.alertas where expediente_id = '00000000-0000-0000-0000-0000000007e1' and senal like 'ONU_%') then
    raise exception 'FALLO: una coincidencia con OFAC abrió una alerta del art. 43';
  end if;
end $$;

-- =============================================================================
-- 2. Sin disponer, el oficial no puede aprobar
-- =============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'f7000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    values ('00000000-0000-0000-0000-000000000c07', '00000000-0000-0000-0000-0000000007e1', 'aprobar',
            'Intento de aprobar con OFAC sin disponer', auth.uid());
    raise exception 'FALLO: se aprobó con una posible coincidencia con OFAC sin disponer';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;

-- =============================================================================
-- 3. Confirmada: alerta OFAC_CONFIRMADA, sin bloqueo preventivo; luego sí se aprueba
-- =============================================================================
select * from aml.disponer_verificacion('00000000-0000-0000-0000-0000000007b1', 'coincidencia_confirmada',
  'Coinciden nombre, fecha de nacimiento y pasaporte con OFAC-1001');
reset role;
do $$ begin
  if exists (select 1 from aml.bloqueos_preventivos where verificacion_id = '00000000-0000-0000-0000-0000000007b1') then
    raise exception 'FALLO: una coincidencia con OFAC creó un bloqueo preventivo';
  end if;
  perform set_config('role', 'postgres', true);
  if aml.expediente_bloqueado('00000000-0000-0000-0000-0000000007e1') then
    raise exception 'FALLO: el expediente quedó bloqueado por OFAC';
  end if;
  if not exists (select 1 from aml.alertas where expediente_id = '00000000-0000-0000-0000-0000000007e1'
                   and senal = 'OFAC_POSIBLE' and estado = 'cerrada') then
    raise exception 'FALLO: la alerta OFAC_POSIBLE no se cerró al disponer';
  end if;
  if not exists (select 1 from aml.alertas where expediente_id = '00000000-0000-0000-0000-0000000007e1'
                   and senal = 'OFAC_CONFIRMADA' and estado = 'abierta' and vence_en is null) then
    raise exception 'FALLO: no se abrió la alerta OFAC_CONFIRMADA';
  end if;
  if exists (select 1 from aml.alertas where expediente_id = '00000000-0000-0000-0000-0000000007e1' and senal like 'ONU_%') then
    raise exception 'FALLO: la confirmación con OFAC abrió una alerta del art. 43';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = 'f7000000-0000-0000-0000-000000000000';
insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
values ('00000000-0000-0000-0000-000000000c07', '00000000-0000-0000-0000-0000000007e1', 'aprobar',
        'Coincidencia OFAC confirmada; debida diligencia intensificada documentada', auth.uid());
reset role;

-- =============================================================================
-- 4. La ONU sigue bloqueando como antes (regresión)
-- =============================================================================
insert into aml.operaciones (id, organizacion_id, tipo) values
  ('00000000-0000-0000-0000-0000000007a2', '00000000-0000-0000-0000-000000000c07', 'compraventa');
insert into aml.expedientes (id, organizacion_id, operacion_id, parte, contacto_nombre, contacto_correo) values
  ('00000000-0000-0000-0000-0000000007e2', '00000000-0000-0000-0000-000000000c07', '00000000-0000-0000-0000-0000000007a2', 'vendedor', 'Otro', 'o@example.com');
insert into aml.verificaciones (id, organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado, coincidencias)
values ('00000000-0000-0000-0000-0000000007b2', '00000000-0000-0000-0000-000000000c07', '00000000-0000-0000-0000-0000000007e2',
        'Pedro Ruiz Gómez', 'onu', 'v1', 'posible_coincidencia', '[{"referencia":"QDi.888"}]');
set local role authenticated;
set local request.jwt.claim.sub = 'f7000000-0000-0000-0000-000000000000';
select * from aml.disponer_verificacion('00000000-0000-0000-0000-0000000007b2', 'coincidencia_confirmada',
  'Coinciden nombre, fecha de nacimiento y documento con QDi.888');
reset role;
do $$ begin
  if not exists (select 1 from aml.bloqueos_preventivos where verificacion_id = '00000000-0000-0000-0000-0000000007b2') then
    raise exception 'FALLO: la confirmación con la ONU dejó de crear el bloqueo preventivo';
  end if;
  if not exists (select 1 from aml.alertas where expediente_id = '00000000-0000-0000-0000-0000000007e2'
                   and senal = 'ONU_CONFIRMADA' and vence_en is not null) then
    raise exception 'FALLO: la confirmación con la ONU dejó de abrir la alerta con plazo';
  end if;
end $$;

select 'OK: 4 grupos de pruebas de la lista OFAC superados' as resultado;
rollback;
