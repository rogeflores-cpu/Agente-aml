-- Pruebas de las correcciones de seguridad (migración 20261117001200).
-- Cada bloque reproduce un ataque o falla de docs/revision-independiente-2026-11-16.md
-- y comprueba que ya no funciona. Ejecutar sobre una base con todas las migraciones.

begin;

-- Datos base ------------------------------------------------------------------
-- Usuarios: administrador a0, ejecutivo e1, oficial f1, suplente f2, cuenta extra x9 (todos de la org C1)
insert into aml.organizaciones (id, nombre_legal, nombre_comercial, nit, subdominio)
values ('00000000-0000-0000-0000-000000000c01', 'Inmuebles Correcciones, S.A.', 'Correcciones', '1234567-8', 'correcciones');

insert into aml.miembros (organizacion_id, usuario_id, rol) values
  ('00000000-0000-0000-0000-000000000c01', 'a0000000-0000-0000-0000-000000000000', 'administrador'),
  ('00000000-0000-0000-0000-000000000c01', 'e1000000-0000-0000-0000-000000000000', 'ejecutivo'),
  ('00000000-0000-0000-0000-000000000c01', 'f1000000-0000-0000-0000-000000000000', 'oficial'),
  ('00000000-0000-0000-0000-000000000c01', 'f2000000-0000-0000-0000-000000000000', 'oficial_suplente');

insert into aml.configuraciones_riesgo (id, organizacion_id, version, parametros, aprobada_por, aprobada_en)
values ('00000000-0000-0000-0000-00000000cf01', '00000000-0000-0000-0000-000000000c01', 1,
        '{"pesosFactores":{"cliente":0.4,"geografia":0.2,"canal":0.15,"producto":0.25},"umbrales":{"medio":30,"alto":55},"actualizacionMeses":{"bajo":36,"medio":24,"alto":12},"umbralEfectivoUsd":10000}',
        'Consejo de Administración · acta 1-2026', current_date);

insert into aml.operaciones (id, organizacion_id, tipo)
values ('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-000000000c01', 'compraventa'),
       ('00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-000000000c01', 'compraventa');

-- Expedientes: e01 aprobación, e02 coincidencias, e03 rechazo, e04-e06 WhatsApp, e07 operación a cerrar
insert into aml.expedientes (id, organizacion_id, operacion_id, parte, contacto_nombre, contacto_telefono, contacto_correo, enlace_token_hash, enlace_expira_en) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000a001', 'comprador', 'Cliente Uno', '+502 5555 0010', null, repeat('1', 64), now() + interval '7 days'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000a001', 'vendedor', 'Cliente Dos', null, 'dos@example.com', null, null),
  ('00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000a002', 'comprador', 'Cliente Tres', null, 'tres@example.com', null, null),
  ('00000000-0000-0000-0000-00000000e004', '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000a002', 'vendedor', 'Cliente Cuatro', '+502 5555 1234', null, null, null);

insert into aml.canales_whatsapp (organizacion_id, waba_id, phone_number_id, numero_visible, nombre_visible, estado)
values ('00000000-0000-0000-0000-000000000c01', 'WABA-C', 'PNID-C1', '+502 5555 0000', 'Correcciones', 'activo');

