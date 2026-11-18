-- Pruebas del art. 43 (migración 20261118001500): cotejo exigido de cada
-- persona identificada (incluido cada beneficiario final), designaciones de la
-- S/RES/1373 y bloqueo preventivo. Ejecutar sobre una base con todas las migraciones.

begin;

-- Datos base ------------------------------------------------------------------
-- Usuarios: oficial f5, ejecutivo e5 (org C5)
insert into aml.organizaciones (id, nombre_legal, nombre_comercial, nit, subdominio)
values ('00000000-0000-0000-0000-000000000c05', 'Inmuebles Art 43, S.A.', 'Art 43', '7654321-0', 'art43');

insert into aml.miembros (organizacion_id, usuario_id, rol) values
  ('00000000-0000-0000-0000-000000000c05', 'f5000000-0000-0000-0000-000000000000', 'oficial'),
  ('00000000-0000-0000-0000-000000000c05', 'e5000000-0000-0000-0000-000000000000', 'ejecutivo');

insert into aml.configuraciones_riesgo (id, organizacion_id, version, parametros, aprobada_por, aprobada_en)
values ('00000000-0000-0000-0000-00000000cf05', '00000000-0000-0000-0000-000000000c05', 1,
        '{"pesosFactores":{"cliente":0.4,"geografia":0.2,"canal":0.15,"producto":0.25},"umbrales":{"medio":30,"alto":55},"actualizacionMeses":{"bajo":36,"medio":24,"alto":12},"umbralEfectivoUsd":10000}',
        'Consejo de Administración · acta 2-2026', current_date);

insert into aml.operaciones (id, organizacion_id, tipo) values
  ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-000000000c05', 'compraventa'),
  ('00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-000000000c05', 'compraventa'),
  ('00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-000000000c05', 'compraventa');

-- J: persona jurídica con dos beneficiarios finales (uno como cadena libre)
-- P1: vendedor con posible coincidencia; P2: la misma persona en otra operación
insert into aml.expedientes (id, organizacion_id, operacion_id, parte, tipo_persona, contacto_nombre, contacto_correo) values
  ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005a1', 'comprador', 'juridica', 'Inversiones Prueba', 'j@example.com'),
  ('00000000-0000-0000-0000-0000000005e2', '00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005a2', 'vendedor', 'individual', 'Carlos Díaz', 'p1@example.com'),
  ('00000000-0000-0000-0000-0000000005e3', '00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005a3', 'comprador', 'individual', 'Carlos Díaz', 'p2@example.com');

select aml.guardar_dato('00000000-0000-0000-0000-0000000005e1', 'entidad.razon_social', '"Inversiones Prueba, S.A."', 'cliente', null, null, null, 'cliente');
select aml.guardar_dato('00000000-0000-0000-0000-0000000005e1', 'representante.nombre_completo', '"Ana Pérez Soto"', 'cliente', null, null, null, 'cliente');
select aml.guardar_dato('00000000-0000-0000-0000-0000000005e1', 'beneficiarios_finales',
  '[{"nombre":"Roberto Gómez Lara","porcentaje":60},"Luisa Mejía Cruz, DPI 1234567890101, 40 %"]', 'cliente', null, null, null, 'cliente');
select aml.guardar_dato('00000000-0000-0000-0000-0000000005e2', 'cliente.nombre_completo', '"Carlos Díaz Ruiz"', 'cliente', null, null, null, 'cliente');
select aml.guardar_dato('00000000-0000-0000-0000-0000000005e3', 'cliente.nombre_completo', '"CARLOS DIAZ RUIZ"', 'cliente', null, null, null, 'cliente');

insert into aml.verificaciones (organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado) values
  ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e1', 'Inversiones Prueba, S.A.', 'onu', 'v1', 'sin_coincidencia'),
  ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e1', 'Ana Pérez Soto', 'onu', 'v1', 'sin_coincidencia'),
  ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e1', 'Roberto Gómez Lara', 'onu', 'v1', 'sin_coincidencia'),
  ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e3', 'CARLOS DIAZ RUIZ', 'onu', 'v1', 'sin_coincidencia');
insert into aml.verificaciones (id, organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado, coincidencias)
values ('00000000-0000-0000-0000-0000000005b1', '00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e2',
        'Carlos Díaz Ruiz', 'onu', 'v1', 'posible_coincidencia', '[{"referencia":"QDi.999"}]');

update aml.expedientes set estado = 'listo_para_decision'
 where id in ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-0000000005e3');
insert into aml.evaluaciones_riesgo (organizacion_id, expediente_id, configuracion_id, entrada, puntajes, puntaje_total, nivel_calculado, medidas)
values ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-00000000cf05', '{}', '{}', 20, 'bajo', 'estandar'),
       ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e3', '00000000-0000-0000-0000-00000000cf05', '{}', '{}', 20, 'bajo', 'estandar');

