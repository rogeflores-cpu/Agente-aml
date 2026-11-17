-- Pruebas de reglas de negocio y seguridad. Ejecutar sobre una base con las
-- migraciones aplicadas:  psql -v ON_ERROR_STOP=1 -f supabase/tests/10_pruebas_reglas.sql
-- Cada bloque falla con una excepción si la regla no se cumple.

begin;

-- Datos base -----------------------------------------------------------------
insert into aml.organizaciones (id, nombre_legal, nombre_comercial, nit, subdominio)
values ('00000000-0000-0000-0000-0000000000a1', 'Inmobiliaria Demo, S.A.', 'Demo Inmuebles', '1234567-8', 'demo-inmuebles'),
       ('00000000-0000-0000-0000-0000000000b2', 'Otra Inmobiliaria, S.A.', 'Otra', '7654321-0', 'otra');

insert into aml.miembros (organizacion_id, usuario_id, rol) values
  ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'ejecutivo'),
  ('00000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'oficial'),
  ('00000000-0000-0000-0000-0000000000b2', '33333333-3333-3333-3333-333333333333', 'oficial');

insert into aml.configuraciones_riesgo (id, organizacion_id, version, parametros, aprobada_por, aprobada_en)
values ('00000000-0000-0000-0000-00000000c0f1', '00000000-0000-0000-0000-0000000000a1', 1,
        '{"pesosFactores":{"cliente":0.4,"geografia":0.2,"canal":0.15,"producto":0.25},"umbrales":{"medio":30,"alto":55},"actualizacionMeses":{"bajo":36,"medio":24,"alto":12},"umbralEfectivoUsd":10000}',
        'Consejo de Administración', current_date);
-- (Ajuste 17/11/2026: desde la migración de correcciones la base valida los
-- parámetros de una metodología aprobada; antes aceptaba '{}'.)

-- 1. El ejecutivo registra una operación con dos partes ----------------------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

create temp table creada as
select * from aml.crear_operacion(
  '00000000-0000-0000-0000-0000000000a1', 'compraventa',
  '{"departamento":"Guatemala","municipio":"Guatemala","finca":"123"}', 1500000, 'GTQ',
  '[{"medio":"transferencia","monto":1500000,"moneda":"GTQ"}]',
  '[{"parte":"comprador","contacto_nombre":"Ana Pérez","contacto_telefono":"+50255550001"},
    {"parte":"vendedor","contacto_nombre":"Luis Gómez","contacto_correo":"luis@example.com"}]');

do $$ begin
  if (select count(*) from creada) <> 2 then raise exception 'debían crearse 2 expedientes'; end if;
  if (select min(codigo) from creada) !~ '^OP-\d{4}-00001$' then raise exception 'código correlativo incorrecto'; end if;
end $$;

-- 2. El ejecutivo NO ve la tabla de expedientes; sí la vista enmascarada ----
do $$ begin
  if (select count(*) from aml.expedientes) <> 0 then raise exception 'el ejecutivo no debe leer expedientes'; end if;
  if (select count(*) from aml.expedientes_comercial) <> 2 then raise exception 'el ejecutivo debe ver la vista comercial'; end if;
end $$;

-- 3. El ejecutivo no puede decidir ------------------------------------------
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    select '00000000-0000-0000-0000-0000000000a1', expediente_id, 'aprobar',
           'Intento de aprobación por ejecutivo comercial', '11111111-1111-1111-1111-111111111111'
      from creada limit 1;
    raise exception 'FALLO: el ejecutivo pudo decidir';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 4. El oficial de otra organización no ve nada de esta --------------------
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  if (select count(*) from aml.expedientes) <> 0 then raise exception 'fuga entre organizaciones (expedientes)'; end if;
  if (select count(*) from aml.expedientes_comercial) <> 0 then raise exception 'fuga entre organizaciones (vista)'; end if;
  -- (Ajuste 17/11/2026: ahora se auditan organizaciones y miembros, así que la
  -- organización B tiene eventos propios; se verifica que no vea los de A.)
  if (select count(*) from aml.bitacora where organizacion_id <> '00000000-0000-0000-0000-0000000000b2') <> 0 then
    raise exception 'fuga entre organizaciones (bitácora)';
  end if;
end $$;

-- 5. Verificación con posible coincidencia bloquea la aprobación -----------
reset role;
insert into aml.verificaciones (organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, resultado, coincidencias)
select '00000000-0000-0000-0000-0000000000a1', expediente_id, 'Ana Pérez', 'onu', '2026-11-11', 'posible_coincidencia',
       '[{"nombre":"ANA PERES","puntaje":0.91}]'
  from creada where parte = 'comprador';

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  begin
    insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
    select '00000000-0000-0000-0000-0000000000a1', expediente_id, 'aprobar',
           'Expediente completo y sin observaciones relevantes', '22222222-2222-2222-2222-222222222222'
      from creada where parte = 'comprador';
    raise exception 'FALLO: se aprobó con coincidencia sin disponer';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;

-- 6. El ejecutivo no ve verificaciones -------------------------------------
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if (select count(*) from aml.verificaciones) <> 0 then raise exception 'el ejecutivo no debe ver verificaciones (art. 38)'; end if;
end $$;

-- 7. El oficial descarta la coincidencia con justificación y aprueba -------
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
update aml.verificaciones
   set resultado = 'descartada', dispuesto_por = '22222222-2222-2222-2222-222222222222', dispuesto_en = now(),
       justificacion = 'Fecha de nacimiento y nacionalidad distintas a las del listado'
 where nombre_consultado = 'Ana Pérez';

-- (Ajuste 17/11/2026: antes se aprobaba un expediente 'invitado', sin nombre
-- identificado y sin evaluación de riesgo, lo que la revisión independiente
-- marcó como inseguro (A1, M4). Ahora el expediente pasa por captura y
-- revisión, el nombre cotejado es el vigente y hay una evaluación posterior.)
reset role;
select aml.guardar_dato((select expediente_id from creada where parte = 'comprador'),
                        'cliente.nombre_completo', '"Ana Pérez"', 'cliente', null, null, null, 'cliente');
update aml.expedientes set estado = 'en_revision' where id = (select expediente_id from creada where parte = 'comprador');
insert into aml.evaluaciones_riesgo (organizacion_id, expediente_id, configuracion_id, entrada, puntajes, puntaje_total, nivel_calculado, medidas)
select '00000000-0000-0000-0000-0000000000a1', expediente_id, '00000000-0000-0000-0000-00000000c0f1', '{}', '{}', 10, 'bajo', 'estandar'
  from creada where parte = 'comprador';
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
select '00000000-0000-0000-0000-0000000000a1', expediente_id, 'aprobar',
       'Debida diligencia completa, riesgo bajo y coincidencia descartada', '22222222-2222-2222-2222-222222222222'
  from creada where parte = 'comprador';

do $$ begin
  if (select e.estado from aml.expedientes e join creada c on c.expediente_id = e.id where c.parte = 'comprador') <> 'aprobado' then
    raise exception 'la decisión no actualizó el expediente';
  end if;
end $$;

-- 8. El examen de inusualidad se enmascara para el ejecutivo ---------------
insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
select '00000000-0000-0000-0000-0000000000a1', expediente_id, 'abrir_examen',
       'Pago de tercero sin relación aparente con el comprador', '22222222-2222-2222-2222-222222222222'
  from creada where parte = 'vendedor';
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if exists (select 1 from aml.expedientes_comercial where estado = 'en_examen') then
    raise exception 'la vista revela el examen (art. 38)';
  end if;
end $$;

-- 9. Las decisiones son inmutables ----------------------------------------
reset role;
do $$ begin
  begin
    update aml.decisiones set justificacion = 'cambio posterior a la decisión registrada';
    raise exception 'FALLO: se modificó una decisión';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;

-- 10. Verificación diferida máxima de 3 meses (art. 22) --------------------
do $$ begin
  begin
    update aml.expedientes set verificacion_diferida_hasta = current_date + 120
     where id = (select expediente_id from creada where parte = 'vendedor');
    raise exception 'FALLO: se aceptó un diferimiento mayor a 3 meses';
  exception when check_violation then null;
  end;
end $$;

-- 11. Beneficiario final: 15 % o control por otro medio (art. 2 b) --------
do $$ begin
  begin
    insert into aml.personas_relacionadas (organizacion_id, expediente_id, rol, nombre, porcentaje)
    select '00000000-0000-0000-0000-0000000000a1', expediente_id, 'beneficiario_final', 'Socio menor', 10
      from creada where parte = 'comprador';
    raise exception 'FALLO: se aceptó un beneficiario final con 10 %%';
  exception when check_violation then null;
  end;
end $$;

-- 12. Registro de efectivo: pagos fraccionados del mismo día suman (art. 31)
insert into aml.clientes (id, organizacion_id, tipo_persona, nombre, identificacion_tipo, identificacion_num)
values ('00000000-0000-0000-0000-00000000c111', '00000000-0000-0000-0000-0000000000a1', 'individual', 'Ana Pérez', 'DPI', '1234567890101');
insert into aml.pagos_efectivo (organizacion_id, operacion_id, cliente_id, fecha, monto, moneda, tipo_cambio_usd)
select '00000000-0000-0000-0000-0000000000a1', operacion_id, '00000000-0000-0000-0000-00000000c111', current_date, m, 'GTQ', 7.70
  from (select distinct operacion_id from creada) o, unnest(array[40000, 38000]) m;
do $$ begin
  if not (select sujeto_a_registro from aml.registro_efectivo_diario
           where cliente_id = '00000000-0000-0000-0000-00000000c111') then
    raise exception 'pagos fraccionados por más de USD 10,000 no marcados';
  end if;
end $$;

-- 13. Bitácora: cadena íntegra y detección de alteraciones ----------------
do $$ declare n integer; begin
  select count(*) into n from aml.bitacora where organizacion_id = '00000000-0000-0000-0000-0000000000a1';
  if n < 8 then raise exception 'bitácora incompleta: % eventos', n; end if;
  if exists (select 1 from aml.verificar_bitacora('00000000-0000-0000-0000-0000000000a1')) then
    raise exception 'la cadena íntegra no verificó';
  end if;
end $$;

alter table aml.bitacora disable trigger bitacora_inmutable;
update aml.bitacora set evento = 'alterado'
 where id = (select min(id) + 2 from aml.bitacora where organizacion_id = '00000000-0000-0000-0000-0000000000a1');
alter table aml.bitacora enable trigger bitacora_inmutable;
do $$ begin
  if not exists (select 1 from aml.verificar_bitacora('00000000-0000-0000-0000-0000000000a1')) then
    raise exception 'la alteración de la bitácora no se detectó';
  end if;
end $$;

-- 14. Vinculación de WhatsApp: solo con el código vigente y en el número de la organización
insert into aml.canales_whatsapp (organizacion_id, waba_id, phone_number_id, numero_visible, nombre_visible, estado)
values ('00000000-0000-0000-0000-0000000000a1', 'WABA1', 'PNID-A1', '+502 5555 0000', 'Demo Inmuebles', 'activo'),
       ('00000000-0000-0000-0000-0000000000b2', 'WABA2', 'PNID-B2', '+502 5555 9999', 'Otra', 'activo');
-- (Ajuste 17/11/2026: el código ahora se fija con su sal por expediente.)
select aml.fijar_codigo_vinculacion((select expediente_id from creada where parte = 'comprador'), '482913', 30);
do $$ begin
  if aml.vincular_whatsapp('PNID-B2', '50255550001', '482913') is not null then
    raise exception 'se vinculó desde el número de otra organización';
  end if;
  if aml.vincular_whatsapp('PNID-A1', '50255550001', '000000') is not null then
    raise exception 'se vinculó con un código incorrecto';
  end if;
  if aml.vincular_whatsapp('PNID-A1', '50255550001', '482913') is null then
    raise exception 'no se vinculó con el código correcto';
  end if;
  if aml.vincular_whatsapp('PNID-A1', '50255550001', '482913') is not null then
    raise exception 'el código se pudo usar dos veces';
  end if;
end $$;

-- 15. Listas GAFI: versión por pleno, códigos válidos, sin traslape e inmutables
insert into aml.listas_gafi (plenario, alto_riesgo, monitoreo, fuente_alto_riesgo, fuente_monitoreo, cargada_por)
values ('2026-10-30', '{AA,BB}', '{CC}', 'https://www.fatf-gafi.org/x', 'https://www.fatf-gafi.org/y', 'prueba');
do $$ begin
  begin
    insert into aml.listas_gafi (plenario, alto_riesgo, monitoreo, fuente_alto_riesgo, fuente_monitoreo, cargada_por)
    values ('2027-02-20', '{AA}', '{AA}', 'x', 'y', 'prueba');
    raise exception 'FALLO: se aceptó un país en ambas listas';
  exception when check_violation then null;
  end;
  begin
    insert into aml.listas_gafi (plenario, alto_riesgo, monitoreo, fuente_alto_riesgo, fuente_monitoreo, cargada_por)
    values ('2027-02-21', '{gt}', '{}', 'x', 'y', 'prueba');
    raise exception 'FALLO: se aceptó un código inválido';
  exception when check_violation then null;
  end;
  begin
    update aml.listas_gafi set monitoreo = '{}';
    raise exception 'FALLO: se modificó una versión publicada';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
  if (select plenario from aml.lista_gafi_vigente) <> '2026-10-30' then
    raise exception 'la vista vigente no devuelve el último pleno';
  end if;
end $$;

-- 16. Datos con procedencia: un solo valor vigente y paso a 'en_captura'
reset role;
do $$
declare v_exp uuid; v_doc uuid;
begin
  insert into aml.expedientes (organizacion_id, operacion_id, parte, tipo_persona, contacto_nombre, contacto_correo)
  select '00000000-0000-0000-0000-0000000000a1', operacion_id, 'comprador', 'juridica', 'Inversiones Demo', 'x@example.com'
    from creada limit 1
  returning id into v_exp;
  insert into aml.documentos (organizacion_id, expediente_id, tipo, ruta_storage, sha256, mime, tamano_bytes, canal)
  values ('00000000-0000-0000-0000-0000000000a1', v_exp, 'patente_sociedad', 'x/y.pdf', repeat('a', 64), 'application/pdf', 1000, 'whatsapp')
  returning id into v_doc;
  perform aml.guardar_dato(v_exp, 'entidad.razon_social', '"INVERSIONES DEMO SA"', 'documento', v_doc, 1, 0.8, null);
  perform aml.guardar_dato(v_exp, 'entidad.razon_social', '"Inversiones Demo, S.A."', 'cliente', null, null, null, 'cliente');
  if (select count(*) from aml.datos_expediente where expediente_id = v_exp and campo = 'entidad.razon_social' and vigente) <> 1 then
    raise exception 'debe haber un solo valor vigente';
  end if;
  if (select valor #>> '{}' from aml.datos_expediente where expediente_id = v_exp and campo = 'entidad.razon_social' and vigente) <> 'Inversiones Demo, S.A.' then
    raise exception 'el valor vigente no es el último';
  end if;
  if (select estado from aml.expedientes where id = v_exp) <> 'en_captura' then
    raise exception 'el expediente no pasó a en_captura';
  end if;
  perform aml.guardar_dato(v_exp, 'entidad.nit', '"1234567-8"', 'documento', v_doc, 1, 0.95, null);
  if not aml.confirmar_dato(v_exp, 'entidad.nit', 'cliente') then raise exception 'no confirmó'; end if;
  if (select confirmado_en from aml.datos_expediente where expediente_id = v_exp and campo = 'entidad.nit' and vigente) is null then
    raise exception 'confirmado_en vacío';
  end if;
end $$;

-- 17. Bandeja de cumplimiento: el oficial la ve con conteos; el ejecutivo no ve filas
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if (select count(*) from aml.bandeja_cumplimiento) < 2 then raise exception 'el oficial debe ver la bandeja'; end if;
  if (select count(*) from aml.mis_organizaciones) <> 1 then raise exception 'mis_organizaciones incorrecta'; end if;
end $$;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if (select count(*) from aml.bandeja_cumplimiento) <> 0 then raise exception 'el ejecutivo no debe ver la bandeja de cumplimiento'; end if;
end $$;
reset role;

select 'OK: 17 pruebas de reglas y seguridad superadas' as resultado;
rollback;