-- Expediente e01 preparado para aprobar: nombre vigente, cotejo y evaluación
select aml.guardar_dato('00000000-0000-0000-0000-00000000e001', 'cliente.nombre_completo', '"José Ramírez López"', 'cliente', null, null, null, 'cliente');
insert into aml.verificaciones (organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e001', 'JOSE RAMIREZ LOPEZ', 'onu', 'v1', 'sin_coincidencia');

-- =============================================================================
-- C1. El administrador no se vuelve oficial ni toca roles de cumplimiento
-- =============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000000';
update aml.miembros set rol = 'oficial' where usuario_id = auth.uid();
do $$ begin
  begin
    insert into aml.miembros (organizacion_id, usuario_id, rol)
    values ('00000000-0000-0000-0000-000000000c01', 'b9000000-0000-0000-0000-000000000000', 'oficial');
    raise exception 'FALLO: el administrador agregó un oficial';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;
update aml.miembros set rol = 'ejecutivo' where usuario_id = 'f1000000-0000-0000-0000-000000000000';
update aml.miembros set activo = false where usuario_id = 'f1000000-0000-0000-0000-000000000000';
-- Sí puede administrar roles operativos de otras personas
insert into aml.miembros (organizacion_id, usuario_id, rol)
values ('00000000-0000-0000-0000-000000000c01', 'e2000000-0000-0000-0000-000000000000', 'ejecutivo');
do $$ begin
  if (select count(*) from aml.expedientes) <> 0 then raise exception 'C1: el administrador lee expedientes'; end if;
  if (select count(*) from aml.bitacora) <> 0 then raise exception 'C1: el administrador lee la bitácora'; end if;
end $$;
reset role;
do $$ begin
  if (select rol from aml.miembros where usuario_id = 'a0000000-0000-0000-0000-000000000000') <> 'administrador' then
    raise exception 'C1: el administrador cambió su propio rol';
  end if;
  if (select rol::text || activo::text from aml.miembros where usuario_id = 'f1000000-0000-0000-0000-000000000000') <> 'oficialtrue' then
    raise exception 'C1: el administrador modificó al oficial';
  end if;
  if not exists (select 1 from aml.miembros where usuario_id = 'e2000000-0000-0000-0000-000000000000') then
    raise exception 'C1: el administrador no pudo agregar un ejecutivo';
  end if;
  if (select count(*) from aml.bitacora where entidad = 'miembros' and organizacion_id = '00000000-0000-0000-0000-000000000c01') < 5 then
    raise exception 'C1: los cambios de miembros no quedan en la bitácora';
  end if;
end $$;

-- =============================================================================
-- C2. El oficial no salta los controles con UPDATE o INSERT directos
-- =============================================================================
insert into aml.verificaciones (id, organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado, coincidencias)
values ('00000000-0000-0000-0000-00000000b001', '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e002',
        'Cliente Dos', 'onu', 'v1', 'posible_coincidencia', '[{"nombre":"CLIENTE DOS"}]'),
       ('00000000-0000-0000-0000-00000000b002', '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e002',
        'Cliente Dos Bis', 'onu', 'v1', 'posible_coincidencia', '[]');
insert into aml.pendientes (id, organizacion_id, expediente_id, tipo, descripcion)
values ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e002', 'faltante', 'DPI (ambos lados)');
insert into aml.documentos (id, organizacion_id, expediente_id, tipo, ruta_storage, sha256, mime, tamano_bytes, canal)
values ('00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e002',
        'dpi', 'c01/e002/a.jpg', repeat('a', 64), 'image/jpeg', 1000, 'web');
insert into aml.evaluaciones_riesgo (id, organizacion_id, expediente_id, configuracion_id, entrada, puntajes, puntaje_total, nivel_calculado, medidas, reglas_impuestas)
values ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e002',
        '00000000-0000-0000-0000-00000000cf01', '{}', '{}', 40, 'medio', 'intensificada',
        '[{"codigo":"PEP","nivelMinimo":"medio","medidas":"intensificada"}]');

