-- Integración aplicación ↔ base de datos.
--
-- Reproduce, con el MISMO rol y los MISMOS valores que envía el código
-- TypeScript, cada escritura y llamada RPC de un flujo real completo:
-- alta de organización → miembros → metodología aprobada → lista GAFI →
-- crear_operacion → enlace y código de WhatsApp → vinculación → datos del
-- cliente y de documentos → cotejo ONU (posible → alerta automática) →
-- disposición → evaluación → ajuste → decisión (titular y suplente) →
-- cierre de alerta → coincidencia confirmada → examen posterior →
-- cierre de operación → bitácora íntegra y ancla.
--
-- Roles:
--   service_role  = apps/flujos con db() (llave de servicio)
--   authenticated = apps/flujos con comoUsuario(c) (JWT del usuario)
-- Cada paso se ejecuta aislado; al final se listan los que fallaron.
--
-- Referencia de cada paso: archivo y función del código que lo emite.

begin;

create temp table resultados (n serial, paso text, ok boolean, detalle text);
create temp table ids (clave text primary key, valor uuid);
-- Los pasos leen ids con el rol que simulan; la tabla auxiliar no es parte del modelo.
grant select on ids to authenticated, service_role;

-- Organización y usuarios de prueba (ids fijos)
--   O  = a0000000-0000-0000-0000-000000000001
--   U1 = oficial titular, U2 = oficial suplente, U3 = ejecutivo, U4 = administrador