-- =============================================================================
-- 1. Lectura de las personas identificadas (igual que la aplicación)
-- =============================================================================
do $$ begin
  if (select string_agg(nombre, ' | ' order by rol, nombre) from aml.nombres_identificados('00000000-0000-0000-0000-0000000005e1'))
     <> 'Luisa Mejía Cruz | Roberto Gómez Lara | Inversiones Prueba, S.A. | Ana Pérez Soto' then
    raise exception 'FALLO: personas identificadas: %',
      (select string_agg(rol || '=' || nombre, ' | ' order by rol, nombre) from aml.nombres_identificados('00000000-0000-0000-0000-0000000005e1'));
  end if;
  if (select count(*) from aml.nombres_beneficiarios('[{"nombre":"  "}, 12, "AB", {"nombre":"Ok Nombre"}]')) <> 1 then
    raise exception 'FALLO: nombres_beneficiarios no descarta entradas vacías o cortas';
  end if;
end $$;

-- =============================================================================
-- 2. Cada beneficiario final debe estar cotejado antes de aprobar (A1)
-- =============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'f5000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    values ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e1', 'aprobar',
            'Aprobación con un beneficiario final sin cotejar', auth.uid());
    raise exception 'FALLO: se aprobó sin cotejar a un beneficiario final';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
    if sqlerrm not like '%Luisa Mejía Cruz%' then raise exception 'FALLO: mensaje inesperado: %', sqlerrm; end if;
  end;
end $$;
reset role;
insert into aml.verificaciones (organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado)
values ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e1', 'Luisa Mejía Cruz', 'onu', 'v1', 'sin_coincidencia');

-- =============================================================================
-- 3. Designaciones de la S/RES/1373: registro, inmutabilidad y revocación
-- =============================================================================
insert into aml.designaciones_1373 (id, tipo, nombre, alias, autoridad, referencia, designada_el, cargada_por)
values ('00000000-0000-0000-0000-000000001373', 'individual', 'Persona Designada Ejemplo', '{"P. D. Ejemplo"}',
        'Guatemala · Ministerio Público', 'Oficio MP-1373-001-2026', current_date - 10, 'admin@plataforma');
do $$
declare v1 text; v2 text;
begin
  begin
    insert into aml.designaciones_1373 (tipo, nombre, autoridad, referencia, designada_el, cargada_por)
    values ('individual', 'Fecha Futura', 'Autoridad X', 'Ref 1', current_date + 30, 'admin@plataforma');
    raise exception 'FALLO: se registró una designación con fecha futura';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    update aml.designaciones_1373 set nombre = 'Otro Nombre' where id = '00000000-0000-0000-0000-000000001373';
    raise exception 'FALLO: se modificó una designación';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    delete from aml.designaciones_1373 where id = '00000000-0000-0000-0000-000000001373';
    raise exception 'FALLO: se borró una designación';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  -- La versión cambia con cada alta o revocación
  v1 := aml.version_designaciones_1373();
  insert into aml.designaciones_1373 (id, tipo, nombre, autoridad, referencia, designada_el, cargada_por)
  values ('00000000-0000-0000-0000-000000001374', 'entidad', 'Entidad Designada Ejemplo', 'País Y', 'Res. 45-2026', current_date - 5, 'admin@plataforma');
  update aml.designaciones_1373
     set revocada_el = current_date - 1, revocacion_referencia = 'Res. 46-2026', revocada_por = 'admin@plataforma', revocada_en = now()
   where id = '00000000-0000-0000-0000-000000001374';
  v2 := aml.version_designaciones_1373();
  if v1 is null or v1 = v2 then raise exception 'FALLO: la versión de las designaciones no cambia'; end if;
  begin
    update aml.designaciones_1373 set revocada_el = current_date - 2, revocacion_referencia = 'Otra', revocada_por = 'x', revocada_en = now()
     where id = '00000000-0000-0000-0000-000000001374';
    raise exception 'FALLO: se revocó dos veces';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  if (select count(*) from aml.designaciones_1373_vigentes) <> 1 then raise exception 'FALLO: vista de vigentes'; end if;
end $$;
-- Los usuarios de las organizaciones no leen las designaciones
set local role authenticated;
set local request.jwt.claim.sub = 'f5000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    perform count(*) from aml.designaciones_1373;
    raise exception 'FALLO: el oficial lee la tabla de designaciones';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Con designaciones registradas, aprobar exige también el cotejo 1373
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    values ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e1', 'aprobar',
            'Aprobación sin cotejo con las designaciones 1373', auth.uid());
    raise exception 'FALLO: se aprobó sin cotejo 1373';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
    if sqlerrm not like '%S/RES/1373%' then raise exception 'FALLO: mensaje inesperado: %', sqlerrm; end if;
  end;