set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-0000-0000-000000000000';
do $$ begin
  -- 1. Aprobar con UPDATE directo del estado
  begin
    update aml.expedientes set estado = 'aprobado' where id = '00000000-0000-0000-0000-00000000e002';
    raise exception 'FALLO: el oficial cambió el estado sin decisión';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  -- 2. Pasar una posible coincidencia a sin_coincidencia
  begin
    perform aml.disponer_verificacion('00000000-0000-0000-0000-00000000b001', 'sin_coincidencia', null);
    raise exception 'FALLO: posible coincidencia cambiada a sin coincidencia';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  -- 3. Vaciar las coincidencias encontradas
  begin
    update aml.verificaciones set coincidencias = '[]' where id = '00000000-0000-0000-0000-00000000b001';
    raise exception 'FALLO: se borraron las coincidencias';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  -- 4. Reescribir el resultado del motor
  begin
    update aml.evaluaciones_riesgo set nivel_calculado = 'bajo', puntaje_total = 5, medidas = 'simplificada'
     where id = '00000000-0000-0000-0000-00000000ee01';
    raise exception 'FALLO: se reescribió la evaluación';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  -- 5. Bajar el nivel por debajo del mínimo de las reglas (M1)
  begin
    perform aml.ajustar_nivel_evaluacion('00000000-0000-0000-0000-00000000ee01', 'bajo', 'Cliente conocido desde hace muchos años');
    raise exception 'FALLO: nivel ajustado por debajo del mínimo';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  -- 6. Insertar datos como si los hubiera declarado el cliente
  begin
    insert into aml.datos_expediente (organizacion_id, expediente_id, campo, valor, origen, confirmado_por, confirmado_en)
    values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e002', 'cliente.cargo_publico', '"no"', 'cliente', 'cliente', now());
    raise exception 'FALLO: el oficial insertó un dato como cliente';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  -- 7. Reescribir el texto de un pendiente que ve el cliente (M9)
  begin
    update aml.pendientes set descripcion = 'Aclare coincidencia con listas' where id = '00000000-0000-0000-0000-00000000d001';
    raise exception 'FALLO: se reescribió un pendiente';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  -- 8. Cambiar el sello de un documento
  begin
    update aml.documentos set sha256 = repeat('b', 64) where id = '00000000-0000-0000-0000-00000000d0c1';
    raise exception 'FALLO: se cambió el sello de un documento';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;

-- Lo permitido sigue funcionando: ajuste único al nivel mínimo, corrección
-- de un dato con su nombre, disposición con justificación
select aml.ajustar_nivel_evaluacion('00000000-0000-0000-0000-00000000ee01', 'medio', 'Se mantiene el mínimo de la regla PEP vigente');
select aml.corregir_dato_oficial('00000000-0000-0000-0000-00000000e002', 'cliente.profesion', '"Ingeniero civil"', 'Dato verificado en llamada con el cliente');
select aml.disponer_verificacion('00000000-0000-0000-0000-00000000b001', 'coincidencia_confirmada',
       'Nombre, fecha de nacimiento y documento coinciden con el listado');
do $$ begin
  begin
    perform aml.ajustar_nivel_evaluacion('00000000-0000-0000-0000-00000000ee01', 'alto', 'Segundo ajuste sobre la misma evaluación');
    raise exception 'FALLO: segundo ajuste sobre la misma evaluación';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  -- Deshacer una coincidencia confirmada
  begin
    perform aml.disponer_verificacion('00000000-0000-0000-0000-00000000b001', 'descartada', 'Me equivoqué al confirmar esta coincidencia');
    raise exception 'FALLO: se revirtió una coincidencia confirmada';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;
reset role;
do $$ begin
  if (select origen from aml.datos_expediente where campo = 'cliente.profesion' and vigente) <> 'revisor' then
    raise exception 'C2: la corrección del oficial debe quedar con origen revisor';
  end if;
  begin
    update aml.documentos set sha256 = repeat('b', 64) where id = '00000000-0000-0000-0000-00000000d0c1';
    raise exception 'FALLO: el servidor cambió el sello de un documento';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  begin
    delete from aml.documentos where id = '00000000-0000-0000-0000-00000000d0c1';
    raise exception 'FALLO: se borró un documento';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;