-- ---------------------------------------------------------------------------
-- 1. Alta de la organización (api-plataforma POST /organizaciones) · service_role
-- ---------------------------------------------------------------------------
do $$
begin
  perform set_config('role', 'service_role', true);
  insert into aml.organizaciones (id, nombre_legal, nombre_comercial, nit, actividad, inscripcion_ive, subdominio, marca)
  values ('a0000000-0000-0000-0000-000000000001', 'Inmuebles Integración, S.A.', 'Inmuebles Integración', '1234567-8',
          'inmobiliaria', 'IVE-0001', 'integracion',
          '{"nombre_visible":"Inmuebles Integración","color_primario":"#0f5e5a","logo_url":null}');
  insert into aml.configuraciones_riesgo (organizacion_id, version, parametros)
  values ('a0000000-0000-0000-0000-000000000001', 1,
    '{"version":1,"pesosFactores":{"cliente":0.4,"geografia":0.2,"canal":0.15,"producto":0.25},"umbrales":{"medio":30,"alto":55},"puntos":{},"paisesAltoRiesgoGafi":[],"paisesMonitoreoGafi":[],"departamentos":{},"actividades":{},"nivelMinimoPep":"alto","desviacionPrecio":0.3,"reventaRapidaDias":365,"sociedadRecienteMeses":12,"umbralEfectivoUsd":10000,"permitirSimplificada":true,"actualizacionMeses":{"bajo":36,"medio":24,"alto":12}}');
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('01 alta de organización y metodología v1 (api-plataforma)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('01 alta de organización y metodología v1 (api-plataforma)', false, sqlerrm);
end $$;

-- 2. Miembros (api-plataforma POST /organizaciones/:id/usuarios → upsert) · service_role
do $$
begin
  perform set_config('role', 'service_role', true);
  insert into aml.miembros (organizacion_id, usuario_id, rol, activo) values
    ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000011', 'oficial', true),
    ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000012', 'oficial_suplente', true),
    ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000013', 'ejecutivo', true),
    ('a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000014', 'administrador', true)
  on conflict (organizacion_id, usuario_id) do update set rol = excluded.rol, activo = excluded.activo;
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('02 miembros por upsert (api-plataforma)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('02 miembros por upsert (api-plataforma)', false, sqlerrm);
end $$;

-- 3. Aprobación de la metodología (api-plataforma .../metodologia/aprobar → update) · service_role
do $$
begin
  perform set_config('role', 'service_role', true);
  update aml.configuraciones_riesgo
     set aprobada_por = 'Consejo de Administración · Acta 15-2026, punto 4',
         aprobada_en = (now() at time zone 'America/Guatemala')::date, vigente_desde = now()
   where organizacion_id = 'a0000000-0000-0000-0000-000000000001' and version = 1;
  if not found then raise exception 'no se aprobó la versión 1'; end if;
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('03 aprobación de la metodología (api-plataforma)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('03 aprobación de la metodología (api-plataforma)', false, sqlerrm);
end $$;

-- 4. Canal de WhatsApp (api-plataforma guardarCanal: upsert pendiente → update activo) · service_role
do $$
begin
  perform set_config('role', 'service_role', true);
  insert into aml.canales_whatsapp (organizacion_id, waba_id, phone_number_id, numero_visible, nombre_visible, estado)
  values ('a0000000-0000-0000-0000-000000000001', '111', 'PNID-INT', '+502 5555 0000', 'Inmuebles Integración', 'pendiente')
  on conflict (organizacion_id) do update set waba_id = excluded.waba_id, estado = excluded.estado;
  update aml.canales_whatsapp set estado = 'activo' where organizacion_id = 'a0000000-0000-0000-0000-000000000001';
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('04 canal de WhatsApp (api-plataforma)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('04 canal de WhatsApp (api-plataforma)', false, sqlerrm);
end $$;

-- 5. Lista GAFI (api-consola POST /plataforma/listas-gafi) · service_role
do $$
begin
  perform set_config('role', 'service_role', true);
  insert into aml.listas_gafi (plenario, alto_riesgo, monitoreo, fuente_alto_riesgo, fuente_monitoreo, cargada_por)
  values ('2026-10-30', '{KP,IR,MM}', '{CC}', 'https://www.fatf-gafi.org/a', 'https://www.fatf-gafi.org/b', 'admin@plataforma.example');
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('05 lista GAFI (api-consola)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('05 lista GAFI (api-consola)', false, sqlerrm);
end $$;

-- 6. Lista ONU (funciones/cotejo-onu lista-onu-diaria: upsert versión en 1970, upsert registros, update cargada_en) · service_role
do $$
begin
  perform set_config('role', 'service_role', true);
  insert into aml.lista_onu_versiones (sha256, generada_el, registros, cargada_en)
  values (repeat('c', 64), '2026-11-16', 1, '1970-01-01T00:00:00Z')
  on conflict (sha256) do update set generada_el = excluded.generada_el, registros = excluded.registros, cargada_en = excluded.cargada_en;
  insert into aml.lista_onu_registros (referencia, tipo, datos, version_sha256, actualizado_en)
  values ('XXi.001', 'individual', '{"referencia":"XXi.001","nombre":"Persona Ficticia"}', repeat('c', 64), now())
  on conflict (referencia) do update set datos = excluded.datos, version_sha256 = excluded.version_sha256;
  update aml.lista_onu_versiones set cargada_en = now() where sha256 = repeat('c', 64);
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('06 carga de la lista ONU (cotejo-onu)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('06 carga de la lista ONU (cotejo-onu)', false, sqlerrm);
end $$;

-- 7. Registrar operación (api-operaciones POST /operaciones → rpc crear_operacion como usuario) · authenticated (ejecutivo)
do $$
declare r record;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000013', true);
  for r in select * from aml.crear_operacion('a0000000-0000-0000-0000-000000000001', 'compraventa',
      '{"departamento":"Guatemala","municipio":"Guatemala","finca":"1"}', 1540000, 'GTQ',
      '[{"medio":"transferencia_local","monto":1540000,"pagador":"cliente"}]',
      '[{"parte":"comprador","tipo_persona":"individual","contacto_nombre":"Ana Prueba Uno","contacto_telefono":"+50255550101"},
        {"parte":"vendedor","tipo_persona":"individual","contacto_nombre":"Luis Prueba Dos","contacto_correo":"luis@example.com"}]') loop
    perform set_config('role', 'postgres', true);
    insert into ids values ('exp_' || r.parte, r.expediente_id), ('operacion', r.operacion_id) on conflict (clave) do nothing;
    perform set_config('role', 'authenticated', true);
  end loop;
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('07 crear_operacion como ejecutivo (api-operaciones)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('07 crear_operacion como ejecutivo (api-operaciones)', false, sqlerrm);
end $$;

-- 8. Valor de referencia (api-operaciones: update operaciones) · service_role
do $$
declare v uuid := (select valor from ids where clave = 'operacion');
begin
  perform set_config('role', 'service_role', true);
  update aml.operaciones set valor_referencia = 1500000 where id = v;
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('08 valor de referencia (api-operaciones)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('08 valor de referencia (api-operaciones)', false, sqlerrm);
end $$;

-- 9. Enlace y mensaje de bienvenida (funciones/expediente-creado y reenviar-enlace) · service_role
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador');
begin
  perform set_config('role', 'service_role', true);
  update aml.expedientes set enlace_token_hash = encode(digest('token-comprador', 'sha256'), 'hex'),
                             enlace_expira_en = now() + interval '7 days'
   where id = v;
  insert into aml.mensajes (organizacion_id, expediente_id, direccion, wa_id, wa_message_id, tipo, plantilla)
  values ('a0000000-0000-0000-0000-000000000001', v, 'saliente', '50255550101', 'wamid.bienvenida', 'template', 'bienvenida');
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('09 enlace y plantilla de bienvenida (expediente-creado)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('09 enlace y plantilla de bienvenida (expediente-creado)', false, sqlerrm);
end $$;

-- 10. Portal: buscar por enlace (api-portal buscarPorEnlace → rpc expediente_por_enlace) · service_role
do $$
declare f record;
begin
  perform set_config('role', 'service_role', true);
  select * into f from aml.expediente_por_enlace(encode(digest('token-comprador', 'sha256'), 'hex'));
  perform set_config('role', 'postgres', true);
  if f.expediente_id is null or not f.vigente then raise exception 'no encontró el expediente por enlace'; end if;
  if f.estado <> 'invitado' then raise exception 'estado comercial inesperado: %', f.estado; end if;
  insert into resultados (paso, ok) values ('10 expediente_por_enlace devuelve estado comercial (api-portal)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('10 expediente_por_enlace devuelve estado comercial (api-portal)', false, sqlerrm);
end $$;

-- 11. Portal: código de WhatsApp (api-portal POST /codigo-whatsapp → guardarCodigoWhatsapp) · service_role
--     y vinculación por WhatsApp (funciones/whatsapp-entrante → rpc vincular_whatsapp) · service_role
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador'); vinculado uuid;
begin
  perform set_config('role', 'service_role', true);
  perform aml.fijar_codigo_vinculacion(v, '482913', 30);
  vinculado := aml.vincular_whatsapp('PNID-INT', '50255550101', '482913');
  perform set_config('role', 'postgres', true);
  if vinculado is distinct from v then raise exception 'el código guardado por el portal no vincula el número (devolvió %)', vinculado; end if;
  insert into resultados (paso, ok) values ('11 código del portal y vinculación de WhatsApp (api-portal + whatsapp-entrante)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('11 código del portal y vinculación de WhatsApp (api-portal + whatsapp-entrante)', false, sqlerrm);
end $$;

-- 12. Mensajes entrantes y salientes (whatsapp-entrante upsert/update/insert; api-portal canal web) · service_role
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador');
begin
  perform set_config('role', 'service_role', true);
  insert into aml.mensajes (organizacion_id, expediente_id, direccion, wa_id, wa_message_id, tipo, texto, recibido_en)
  values ('a0000000-0000-0000-0000-000000000001', v, 'entrante', '50255550101', 'wamid.1', 'text', 'Hola', now())
  on conflict (wa_message_id) do nothing;
  update aml.mensajes set procesado_en = now() where wa_message_id = 'wamid.1';
  insert into aml.mensajes (organizacion_id, expediente_id, direccion, wa_id, wa_message_id, tipo, texto)
  values ('a0000000-0000-0000-0000-000000000001', v, 'saliente', '50255550101', 'wamid.2', 'text', 'Recibido.');
  insert into aml.mensajes (organizacion_id, expediente_id, direccion, canal, tipo, texto, procesado_en)
  values ('a0000000-0000-0000-0000-000000000001', v, 'entrante', 'web', 'text', 'Hola desde el portal', null);
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('12 mensajes WhatsApp y web (whatsapp-entrante, api-portal)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('12 mensajes WhatsApp y web (whatsapp-entrante, api-portal)', false, sqlerrm);
end $$;

-- 13. Documento recibido y leído (documentos-entrantes) · service_role
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador'); d uuid;
begin
  perform set_config('role', 'service_role', true);
  insert into aml.documentos (organizacion_id, expediente_id, tipo, ruta_storage, sha256, mime, tamano_bytes, canal)
  values ('a0000000-0000-0000-0000-000000000001', v, 'dpi', 'org/exp/x.jpg', repeat('d', 64), 'image/jpeg', 2048, 'whatsapp')
  returning id into d;
  perform aml.guardar_dato(v, 'doc.dpi.nombre_completo', '"ANA PRUEBA UNO"', 'documento', d, 1, 0.97, null);
  perform aml.guardar_dato(v, 'doc.dpi.cui', '"2345678900101"', 'documento', d, 1, 0.95, null);
  perform aml.guardar_dato(v, 'cliente.nombre_completo', '"ANA PRUEBA UNO"', 'documento', d, 1, 0.97, null);
  update aml.documentos set estado = 'extraido' where id = d;
  perform set_config('role', 'postgres', true);
  insert into ids values ('doc_dpi', d);
  insert into resultados (paso, ok) values ('13 documento, datos leídos y prellenado (documentos-entrantes)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('13 documento, datos leídos y prellenado (documentos-entrantes)', false, sqlerrm);
end $$;

-- 14. Respuestas y confirmaciones del cliente (repositorio crearPuerto: guardar_dato, confirmar_dato) · service_role
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador');
begin
  perform set_config('role', 'service_role', true);
  perform aml.guardar_dato(v, 'cliente.estado_civil', '"casado"', 'cliente', null, null, null, 'cliente');
  perform aml.guardar_dato(v, 'origen_fondos.descripcion', '"Ahorros y préstamo bancario"', 'cliente', null, null, null, 'cliente');
  if not aml.confirmar_dato(v, 'cliente.nombre_completo', 'cliente') then raise exception 'no confirmó el nombre'; end if;
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('14 datos y confirmación del cliente (repositorio)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('14 datos y confirmación del cliente (repositorio)', false, sqlerrm);
end $$;

-- 15. Personas relacionadas (repositorio sincronizarPersonasRelacionadas) · service_role
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador'); p uuid;
begin
  perform set_config('role', 'service_role', true);
  insert into aml.personas_relacionadas (organizacion_id, expediente_id, rol, tipo_persona, nombre, identificacion_num, porcentaje, controla_por_otro_medio)
  values ('a0000000-0000-0000-0000-000000000001', v, 'representante', 'individual', 'Representante Ficticio', '1111', null, false)
  returning id into p;
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('15 personas relacionadas (repositorio)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('15 personas relacionadas (repositorio)', false, sqlerrm);
end $$;

-- 16. Pendientes (repositorio sincronizarPendientes: update resuelto, insert) · service_role
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador'); p uuid;
begin
  perform set_config('role', 'service_role', true);
  insert into aml.pendientes (organizacion_id, expediente_id, tipo, descripcion)
  values ('a0000000-0000-0000-0000-000000000001', v, 'faltante', 'Recibo de agua, luz o teléfono reciente') returning id into p;
  update aml.pendientes set estado = 'resuelto', resuelto_en = now() where id in (p);
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('16 pendientes (repositorio)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('16 pendientes (repositorio)', false, sqlerrm);
end $$;

-- 17. Enviar a revisión (repositorio enviarARevision: update estado) · service_role
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador');
begin
  perform set_config('role', 'service_role', true);
  update aml.expedientes set estado = 'en_revision' where id = v;
  perform set_config('role', 'postgres', true);
  if (select estado_comercial from aml.expedientes where id = v) <> 'en_revision' then raise exception 'estado comercial no avanzó'; end if;
  insert into resultados (paso, ok) values ('17 enviar a revisión (repositorio)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('17 enviar a revisión (repositorio)', false, sqlerrm);
end $$;

-- 18. Cotejo ONU con posible coincidencia (cotejo-onu registrarResultado) · service_role
--     verificación .select('id').single() → alerta ONU_POSIBLE: la app la obtiene con .select('id').single()
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador'); ver uuid; al uuid; n integer;
begin
  perform set_config('role', 'service_role', true);
  insert into aml.verificaciones (organizacion_id, expediente_id, persona_relacionada_id, nombre_consultado, fuente,
                                  version_fuente, consultado_en, resultado, coincidencias)
  values ('a0000000-0000-0000-0000-000000000001', v, null, 'ANA PRUEBA UNO', 'onu', repeat('c', 64), now(),
          'posible_coincidencia', '[{"referencia":"XXi.001","puntaje":0.91}]')
  returning id into ver;
  -- Equivalente a la llamada de la aplicación para obtener la alerta del plazo de 24 horas
  select count(*), min(a.id::text)::uuid into n, al from aml.alertas a
   where a.expediente_id = v and a.senal = 'ONU_POSIBLE' and a.evidencia->>'verificacionId' = ver::text and a.estado <> 'cerrada';
  perform set_config('role', 'postgres', true);
  if n <> 1 then raise exception 'se esperaba exactamente una alerta ONU_POSIBLE (.single()), hay %', n; end if;
  if (select vence_en from aml.alertas where id = al) <> (select consultado_en from aml.verificaciones where id = ver) + interval '24 hours' then
    raise exception 'el vencimiento no es 24 h desde la detección';
  end if;
  insert into ids values ('ver_posible', ver), ('alerta_posible', al);
  insert into resultados (paso, ok) values ('18 cotejo ONU y alerta de 24 h desde la detección (cotejo-onu)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('18 cotejo ONU y alerta de 24 h desde la detección (cotejo-onu)', false, sqlerrm);
end $$;

-- 19. Disponer: descartar (api-consola POST /verificaciones/:id/disponer → rpc disponer_verificacion) · authenticated (oficial)
do $$
declare ver uuid := (select valor from ids where clave = 'ver_posible'); r record;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000011', true);
  select * into r from aml.disponer_verificacion(ver, 'descartada', 'Fecha de nacimiento y nacionalidad distintas a las del listado.');
  perform set_config('role', 'postgres', true);
  if r.verificacion_id is distinct from ver then raise exception 'la función no devolvió la verificación'; end if;
  if (select estado from aml.alertas where id = (select valor from ids where clave = 'alerta_posible')) <> 'cerrada' then
    raise exception 'la alerta de la posible coincidencia no se cerró al descartar';
  end if;
  insert into resultados (paso, ok) values ('19 descartar coincidencia como oficial (api-consola)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('19 descartar coincidencia como oficial (api-consola)', false, sqlerrm);
end $$;

-- 20. Plazo de la posible coincidencia: cierre redundante (plazos posibleCoincidencia) · service_role
do $$
declare al uuid := (select valor from ids where clave = 'alerta_posible');
begin
  perform set_config('role', 'service_role', true);
  update aml.alertas set estado = 'cerrada', cierre = 'Coincidencia descartada por el oficial de cumplimiento (ver la justificación en la verificación).', cerrada_en = now()
   where id = al and estado <> 'cerrada';
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('20 cierre de alerta por el flujo de plazos, ya cerrada (plazos)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('20 cierre de alerta por el flujo de plazos, ya cerrada (plazos)', false, sqlerrm);
end $$;

-- 21. Evaluación (api-consola POST /expedientes/:id/evaluar) · service_role
--     asegurarCliente: select/insert clientes, update expedientes.cliente_id; insert evaluación; insert alertas de señales
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador'); c uuid; ev uuid; cfg uuid;
begin
  perform set_config('role', 'service_role', true);
  select id into cfg from aml.configuraciones_riesgo
   where organizacion_id = 'a0000000-0000-0000-0000-000000000001' and aprobada_en is not null order by version desc limit 1;
  insert into aml.clientes (organizacion_id, tipo_persona, nombre, identificacion_tipo, identificacion_num, datos)
  values ('a0000000-0000-0000-0000-000000000001', 'individual', 'ANA PRUEBA UNO', 'DPI', '2345678900101', '{}') returning id into c;
  update aml.expedientes set cliente_id = c where id = v;
  insert into aml.evaluaciones_riesgo (organizacion_id, expediente_id, configuracion_id, entrada, puntajes, puntaje_total,
                                       nivel_calculado, medidas, reglas_impuestas, senales)
  values ('a0000000-0000-0000-0000-000000000001', v, cfg,
          '{"perfil":{},"ajustes":{},"listaGafi":"2026-10-30","evaluadoPor":"b0000000-0000-0000-0000-000000000011"}',
          '{"cliente":10,"geografia":0,"canal":35,"producto":15}', 13, 'bajo', 'estandar', '[]',
          '[{"codigo":"PAGO_TERCEROS","descripcion":"Pago de terceros"}]')
  returning id into ev;
  insert into aml.alertas (organizacion_id, expediente_id, senal, descripcion, evidencia)
  values ('a0000000-0000-0000-0000-000000000001', v, 'PAGO_TERCEROS', 'Uno o más pagos los realiza un tercero distinto del cliente', '{}');
  perform set_config('role', 'postgres', true);
  insert into ids values ('cliente', c), ('evaluacion', ev);
  insert into resultados (paso, ok) values ('21 evaluación, cliente y alertas de señales (api-consola)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('21 evaluación, cliente y alertas de señales (api-consola)', false, sqlerrm);
end $$;

-- 22. Ajuste del nivel (api-consola POST /evaluaciones/:id/ajustar → rpc ajustar_nivel_evaluacion) · authenticated (oficial)
do $$
declare ev uuid := (select valor from ids where clave = 'evaluacion');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000011', true);
  perform aml.ajustar_nivel_evaluacion(ev, 'medio', 'Perfil económico declarado requiere seguimiento adicional.');
  perform set_config('role', 'postgres', true);
  if (select nivel_ajustado from aml.evaluaciones_riesgo where id = ev) <> 'medio' then raise exception 'no se ajustó'; end if;
  insert into resultados (paso, ok) values ('22 ajuste de nivel como oficial (api-consola)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('22 ajuste de nivel como oficial (api-consola)', false, sqlerrm);
end $$;

-- 23. Cerrar la alerta de la señal (api-consola POST /alertas/:id/cerrar → rpc cerrar_alerta) · authenticated (oficial)
do $$
declare al uuid := (select id from aml.alertas where senal = 'PAGO_TERCEROS' and expediente_id = (select valor from ids where clave = 'exp_comprador'));
        r record;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000011', true);
  select * into r from aml.cerrar_alerta(al, 'El pago lo hace el cónyuge con cuenta propia; se identificó y documentó.');
  perform set_config('role', 'postgres', true);
  if (select estado from aml.alertas where id = al) <> 'cerrada' then raise exception 'la alerta no quedó cerrada'; end if;
  insert into resultados (paso, ok) values ('23 cerrar alerta como oficial (api-consola)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('23 cerrar alerta como oficial (api-consola)', false, sqlerrm);
end $$;

-- 24. Decisión del SUPLENTE con motivo (api-consola POST /expedientes/:id/decidir → insert decisiones como usuario) · authenticated
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000012', true);
  insert into aml.decisiones (organizacion_id, expediente_id, evaluacion_id, tipo, condiciones, verificacion_diferida_hasta,
                              justificacion, decidido_por, motivo_suplencia)
  values ('a0000000-0000-0000-0000-000000000001', v, (select valor from ids where clave = 'evaluacion'), 'aprobar', null, null,
          'Debida diligencia completa, coincidencia descartada y riesgo aceptable.', 'b0000000-0000-0000-0000-000000000012',
          'Titular de vacaciones del 15 al 30 de noviembre.');
  perform set_config('role', 'postgres', true);
  if (select estado from aml.expedientes where id = v) <> 'aprobado' then raise exception 'la decisión no aprobó'; end if;
  insert into resultados (paso, ok) values ('24 decisión del suplente con motivo (api-consola)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('24 decisión del suplente con motivo (api-consola)', false, sqlerrm);
end $$;

-- 25. Nivel y próxima actualización del cliente (api-consola decidir → update clientes) · service_role
do $$
declare c uuid := (select valor from ids where clave = 'cliente');
begin
  perform set_config('role', 'service_role', true);
  update aml.clientes set nivel_riesgo = 'medio', proxima_actualizacion = current_date + 730 where id = c;
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('25 nivel del cliente tras aprobar (api-consola)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('25 nivel del cliente tras aprobar (api-consola)', false, sqlerrm);
end $$;

-- 26. Examen posterior a la aprobación (decisión abrir_examen del titular) · authenticated
--     y lo que ven el portal (expediente_por_enlace) y el ejecutivo (operaciones_comercial)
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador'); estado_portal text; estado_ejecutivo text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000011', true);
  insert into aml.decisiones (organizacion_id, expediente_id, tipo, justificacion, decidido_por)
  values ('a0000000-0000-0000-0000-000000000001', v, 'abrir_examen', 'Transferencia posterior desde jurisdicción sin relación aparente.',
          'b0000000-0000-0000-0000-000000000011');
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000013', true);
  select estado into estado_ejecutivo from aml.operaciones_comercial where expediente_id = v;
  perform set_config('role', 'service_role', true);
  select estado into estado_portal from aml.expediente_por_enlace(encode(digest('token-comprador', 'sha256'), 'hex'));
  perform set_config('role', 'postgres', true);
  if estado_portal <> 'aprobado' or estado_ejecutivo <> 'aprobado' then
    raise exception 'el examen se nota: portal=% ejecutivo=%', estado_portal, estado_ejecutivo;
  end if;
  insert into resultados (paso, ok) values ('26 examen posterior no cambia lo visible (art. 38)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('26 examen posterior no cambia lo visible (art. 38)', false, sqlerrm);
end $$;

-- 27. Coincidencia CONFIRMADA en el vendedor y alerta del art. 43 (plazos plazoOnu24h) · authenticated + service_role
do $$
declare v uuid := (select valor from ids where clave = 'exp_vendedor'); ver uuid; al uuid; n integer; detectada timestamptz;
begin
  perform set_config('role', 'service_role', true);
  insert into aml.verificaciones (organizacion_id, expediente_id, nombre_consultado, fuente, version_fuente, consultado_en, resultado, coincidencias)
  values ('a0000000-0000-0000-0000-000000000001', v, 'Luis Prueba Dos', 'onu', repeat('c', 64), now() - interval '3 hours',
          'posible_coincidencia', '[{"referencia":"XXi.001","puntaje":0.99}]')
  returning id, consultado_en into ver, detectada;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000011', true);
  perform aml.disponer_verificacion(ver, 'coincidencia_confirmada', 'Nombre, fecha de nacimiento y documento coinciden con el listado.');
  perform set_config('role', 'service_role', true);
  -- plazoOnu24h: obtiene la alerta ONU_CONFIRMADA (la crea la base al confirmar) y toma su vence_en
  select count(*), min(a.id::text)::uuid into n, al from aml.alertas a
   where a.expediente_id = v and a.senal = 'ONU_CONFIRMADA' and a.evidencia->>'verificacionId' = ver::text and a.estado <> 'cerrada';
  -- constancia de vencimiento (solo evidencia)
  update aml.alertas set evidencia = evidencia || jsonb_build_object('plazoVencido', now()) where id = al;
  perform set_config('role', 'postgres', true);
  if n <> 1 then raise exception 'se esperaba una alerta ONU_CONFIRMADA, hay %', n; end if;
  if (select vence_en from aml.alertas where id = al) <> detectada + interval '24 hours' then
    raise exception 'el vencimiento no se cuenta desde la detección';
  end if;
  if (select estado_comercial from aml.expedientes where id = v) not in ('invitado', 'en_captura', 'en_revision') then
    raise exception 'la confirmación cambió el estado comercial';
  end if;
  insert into resultados (paso, ok) values ('27 coincidencia confirmada y plazo de 24 h desde la detección (plazos)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('27 coincidencia confirmada y plazo de 24 h desde la detección (plazos)', false, sqlerrm);
end $$;

-- 28. Efectivo y cierre de la operación (api-operaciones) · authenticated (ejecutivo)
do $$
declare v uuid := (select valor from ids where clave = 'exp_comprador'); op uuid := (select valor from ids where clave = 'operacion');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000013', true);
  insert into aml.pagos_efectivo (organizacion_id, operacion_id, expediente_id, cliente_id, fecha, monto, moneda, tipo_cambio_usd, registrado_por)
  values ('a0000000-0000-0000-0000-000000000001', op, v, (select valor from ids where clave = 'cliente'), current_date, 40000, 'GTQ', 7.70,
          'b0000000-0000-0000-0000-000000000013');
  perform aml.cerrar_operacion(op, 'cerrada');
  perform set_config('role', 'postgres', true);
  if (select fin_relacion from aml.expedientes where id = v) is null then raise exception 'no se fijó fin_relacion'; end if;
  insert into resultados (paso, ok) values ('28 efectivo y cierre de la operación como ejecutivo (api-operaciones)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('28 efectivo y cierre de la operación como ejecutivo (api-operaciones)', false, sqlerrm);
end $$;

-- 29. Avisos y notificaciones (datos.notificar, gafi, cotejo-onu) · service_role
do $$
begin
  perform set_config('role', 'service_role', true);
  insert into aml.notificaciones (organizacion_id, destinatario_rol, expediente_id, prioridad, asunto, cuerpo)
  values ('a0000000-0000-0000-0000-000000000001', 'cumplimiento', (select valor from ids where clave = 'exp_comprador'), 'alta', 'x', 'y');
  insert into aml.avisos_plataforma (asunto, cuerpo) values ('Cargar listas del GAFI', 'Prueba');
  update aml.avisos_plataforma set atendido_en = now() where asunto = 'Cargar listas del GAFI';
  perform set_config('role', 'postgres', true);
  insert into resultados (paso, ok) values ('29 notificaciones y avisos (datos, gafi, api-plataforma)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('29 notificaciones y avisos (datos, gafi, api-plataforma)', false, sqlerrm);
end $$;

-- 30. Actor en la bitácora para escrituras del servidor (cabecera x-aml-actor) · service_role
do $$
declare v uuid := (select valor from ids where clave = 'exp_vendedor'); b record;
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.headers', '{"x-aml-actor-tipo":"cliente","x-aml-actor-id":"expediente:portal"}', true);
  insert into aml.pendientes (organizacion_id, expediente_id, tipo, descripcion)
  values ('a0000000-0000-0000-0000-000000000001', v, 'aclaracion', 'Indique su relación con el propietario registral.');
  perform set_config('request.headers', '', true);
  perform set_config('role', 'postgres', true);
  select actor_tipo, actor_id into b from aml.bitacora where entidad = 'pendientes' order by secuencia desc, id desc limit 1;
  if b.actor_tipo <> 'cliente' or b.actor_id <> 'expediente:portal' then
    raise exception 'actor registrado: % / %', b.actor_tipo, b.actor_id;
  end if;
  insert into resultados (paso, ok) values ('30 actor de la bitácora desde el servidor (cabecera x-aml-actor)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('30 actor de la bitácora desde el servidor (cabecera x-aml-actor)', false, sqlerrm);
end $$;

-- 31. Ancla de la bitácora (funciones/ancla-bitacora) · service_role
do $$
declare e record; ok boolean;
begin
  perform set_config('role', 'service_role', true);
  select * into e from aml.ultimo_eslabon_bitacora('a0000000-0000-0000-0000-000000000001');
  insert into aml.anclas_bitacora (organizacion_id, secuencia, hash) values ('a0000000-0000-0000-0000-000000000001', e.secuencia, e.hash);
  ok := aml.verificar_ancla_bitacora('a0000000-0000-0000-0000-000000000001', e.secuencia, e.hash);
  perform set_config('role', 'postgres', true);
  if not ok then raise exception 'el ancla no verificó'; end if;
  if exists (select 1 from aml.verificar_bitacora('a0000000-0000-0000-0000-000000000001')) then raise exception 'cadena alterada'; end if;
  insert into resultados (paso, ok) values ('31 ancla de la bitácora (ancla-bitacora)', true);
exception when others then
  insert into resultados (paso, ok, detalle) values ('31 ancla de la bitácora (ancla-bitacora)', false, sqlerrm);
end $$;

-- 32. Protecciones que la integración NO debe abrir (art. 38 y C2)
do $$
declare v uuid := (select valor from ids where clave = 'exp_vendedor'); n integer;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000013', true);
  -- el ejecutivo no puede disponer, cerrar alertas ni ajustar
  begin
    perform aml.disponer_verificacion((select id from aml.verificaciones where expediente_id = v limit 1), 'descartada', 'Intento del ejecutivo de descartar la coincidencia.');
    raise exception 'FALLO: el ejecutivo dispuso una verificación';
  exception when insufficient_privilege then null;
  end;
  begin
    perform aml.cerrar_alerta((select id from aml.alertas where expediente_id = v and estado <> 'cerrada' limit 1), 'Intento del ejecutivo de cerrar la alerta.');
    raise exception 'FALLO: el ejecutivo cerró una alerta';
  exception when insufficient_privilege then null;
  end;
  begin
    perform aml.ajustar_nivel_evaluacion((select valor from ids where clave = 'evaluacion'), 'bajo', 'Intento del ejecutivo de ajustar el nivel.');
    raise exception 'FALLO: el ejecutivo ajustó una evaluación';
  exception when insufficient_privilege then null;
  end;
  -- ni modificar directamente lo que antes era un UPDATE de columna
  begin
    update aml.alertas set estado = 'cerrada', cierre = 'Intento directo del ejecutivo de cerrar.' where expediente_id = v;
    raise exception 'FALLO: UPDATE directo sobre alertas permitido';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from aml.anclas_bitacora;
  raise exception 'FALLO: el ejecutivo lee las anclas (%)', n;
exception
  when insufficient_privilege then
    perform set_config('role', 'postgres', true);
    insert into resultados (paso, ok) values ('32 protecciones de rol en funciones nuevas', true);
  when others then
    insert into resultados (paso, ok, detalle) values ('32 protecciones de rol en funciones nuevas', false, sqlerrm);
end $$;

-- Resultado
do $$
declare fallos text;
begin
  select string_agg(paso || ' → ' || coalesce(detalle, ''), E'\n' order by n) into fallos from resultados where not ok;
  if fallos is not null then
    raise exception E'Pasos de integración que fallan:\n%', fallos;
  end if;
end $$;

select format('OK: %s pasos de integración aplicación-base superados', count(*)) as resultado from resultados;
rollback;