end $$;
reset role;
insert into aml.verificaciones (organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado)
select '00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e1', n.nombre, 'designacion_1373',
       aml.version_designaciones_1373(), 'sin_coincidencia'
  from aml.nombres_identificados('00000000-0000-0000-0000-0000000005e1') n;
set local role authenticated;
set local request.jwt.claim.sub = 'f5000000-0000-0000-0000-000000000000';
insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
values ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e1', 'aprobar',
        'Todas las personas cotejadas con ONU y 1373 sin coincidencias', auth.uid());
reset role;
do $$ begin
  if (select estado from aml.expedientes where id = '00000000-0000-0000-0000-0000000005e1') <> 'aprobado' then
    raise exception 'FALLO: con todos los cotejos el expediente debió aprobarse';
  end if;
end $$;

-- Una posible coincidencia 1373 abre la alerta de 24 h con su propio texto
insert into aml.verificaciones (id, organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado, coincidencias)
values ('00000000-0000-0000-0000-0000000005b9', '00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e2',
        'Carlos Díaz Ruiz', 'designacion_1373', 'vx', 'posible_coincidencia', '[]');
do $$ begin
  if not exists (select 1 from aml.alertas where evidencia->>'verificacionId' = '00000000-0000-0000-0000-0000000005b9'
                   and senal = 'ONU_POSIBLE' and descripcion like '%S/RES/1373%' and vence_en is not null) then
    raise exception 'FALLO: la posible coincidencia 1373 no abrió su alerta';
  end if;
end $$;

-- =============================================================================
-- 4. Bloqueo preventivo al confirmar una coincidencia
-- =============================================================================
-- P2 listo para aprobar (cotejos ONU y 1373 sin coincidencia)
insert into aml.verificaciones (organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado)
values ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e3', 'CARLOS DIAZ RUIZ', 'designacion_1373',
        aml.version_designaciones_1373(), 'sin_coincidencia');

set local role authenticated;
set local request.jwt.claim.sub = 'f5000000-0000-0000-0000-000000000000';
select * from aml.disponer_verificacion('00000000-0000-0000-0000-0000000005b1', 'coincidencia_confirmada',
  'Coincide nombre, fecha de nacimiento y nacionalidad con QDi.999');
reset role;
do $$ begin
  if (select count(*) from aml.bloqueos_preventivos where verificacion_id = '00000000-0000-0000-0000-0000000005b1' and levantado_en is null) <> 1 then
    raise exception 'FALLO: la confirmación no registró el bloqueo preventivo';
  end if;
  if not aml.expediente_bloqueado('00000000-0000-0000-0000-0000000005e3') then
    raise exception 'FALLO: el bloqueo no se extiende a la misma persona en otro expediente';
  end if;
  if aml.expediente_bloqueado('00000000-0000-0000-0000-0000000005e1') then
    raise exception 'FALLO: el bloqueo alcanzó un expediente sin relación';
  end if;
  if not exists (select 1 from aml.alertas where expediente_id = '00000000-0000-0000-0000-0000000005e3' and senal = 'BLOQUEO_RELACIONADO') then
    raise exception 'FALLO: no se alertó en el otro expediente de la misma persona';
  end if;
  if not exists (select 1 from aml.bitacora where entidad = 'bloqueos_preventivos' and evento = 'insert') then
    raise exception 'FALLO: el bloqueo no quedó en la bitácora';
  end if;
end $$;

-- No se aprueba el otro expediente de la misma persona
set local role authenticated;
set local request.jwt.claim.sub = 'f5000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    values ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e3', 'aprobar',
            'Intento de aprobar a una persona con bloqueo', auth.uid());
    raise exception 'FALLO: se aprobó a una persona con bloqueo preventivo';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
    if sqlerrm not like '%bloqueo preventivo%' then raise exception 'FALLO: mensaje inesperado: %', sqlerrm; end if;
  end;
end $$;

-- El ejecutivo no cierra la operación (mensaje neutro), no ve el bloqueo ni lo comunica
set local request.jwt.claim.sub = 'e5000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    perform aml.cerrar_operacion('00000000-0000-0000-0000-0000000005a3', 'cerrada');
    raise exception 'FALLO: se cerró la operación de una persona bloqueada';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
    if sqlerrm ~* '(onu|lista|coincid|bloqueo|1373)' then raise exception 'FALLO: mensaje no neutro: %', sqlerrm; end if;
  end;
  if (select count(*) from aml.bloqueos_preventivos) <> 0 then raise exception 'FALLO: el ejecutivo ve los bloqueos'; end if;
  begin
    perform aml.registrar_comunicacion_mp((select id from aml.bloqueos_preventivos limit 1), now(), 'Oficio 1');
    raise exception 'FALLO: el ejecutivo registró la comunicación';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;