-- =============================================================================
-- A6 y B4. La posible coincidencia abre alerta con 24 h desde la detección;
-- la confirmada conserva ese vencimiento; no se duplican alertas abiertas
-- =============================================================================
do $$
declare v_det timestamptz; v_vence timestamptz;
begin
  select consultado_en into v_det from aml.verificaciones where id = '00000000-0000-0000-0000-00000000b002';
  select vence_en into v_vence from aml.alertas
   where senal = 'ONU_POSIBLE' and evidencia->>'verificacionId' = '00000000-0000-0000-0000-00000000b002';
  if v_vence is distinct from v_det + interval '24 hours' then
    raise exception 'A6: la posible coincidencia no abrió alerta con 24 h desde la detección';
  end if;
  if (select estado from aml.alertas where senal = 'ONU_POSIBLE' and evidencia->>'verificacionId' = '00000000-0000-0000-0000-00000000b001') <> 'cerrada' then
    raise exception 'A6: la alerta de posible coincidencia confirmada debe cerrarse y continuar como confirmada';
  end if;
end $$;
-- El flujo crea la alerta confirmada con un vencimiento más tardío: la base lo corrige
insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion, evidencia, vence_en)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e002', 'ONU_CONFIRMADA', 'Coincidencia confirmada',
        '{"verificacionId":"00000000-0000-0000-0000-00000000b001"}', now() + interval '48 hours');
insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion, evidencia, vence_en)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e002', 'ONU_CONFIRMADA', 'Coincidencia confirmada',
        '{"verificacionId":"00000000-0000-0000-0000-00000000b001"}', now() + interval '48 hours');
insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e002', 'PAGO_TERCEROS', 'Pago de tercero'),
       ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e002', 'PAGO_TERCEROS', 'Pago de tercero');
do $$ begin
  if (select vence_en from aml.alertas where senal = 'ONU_CONFIRMADA')
     <> (select consultado_en + interval '24 hours' from aml.verificaciones where id = '00000000-0000-0000-0000-00000000b001') then
    raise exception 'A6: la alerta confirmada no conserva el vencimiento desde la detección';
  end if;
  if (select count(*) from aml.alertas where senal = 'ONU_CONFIRMADA') <> 1
     or (select count(*) from aml.alertas where senal = 'PAGO_TERCEROS') <> 1 then
    raise exception 'B4: se duplicaron alertas abiertas';
  end if;
end $$;

-- El oficial cierra una alerta pero no cambia su vencimiento ni la reabre
set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    update aml.alertas set vence_en = now() + interval '30 days' where senal = 'ONU_CONFIRMADA';
    raise exception 'FALLO: se cambió el vencimiento de una alerta';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;
select aml.cerrar_alerta((select id from aml.alertas where senal = 'PAGO_TERCEROS'), 'Comunicado al Ministerio Público, oficio 123-2026');
do $$ begin
  begin
    update aml.alertas set estado = 'abierta' where senal = 'PAGO_TERCEROS';
    if not found then raise exception 'bloqueado sin filas (sin permiso de actualización)'; end if;
    raise exception 'FALLO: se reabrió una alerta cerrada';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;
reset role;

-- =============================================================================
-- A1 y M4. Aprobación: cotejo ONU del nombre vigente, evaluación posterior a
-- los datos y transiciones válidas
-- =============================================================================
-- Sin evaluación, en estado en_captura: no procede
set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e001', 'aprobar',
            'Intento de aprobar en captura y sin evaluación', auth.uid());
    raise exception 'FALLO: se aprobó un expediente en captura';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;
reset role;
update aml.expedientes set estado = 'en_revision' where id = '00000000-0000-0000-0000-00000000e001';

-- Evaluación anterior al último dato: no procede
insert into aml.evaluaciones_riesgo (organizacion_id, expediente_id, configuracion_id, entrada, puntajes, puntaje_total, nivel_calculado, medidas, calculado_en)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000cf01',
        '{}', '{}', 10, 'bajo', 'estandar', now() - interval '1 hour');
set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e001', 'aprobar',
            'Aprobación con una evaluación desactualizada', auth.uid());
    raise exception 'FALLO: se aprobó con evaluación anterior a los datos';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;
reset role;

