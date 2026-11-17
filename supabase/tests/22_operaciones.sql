-- Pruebas de la vista operativa y del registro de efectivo por expediente.
-- Ejecutar sobre una base con las migraciones aplicadas. Todo se revierte al final.

begin;

insert into aml.organizaciones (id, nombre_legal, nombre_comercial, nit, subdominio) values
  ('00000000-0000-0000-0000-0000000000a1', 'Inmobiliaria Demo, S.A.', 'Demo Inmuebles', '1234567-8', 'demo-inmuebles'),
  ('00000000-0000-0000-0000-0000000000b2', 'Otra Inmobiliaria, S.A.', 'Otra', '7654321-0', 'otra');
insert into aml.miembros (organizacion_id, usuario_id, rol) values
  ('00000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'ejecutivo'),
  ('00000000-0000-0000-0000-0000000000a1', '22222222-2222-2222-2222-222222222222', 'oficial'),
  ('00000000-0000-0000-0000-0000000000a1', '44444444-4444-4444-4444-444444444444', 'auditor'),
  ('00000000-0000-0000-0000-0000000000b2', '33333333-3333-3333-3333-333333333333', 'ejecutivo');

-- El ejecutivo registra una operación con comprador y vendedor
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
create temp table op as
select * from aml.crear_operacion(
  '00000000-0000-0000-0000-0000000000a1', 'compraventa', '{"departamento":"Guatemala"}', 900000, 'GTQ',
  '[{"medio":"efectivo","monto":90000,"pagador":"cliente"}]',
  '[{"parte":"comprador","tipo_persona":"individual","contacto_nombre":"Comprador Ficticio","contacto_telefono":"+50255550001"},
    {"parte":"vendedor","tipo_persona":"juridica","contacto_nombre":"Vendedora Ficticia, S.A.","contacto_correo":"v@example.com"}]');

-- 1. El ejecutivo ve sus operaciones con dos partes
do $$ begin
  if (select count(*) from aml.operaciones_comercial) <> 2 then raise exception 'el ejecutivo debe ver las 2 partes'; end if;
  if (select tipo_persona from aml.operaciones_comercial where parte = 'vendedor') <> 'juridica' then
    raise exception 'tipo de persona incorrecto';
  end if;
end $$;

-- 2. La vista no tiene columnas de cumplimiento
do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'aml' and table_name = 'operaciones_comercial'
       and column_name ~ '(nivel|riesgo|verific|coincid|alerta|decisi|examen|evaluac)'
  ) then raise exception 'la vista expone columnas de cumplimiento'; end if;
end $$;

-- 3. El examen y el listo para decidir se ven como "en revisión" (art. 38)
reset role;
update aml.expedientes set estado = 'en_examen' where id = (select expediente_id from op where parte = 'comprador');
update aml.expedientes set estado = 'listo_para_decision' where id = (select expediente_id from op where parte = 'vendedor');
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  if exists (select 1 from aml.operaciones_comercial where estado <> 'en_revision') then
    raise exception 'la vista revela el estado real';
  end if;
end $$;

-- 4. Otra organización no ve nada
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$ begin
  if (select count(*) from aml.operaciones_comercial) <> 0 then raise exception 'fuga entre organizaciones'; end if;
end $$;

-- 5. El ejecutivo registra efectivo por expediente (sin cliente aún); no puede leerlo después
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into aml.pagos_efectivo (organizacion_id, operacion_id, expediente_id, fecha, monto, moneda, tipo_cambio_usd, registrado_por)
select '00000000-0000-0000-0000-0000000000a1', operacion_id, expediente_id, current_date, m, 'GTQ', 7.70,
       '11111111-1111-1111-1111-111111111111'
  from op, unnest(array[40000, 38000]) m where parte = 'comprador';
do $$ begin
  if (select count(*) from aml.pagos_efectivo) <> 0 then raise exception 'el ejecutivo no debe leer los pagos'; end if;
end $$;

-- 6. El oficial ve el registro diario agregado por expediente y marcado
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  if not (select sujeto_a_registro from aml.registro_efectivo_diario
           where expediente_id = (select expediente_id from op where parte = 'comprador')) then
    raise exception 'efectivo fraccionado por más de USD 10,000 no marcado';
  end if;
end $$;

-- 7. El auditor no registra pagos
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  begin
    insert into aml.pagos_efectivo (organizacion_id, operacion_id, expediente_id, fecha, monto, moneda, tipo_cambio_usd, registrado_por)
    select '00000000-0000-0000-0000-0000000000a1', operacion_id, expediente_id, current_date, 100, 'GTQ', 7.70,
           '44444444-4444-4444-4444-444444444444'
      from op where parte = 'comprador';
    raise exception 'FALLO: el auditor registró un pago';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 8. Un pago necesita cliente o expediente
reset role;
do $$ begin
  begin
    insert into aml.pagos_efectivo (organizacion_id, operacion_id, fecha, monto, moneda, tipo_cambio_usd)
    select '00000000-0000-0000-0000-0000000000a1', operacion_id, current_date, 100, 'GTQ', 7.70 from op limit 1;
    raise exception 'FALLO: se aceptó un pago sin cliente ni expediente';
  exception when check_violation then null;
  end;
end $$;

select 'OK: 8 pruebas de la vista operativa superadas' as resultado;
rollback;