-- El pago en efectivo se registra y avisa a cumplimiento (la ficha la crea el servidor)
reset role;
insert into aml.clientes (id, organizacion_id, tipo_persona, nombre, identificacion_tipo, identificacion_num)
values ('00000000-0000-0000-0000-0000000005c1', '00000000-0000-0000-0000-000000000c05', 'individual', 'CARLOS DIAZ RUIZ', 'DPI', '2222222220101');
set local role authenticated;
set local request.jwt.claim.sub = 'e5000000-0000-0000-0000-000000000000';
insert into aml.pagos_efectivo (organizacion_id, operacion_id, expediente_id, cliente_id, fecha, monto, moneda, tipo_cambio_usd, registrado_por)
values ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000005e3',
        '00000000-0000-0000-0000-0000000005c1', current_date, 50000, 'GTQ', 7.70, 'e5000000-0000-0000-0000-000000000000');
reset role;
do $$ begin
  if not exists (select 1 from aml.notificaciones where organizacion_id = '00000000-0000-0000-0000-000000000c05'
                   and destinatario_rol = 'cumplimiento' and prioridad = 'urgente'
                   and asunto like 'Pago en efectivo de una persona con bloqueo%') then
    raise exception 'FALLO: el pago en efectivo no avisó a cumplimiento';
  end if;
end $$;

-- El oficial: no cierra la alerta ni levanta el bloqueo sin la comunicación al MP
set local role authenticated;
set local request.jwt.claim.sub = 'f5000000-0000-0000-0000-000000000000';
do $$
declare b uuid := (select id from aml.bloqueos_preventivos where verificacion_id = '00000000-0000-0000-0000-0000000005b1');
  r record;
begin
  begin
    perform aml.cerrar_alerta((select id from aml.alertas where senal = 'ONU_CONFIRMADA'
                                 and evidencia->>'verificacionId' = '00000000-0000-0000-0000-0000000005b1'),
                              'Cierre sin comunicación al Ministerio Público');
    raise exception 'FALLO: se cerró la alerta sin comunicación al MP';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    perform aml.levantar_bloqueo(b, 'Levantamiento sin comunicación previa al MP', 'Res. 1');
    raise exception 'FALLO: se levantó el bloqueo sin comunicación';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    perform aml.registrar_comunicacion_mp(b, now() + interval '2 days', 'Oficio 1');
    raise exception 'FALLO: se registró una comunicación con fecha futura';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    update aml.bloqueos_preventivos set levantado_en = now() where id = b;
    if found then raise exception 'FALLO: el oficial modificó el bloqueo directamente'; end if;
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  select * into r from aml.registrar_comunicacion_mp(b, now(), 'Oficio CUMP-15-2026, recibido por el MP');
  if not r.dentro_de_plazo then raise exception 'FALLO: la comunicación inmediata debía quedar dentro del plazo'; end if;
  begin
    perform aml.registrar_comunicacion_mp(b, now(), 'Otro oficio');
    raise exception 'FALLO: se registró dos veces la comunicación';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  perform aml.cerrar_alerta((select id from aml.alertas where senal = 'ONU_CONFIRMADA'
                               and evidencia->>'verificacionId' = '00000000-0000-0000-0000-0000000005b1'),
                            'Comunicado al Ministerio Público con oficio CUMP-15-2026');
  begin
    perform aml.levantar_bloqueo(b, 'Corto', 'R');
    raise exception 'FALLO: se levantó el bloqueo sin motivo suficiente';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  perform aml.levantar_bloqueo(b, 'La persona fue excluida de la lista por el Comité de Sanciones', 'SC/99999 del 17-nov-2026');
end $$;

-- Levantado el bloqueo, el otro expediente (sin coincidencia propia) sí se aprueba
insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
values ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-0000000005e3', 'aprobar',
        'Bloqueo levantado por exclusión de la lista; cotejos sin coincidencia', auth.uid());
reset role;
do $$ begin
  if (select estado from aml.expedientes where id = '00000000-0000-0000-0000-0000000005e3') <> 'aprobado' then
    raise exception 'FALLO: levantado el bloqueo, el otro expediente debió aprobarse';
  end if;
  begin
    delete from aml.bloqueos_preventivos;
    raise exception 'FALLO: se borró un bloqueo';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    update aml.bloqueos_preventivos set levantamiento_motivo = 'Cambio posterior del motivo del levantamiento';
    raise exception 'FALLO: se modificó un bloqueo levantado';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;

select 'OK: 4 grupos de pruebas del art. 43 superados' as resultado;
rollback;