-- Nombre vigente cambiado después del cotejo: no procede (el cotejo es de otro nombre)
insert into aml.evaluaciones_riesgo (organizacion_id, expediente_id, configuracion_id, entrada, puntajes, puntaje_total, nivel_calculado, medidas)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e003', '00000000-0000-0000-0000-00000000cf01',
        '{}', '{}', 10, 'bajo', 'estandar');
select aml.guardar_dato('00000000-0000-0000-0000-00000000e003', 'cliente.nombre_completo', '"María Pérez"', 'cliente', null, null, null, 'cliente');
update aml.expedientes set estado = 'en_revision' where id = '00000000-0000-0000-0000-00000000e003';
set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e003', 'aprobar',
            'Aprobación sin ningún cotejo con la lista ONU', auth.uid());
    raise exception 'FALLO: se aprobó sin cotejo ONU';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;
reset role;

-- Con evaluación vigente y cotejo del nombre vigente: procede
insert into aml.evaluaciones_riesgo (organizacion_id, expediente_id, configuracion_id, entrada, puntajes, puntaje_total, nivel_calculado, medidas)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000cf01',
        '{}', '{}', 10, 'bajo', 'estandar');
set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-0000-0000-000000000000';
insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e001', 'aprobar',
        'Debida diligencia completa y cotejo sin coincidencias', auth.uid());
reset role;

-- M4: el cliente ya no modifica un expediente aprobado; un rechazado no se aprueba
do $$ begin
  begin
    perform aml.guardar_dato('00000000-0000-0000-0000-00000000e001', 'cliente.nombre_completo', '"Otro Nombre"', 'cliente', null, null, null, 'cliente');
    raise exception 'FALLO: el cliente cambió un expediente aprobado';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;

-- M4: si el cliente aporta datos en revisión, el expediente vuelve a captura
select aml.guardar_dato('00000000-0000-0000-0000-00000000e003', 'cliente.estado_civil', '"casado"', 'cliente', null, null, null, 'cliente');
do $$ begin
  if (select estado from aml.expedientes where id = '00000000-0000-0000-0000-00000000e003') <> 'en_captura' then
    raise exception 'M4: el dato nuevo en revisión debe regresar el expediente a captura';
  end if;
end $$;

-- =============================================================================
-- A4. Abrir un examen después de aprobar no cambia lo que ven el ejecutivo ni el cliente
-- =============================================================================
create temp table antes_examen as
select estado, actualizado_comercial_en from aml.expedientes where id = '00000000-0000-0000-0000-00000000e001';
grant select on antes_examen to authenticated;
set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-0000-0000-000000000000';
insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e001', 'abrir_examen',
        'Señal posterior: pago de un tercero sin relación aparente', auth.uid());
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-000000000000';
do $$ begin
  if (select estado from aml.expedientes_comercial where id = '00000000-0000-0000-0000-00000000e001') <> 'aprobado'
     or (select estado from aml.operaciones_comercial where expediente_id = '00000000-0000-0000-0000-00000000e001') <> 'aprobado' then
    raise exception 'A4: el ejecutivo ve un cambio al abrir el examen';
  end if;
  if (select actualizado_en from aml.expedientes_comercial where id = '00000000-0000-0000-0000-00000000e001')
     <> (select actualizado_comercial_en from antes_examen) then
    raise exception 'A4: la marca de tiempo visible cambió al abrir el examen';
  end if;
end $$;
reset role;
do $$ begin
  if (select estado from aml.expediente_por_enlace(repeat('1', 64))) <> 'aprobado' then
    raise exception 'A4: el portal recibe el estado real';
  end if;
  if (select estado from aml.expedientes where id = '00000000-0000-0000-0000-00000000e001') <> 'en_examen' then
    raise exception 'A4: cumplimiento debe ver el examen';
  end if;
end $$;

