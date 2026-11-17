-- Pruebas de la administración de la plataforma (migración 20261117001100).
-- Ejecutar sobre una base con las migraciones aplicadas.

begin;

insert into aml.organizaciones (id, nombre_legal, nombre_comercial, nit, subdominio)
values ('00000000-0000-0000-0000-0000000000c3', 'Inmuebles Prueba, S.A.', 'Inmuebles Prueba', '1234567-8', 'inmuebles-prueba');

-- 1. Metodología: se aprueba una sola vez; luego no se modifica ni se borra
insert into aml.configuraciones_riesgo (organizacion_id, version, parametros)
values ('00000000-0000-0000-0000-0000000000c3', 1, '{"version": 1}');

do $$ begin
  begin
    update aml.configuraciones_riesgo set aprobada_en = current_date
     where organizacion_id = '00000000-0000-0000-0000-0000000000c3';
    raise exception 'FALLO: se aprobó sin indicar quién aprobó';
  exception when check_violation then null;
  end;
end $$;

update aml.configuraciones_riesgo
   set aprobada_en = current_date, aprobada_por = 'Consejo de Administración · acta 12-2026', vigente_desde = now()
 where organizacion_id = '00000000-0000-0000-0000-0000000000c3';

do $$ begin
  begin
    update aml.configuraciones_riesgo set parametros = '{"version": 1, "cambio": true}'
     where organizacion_id = '00000000-0000-0000-0000-0000000000c3';
    raise exception 'FALLO: se modificó una metodología aprobada';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
  begin
    delete from aml.configuraciones_riesgo where organizacion_id = '00000000-0000-0000-0000-0000000000c3';
    raise exception 'FALLO: se borró una metodología aprobada';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
  end;
end $$;

-- Una versión nueva sin aprobar sí puede ajustarse antes de su aprobación
insert into aml.configuraciones_riesgo (organizacion_id, version, parametros)
values ('00000000-0000-0000-0000-0000000000c3', 2, '{"version": 2}');
update aml.configuraciones_riesgo set parametros = '{"version": 2, "ajuste": true}'
 where organizacion_id = '00000000-0000-0000-0000-0000000000c3' and version = 2;

-- 2. Estado de alta
insert into aml.miembros (organizacion_id, usuario_id, rol)
values ('00000000-0000-0000-0000-0000000000c3', '44444444-4444-4444-4444-444444444444', 'oficial');

do $$ declare e record; begin
  select * into e from aml.estado_alta_organizaciones where id = '00000000-0000-0000-0000-0000000000c3';
  if e.metodologia_version_aprobada <> 1 then raise exception 'versión aprobada incorrecta'; end if;
  if not e.metodologia_pendiente then raise exception 'debe haber versión pendiente'; end if;
  if e.oficiales <> 1 then raise exception 'oficiales incorrecto'; end if;
  if e.lista_para_operar then raise exception 'no puede estar lista sin IVE ni WhatsApp'; end if;
end $$;

-- 3. La vista de estado de alta no es visible para usuarios de las organizaciones
do $$ begin
  if has_table_privilege('authenticated', 'aml.estado_alta_organizaciones', 'select') then
    raise exception 'authenticated no debe leer el estado de alta';
  end if;
  if has_function_privilege('authenticated', 'aml.guardar_token_canal(uuid, text)', 'execute') then
    raise exception 'authenticated no debe guardar tokens';
  end if;
  if has_function_privilege('authenticated', 'aml.usuario_por_correo(text)', 'execute') then
    raise exception 'authenticated no debe buscar usuarios por correo';
  end if;
end $$;

-- 4. Sin Vault, guardar el token falla con un mensaje claro
insert into aml.canales_whatsapp (organizacion_id, waba_id, phone_number_id, numero_visible, nombre_visible)
values ('00000000-0000-0000-0000-0000000000c3', 'WABA-C3', 'PNID-C3', '+502 5555 1111', 'Inmuebles Prueba');

do $$ begin
  begin
    perform aml.guardar_token_canal('00000000-0000-0000-0000-0000000000c3', repeat('t', 40));
    raise exception 'FALLO: se guardó sin Vault';
  exception when object_not_in_prerequisite_state then null;
  end;
end $$;

-- 5. Con Vault (simulado aquí): crea el secreto la primera vez y lo actualiza después
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text, description text);
create function vault.create_secret(s text, n text, d text) returns uuid language sql as
  $$ insert into vault.secrets (secret, name, description) values (s, n, d) returning id $$;
create function vault.update_secret(i uuid, s text) returns void language sql as
  $$ update vault.secrets set secret = s where id = i $$;

do $$ declare a uuid; b uuid; begin
  a := aml.guardar_token_canal('00000000-0000-0000-0000-0000000000c3', repeat('a', 40));
  b := aml.guardar_token_canal('00000000-0000-0000-0000-0000000000c3', repeat('b', 40));
  if a <> b then raise exception 'debe reutilizar el mismo secreto'; end if;
  if (select secret from vault.secrets where id = a) <> repeat('b', 40) then raise exception 'no actualizó el token'; end if;
  if (select token_secret_id from aml.canales_whatsapp where organizacion_id = '00000000-0000-0000-0000-0000000000c3') <> a then
    raise exception 'el canal no quedó vinculado al secreto';
  end if;
  begin
    perform aml.guardar_token_canal('00000000-0000-0000-0000-0000000000c3', 'corto');
    raise exception 'FALLO: aceptó un token inválido';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- 6. Sin esquema auth.users (local), la búsqueda por correo devuelve null
do $$ begin
  if aml.usuario_por_correo('x@example.com') is not null then raise exception 'debía ser null'; end if;
end $$;

select 'OK: 6 pruebas de la plataforma superadas' as resultado;
rollback;
