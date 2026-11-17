-- Pruebas del portal web. Ejecutar sobre una base con 00_stub_supabase.sql y
-- todas las migraciones aplicadas.
begin;

insert into aml.organizaciones (id, nombre_legal, nombre_comercial, nit, subdominio, marca)
values ('00000000-0000-0000-0000-0000000000a1', 'Inmobiliaria Portal, S.A.', 'Portal Inmuebles', '1111111-1', 'portal-inmuebles',
        '{"nombre_visible":"Portal Inmuebles","color_primario":"#1d4ed8"}');
insert into aml.operaciones (id, organizacion_id, tipo)
values ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-0000000000a1', 'compraventa');
insert into aml.expedientes (id, organizacion_id, operacion_id, parte, contacto_nombre, contacto_correo,
                             enlace_token_hash, enlace_expira_en, estado)
values ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000f001',
        'comprador', 'Cliente Ficticio', 'c@example.com', repeat('a', 64), now() + interval '7 days', 'en_examen'),
       ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000f001',
        'vendedor', 'Vendedor Ficticio', 'v@example.com', repeat('b', 64), now() - interval '1 day', 'en_captura');

-- 1. Mensaje web sin wa_id se acepta; WhatsApp sin wa_id no
insert into aml.mensajes (organizacion_id, expediente_id, direccion, tipo, texto, canal)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001', 'entrante', 'text', 'Hola', 'web');
do $$ begin
  begin
    insert into aml.mensajes (organizacion_id, expediente_id, direccion, tipo, texto, canal)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000e001', 'entrante', 'text', 'Hola', 'whatsapp');
    raise exception 'FALLO: mensaje de WhatsApp sin wa_id';
  exception when check_violation then null;
  end;
  begin
    insert into aml.mensajes (organizacion_id, direccion, tipo, texto, canal)
    values ('00000000-0000-0000-0000-0000000000a1', 'entrante', 'text', 'Hola', 'web');
    raise exception 'FALLO: mensaje web sin expediente';
  exception when check_violation then null;
  end;
end $$;

-- 2. Los mensajes existentes de WhatsApp quedan con canal por defecto
do $$ begin
  if (select column_default from information_schema.columns
       where table_schema = 'aml' and table_name = 'mensajes' and column_name = 'canal') not like '%whatsapp%' then
    raise exception 'canal debe tener whatsapp por defecto';
  end if;
end $$;

-- 3. Búsqueda por enlace: vigente, vencido e inexistente
do $$
declare r record;
begin
  select * into r from aml.expediente_por_enlace(repeat('a', 64));
  if r.expediente_id <> '00000000-0000-0000-0000-00000000e001' or not r.vigente then
    raise exception 'enlace vigente no encontrado';
  end if;
  if r.marca->>'color_primario' <> '#1d4ed8' then raise exception 'marca no devuelta'; end if;
  select * into r from aml.expediente_por_enlace(repeat('b', 64));
  if r.vigente then raise exception 'un enlace vencido no debe ser vigente'; end if;
  if exists (select 1 from aml.expediente_por_enlace(repeat('c', 64))) then
    raise exception 'un hash inexistente no debe devolver filas';
  end if;
end $$;

-- 4. La función no es ejecutable por usuarios autenticados
do $$ begin
  if has_function_privilege('authenticated', 'aml.expediente_por_enlace(text)', 'execute') then
    raise exception 'authenticated no debe poder buscar por enlace';
  end if;
end $$;

select 'OK: 4 pruebas del portal superadas' as resultado;
rollback;