-- =============================================================================
-- B8 y fin de la relación (art. 34)
-- =============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'f2000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e003', 'rechazar',
            'Riesgo fuera de la política aprobada', auth.uid());
    raise exception 'FALLO: el suplente decidió sin motivo de suplencia';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;
insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por, motivo_suplencia)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e003', 'rechazar',
        'Riesgo fuera de la política aprobada', auth.uid(), 'Titular de vacaciones del 15 al 30 de noviembre');
reset role;
do $$ begin
  if (select fin_relacion from aml.expedientes where id = '00000000-0000-0000-0000-00000000e003') is null
     or (select conservar_hasta from aml.expedientes where id = '00000000-0000-0000-0000-00000000e003') is null then
    raise exception 'Art. 34: el rechazo debe fijar el fin de la relación y el plazo de conservación';
  end if;
end $$;
set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000e003', 'aprobar',
            'Intento de aprobar un expediente rechazado', auth.uid());
    raise exception 'FALLO: se aprobó un expediente rechazado';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;
-- La inmobiliaria cierra la operación: corre el plazo de todos sus expedientes
set local request.jwt.claim.sub = 'e1000000-0000-0000-0000-000000000000';
select aml.cerrar_operacion('00000000-0000-0000-0000-00000000a001', 'cerrada');
reset role;
do $$ begin
  if exists (select 1 from aml.expedientes where operacion_id = '00000000-0000-0000-0000-00000000a001' and fin_relacion is null) then
    raise exception 'Art. 34: cerrar la operación debe fijar el fin de la relación';
  end if;
  begin
    update aml.operaciones set estado = 'abierta' where id = '00000000-0000-0000-0000-00000000a001';
    raise exception 'FALLO: se reabrió una operación cerrada';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;

-- =============================================================================
-- A3. Vinculación de WhatsApp: ligada al teléfono registrado y con límite
-- =============================================================================
select aml.fijar_codigo_vinculacion('00000000-0000-0000-0000-00000000e004', '135790', 30);
select aml.fijar_codigo_vinculacion('00000000-0000-0000-0000-00000000e002', '246802', 30);
do $$
declare i integer;
begin
  -- Otro número con el código correcto de un expediente con teléfono registrado
  if aml.vincular_whatsapp('PNID-C1', '50299990000', '135790') is not null then
    raise exception 'A3: se vinculó desde un número distinto al registrado';
  end if;
  -- Cinco fallos bloquean al número, aunque después acierte
  for i in 1..5 loop
    perform aml.vincular_whatsapp('PNID-C1', '50255551234', lpad(i::text, 6, '0'));
  end loop;
  if aml.vincular_whatsapp('PNID-C1', '50255551234', '135790') is not null then
    raise exception 'A3: el número bloqueado pudo vincularse';
  end if;
  -- Expediente sin teléfono: cualquier número con el código correcto (dentro del límite)
  if aml.vincular_whatsapp('PNID-C1', '50277778888', '246802') <> '00000000-0000-0000-0000-00000000e002' then
    raise exception 'A3: un intento legítimo no se vinculó';
  end if;
  if (select codigo_vinculacion_hash from aml.expedientes where id = '00000000-0000-0000-0000-00000000e004')
     = encode(digest('135790', 'sha256'), 'hex') then
    raise exception 'A3: el código se guarda sin sal';
  end if;
end $$;

-- =============================================================================
-- A2. Bitácora: sin TRUNCATE, secuencia continua y ancla
-- =============================================================================
do $$
declare v_sec bigint; v_hash text;
begin
  begin
    truncate aml.bitacora;
    raise exception 'FALLO: se vació la bitácora';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  begin
    truncate aml.decisiones cascade;
    raise exception 'FALLO: se vaciaron las decisiones';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
  if exists (select 1 from aml.verificar_bitacora('00000000-0000-0000-0000-000000000c01')) then
    raise exception 'A2: la cadena íntegra no verificó';
  end if;
  select secuencia, hash into v_sec, v_hash from aml.ultimo_eslabon_bitacora('00000000-0000-0000-0000-000000000c01');
  if v_sec <> (select count(*) from aml.bitacora where organizacion_id = '00000000-0000-0000-0000-000000000c01') then
    raise exception 'A2: la secuencia no es continua';
  end if;
  if not aml.verificar_ancla_bitacora('00000000-0000-0000-0000-000000000c01', v_sec, v_hash) then
    raise exception 'A2: el ancla no verificó';
  end if;
  -- Actor deducido: la decisión queda a nombre del oficial aunque la escriba el servidor
  if not exists (select 1 from aml.bitacora where entidad = 'decisiones' and actor_tipo = 'usuario'
                  and actor_id = 'f1000000-0000-0000-0000-000000000000') then
    raise exception 'A2: el actor de la decisión no quedó registrado';
  end if;
  if not exists (select 1 from aml.bitacora where entidad = 'datos_expediente' and actor_tipo = 'cliente') then
    raise exception 'A2: los datos del cliente no quedan a nombre del cliente';
  end if;
end $$;

-- =============================================================================
-- M2. Metodología: el oficial solo propone; la base valida lo aprobado
-- =============================================================================
set local role authenticated;
set local request.jwt.claim.sub = 'f1000000-0000-0000-0000-000000000000';
do $$ begin
  begin
    insert into aml.configuraciones_riesgo (organizacion_id, version, parametros, aprobada_por, aprobada_en)
    values ('00000000-0000-0000-0000-000000000c01', 2, '{"umbrales":{"medio":99,"alto":100}}', 'yo mismo', current_date);
    raise exception 'FALLO: el oficial aprobó su propia metodología';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;
insert into aml.configuraciones_riesgo (organizacion_id, version, parametros)
values ('00000000-0000-0000-0000-000000000c01', 2, '{"umbrales":{"medio":99,"alto":100}}');
reset role;
do $$ begin
  begin
    update aml.configuraciones_riesgo set aprobada_por = 'Consejo · acta 2-2026', aprobada_en = current_date
     where organizacion_id = '00000000-0000-0000-0000-000000000c01' and version = 2;
    raise exception 'FALLO: se aprobó una metodología inválida';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;

-- =============================================================================
-- M6. Listas GAFI con fecha de pleno futura
-- =============================================================================
do $$ begin
  begin
    insert into aml.listas_gafi (plenario, alto_riesgo, monitoreo, fuente_alto_riesgo, fuente_monitoreo, cargada_por)
    values (current_date + 30, '{}', '{}', 'https://www.fatf-gafi.org/x', 'https://www.fatf-gafi.org/y', 'prueba');
    raise exception 'FALLO: se cargó un pleno con fecha futura';
  exception when others then if sqlerrm like 'FALLO%' then raise; end if; raise notice 'bloqueado: %', sqlerrm;
  end;
end $$;

-- =============================================================================
-- B2. Efectivo fraccionado en varios días (art. 31)
-- =============================================================================
insert into aml.pagos_efectivo (organizacion_id, operacion_id, expediente_id, fecha, monto, moneda, tipo_cambio_usd)
values ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000e004', current_date - 10, 30800, 'GTQ', 7.70),
       ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000e004', current_date - 5, 30800, 'GTQ', 7.70),
       ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-00000000a002', '00000000-0000-0000-0000-00000000e004', current_date, 30800, 'GTQ', 7.70);
do $$ begin
  if exists (select 1 from aml.registro_efectivo_diario where sujeto_a_registro and expediente_id = '00000000-0000-0000-0000-00000000e004') then
    raise exception 'B2: ningún día individual supera el umbral';
  end if;
  if not exists (select 1 from aml.efectivo_acumulado_30_dias where revisar_estructuracion and expediente_id = '00000000-0000-0000-0000-00000000e004') then
    raise exception 'B2: el fraccionamiento en varios días no se señala';
  end if;
end $$;

select 'OK: 14 grupos de pruebas de correcciones superados' as resultado;
rollback;
