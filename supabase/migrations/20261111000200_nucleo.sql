-- Agente AML · Fase 1 · Tablas del núcleo
-- Todas las tablas de negocio llevan organizacion_id. Las llaves foráneas
-- compuestas (organizacion_id, id) impiden mezclar datos entre organizaciones.

-- ---------------------------------------------------------------------------
-- Organizaciones (sujetos obligados) y su marca
-- ---------------------------------------------------------------------------
create table aml.organizaciones (
  id                uuid primary key default gen_random_uuid(),
  nombre_legal      text not null,
  nombre_comercial  text not null,
  nit               text not null,
  actividad         aml.actividad_po not null default 'inmobiliaria',
  inscripcion_ive   text,                         -- art. 5; null = pendiente
  subdominio        text not null unique
                    check (subdominio ~ '^[a-z0-9]([a-z0-9-]{1,40}[a-z0-9])$'),
  marca             jsonb not null default '{}'::jsonb,  -- logo_url, colores, nombre_visible
  creado_en         timestamptz not null default now()
);

-- Un número de WhatsApp por sujeto obligado (decisión 11/11/2026).
-- El token de acceso se guarda en Supabase Vault; aquí solo su referencia.
create table aml.canales_whatsapp (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null unique references aml.organizaciones(id) on delete restrict,
  waba_id           text not null,
  phone_number_id   text not null unique,         -- enruta los mensajes entrantes
  numero_visible    text not null,
  nombre_visible    text not null,
  token_secret_id   uuid,                         -- vault.secrets.id
  estado            aml.estado_canal not null default 'pendiente',
  creado_en         timestamptz not null default now()
);

-- Usuarios de la consola por organización. usuario_id = auth.users.id
create table aml.miembros (
  organizacion_id   uuid not null references aml.organizaciones(id) on delete restrict,
  usuario_id        uuid not null,
  rol               aml.rol_usuario not null,
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  primary key (organizacion_id, usuario_id)
);

-- Metodología de riesgo aprobada por el órgano de dirección (art. 8).
-- Versionada: cada evaluación guarda la versión con que se calculó.
create table aml.configuraciones_riesgo (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references aml.organizaciones(id) on delete restrict,
  version           integer not null check (version > 0),
  parametros        jsonb not null,
  aprobada_por      text,                         -- órgano o persona que aprobó
  aprobada_en       date,
  vigente_desde     timestamptz,
  creado_en         timestamptz not null default now(),
  unique (organizacion_id, version),
  unique (organizacion_id, id)
);

-- ---------------------------------------------------------------------------
-- Operaciones, clientes y expedientes
-- ---------------------------------------------------------------------------
create table aml.contadores (
  organizacion_id   uuid not null references aml.organizaciones(id) on delete restrict,
  anio              integer not null,
  ultimo            integer not null default 0,
  primary key (organizacion_id, anio)
);

create table aml.operaciones (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references aml.organizaciones(id) on delete restrict,
  codigo            text not null,                -- OP-2026-00001, por organización
  tipo              aml.tipo_operacion not null,
  inmueble          jsonb not null default '{}'::jsonb, -- finca, folio, libro, departamento, municipio, direccion
  precio            numeric(16,2) check (precio is null or precio > 0),
  moneda            char(3) not null default 'GTQ',
  valor_referencia  numeric(16,2) check (valor_referencia is null or valor_referencia > 0),
  forma_pago        jsonb not null default '[]'::jsonb, -- [{medio, monto, moneda, pagador}]
  estado            aml.estado_operacion not null default 'abierta',
  creada_por        uuid,
  creado_en         timestamptz not null default now(),
  cerrada_en        timestamptz,
  unique (organizacion_id, codigo),
  unique (organizacion_id, id)
);

create table aml.clientes (
  id                   uuid primary key default gen_random_uuid(),
  organizacion_id      uuid not null references aml.organizaciones(id) on delete restrict,
  tipo_persona         aml.tipo_persona not null,
  nombre               text not null,             -- nombre completo o razón social
  identificacion_tipo  text not null,             -- DPI, pasaporte, NIT, registro mercantil
  identificacion_num   text not null,
  nacionalidad         char(2),                   -- ISO 3166-1 alfa-2
  pais_residencia      char(2),
  datos                jsonb not null default '{}'::jsonb, -- campos art. 42 b y demás
  nivel_riesgo         aml.nivel_riesgo,          -- último nivel aprobado
  proxima_actualizacion date,                      -- art. 22: alto riesgo, al menos anual
  creado_en            timestamptz not null default now(),
  unique (organizacion_id, identificacion_tipo, identificacion_num),
  unique (organizacion_id, id)
);

create table aml.expedientes (
  id                        uuid primary key default gen_random_uuid(),
  organizacion_id           uuid not null,
  operacion_id              uuid not null,
  cliente_id                uuid,                 -- se vincula al identificar al cliente
  parte                     aml.parte_operacion not null,
  estado                    aml.estado_expediente not null default 'invitado',
  requiere_origen_fondos    boolean generated always as (parte = 'comprador') stored,
  -- Enlace seguro: solo se guarda el hash del token
  enlace_token_hash         text unique,
  enlace_expira_en          timestamptz,
  contacto_nombre           text not null,
  contacto_telefono         text,                 -- E.164
  contacto_correo           text,
  whatsapp_wa_id            text,                 -- número vinculado con código
  whatsapp_vinculado_en     timestamptz,
  verificacion_diferida_hasta date,
  fin_relacion              date,                 -- art. 34: inicio del plazo de conservación
  conservar_hasta           date generated always as ((fin_relacion + interval '5 years')::date) stored,
  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),
  foreign key (organizacion_id, operacion_id) references aml.operaciones(organizacion_id, id) on delete restrict,
  foreign key (organizacion_id, cliente_id) references aml.clientes(organizacion_id, id) on delete restrict,
  unique (operacion_id, parte, cliente_id),
  unique (organizacion_id, id),
  -- Art. 22: la verificación diferida no puede exceder 3 meses desde el inicio
  constraint verificacion_diferida_max_3_meses check (
    verificacion_diferida_hasta is null
    or verificacion_diferida_hasta <= ((creado_en at time zone 'America/Guatemala') + interval '3 months')::date
  ),
  constraint contacto_requerido check (contacto_telefono is not null or contacto_correo is not null)
);

create table aml.personas_relacionadas (
  id                   uuid primary key default gen_random_uuid(),
  organizacion_id      uuid not null,
  expediente_id        uuid not null,
  rol                  aml.rol_relacionado not null,
  tipo_persona         aml.tipo_persona not null default 'individual',
  nombre               text not null,
  identificacion_tipo  text,
  identificacion_num   text,
  nacionalidad         char(2),
  porcentaje           numeric(5,2) check (porcentaje is null or (porcentaje >= 0 and porcentaje <= 100)),
  controla_por_otro_medio boolean not null default false,
  datos                jsonb not null default '{}'::jsonb,
  creado_en            timestamptz not null default now(),
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict,
  unique (organizacion_id, id),
  -- Art. 2 b: beneficiario final = 15 % o más, o control por otro medio
  constraint beneficiario_final_valido check (
    rol <> 'beneficiario_final' or porcentaje >= 15 or controla_por_otro_medio
  )
);

create table aml.documentos (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null,
  expediente_id     uuid not null,
  persona_relacionada_id uuid,
  tipo              text not null,                -- dpi, pasaporte, patente, escritura, nombramiento, rtu, ...
  ruta_storage      text not null,
  sha256            char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
  mime              text not null,
  tamano_bytes      bigint not null check (tamano_bytes > 0),
  canal             aml.canal not null,
  vence_en          date,
  estado            aml.estado_documento not null default 'recibido',
  creado_en         timestamptz not null default now(),
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict,
  foreign key (organizacion_id, persona_relacionada_id) references aml.personas_relacionadas(organizacion_id, id) on delete restrict,
  unique (organizacion_id, id),
  unique (expediente_id, sha256)
);

-- Cada dato del expediente con su procedencia. Un solo valor vigente por campo.
create table aml.datos_expediente (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null,
  expediente_id     uuid not null,
  campo             text not null,                -- p. ej. 'cliente.nombre', 'origen_fondos.descripcion'
  valor             jsonb not null,
  origen            aml.origen_dato not null,
  documento_id      uuid,
  pagina            integer check (pagina is null or pagina > 0),
  confianza         numeric(4,3) check (confianza is null or (confianza >= 0 and confianza <= 1)),
  confirmado_por    text,                         -- 'cliente' o id de usuario
  confirmado_en     timestamptz,
  vigente           boolean not null default true,
  creado_en         timestamptz not null default now(),
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict,
  foreign key (organizacion_id, documento_id) references aml.documentos(organizacion_id, id) on delete restrict,
  constraint dato_de_documento_cita_fuente check (origen <> 'documento' or documento_id is not null)
);
create unique index datos_expediente_vigente on aml.datos_expediente (expediente_id, campo) where vigente;

-- Pendientes visibles para el cliente. Nunca contienen resultados de
-- verificación ni alertas (art. 38): esos viven en tablas separadas.
create table aml.pendientes (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null,
  expediente_id     uuid not null,
  tipo              aml.tipo_pendiente not null,
  descripcion       text not null,
  documento_id      uuid,
  estado            aml.estado_pendiente not null default 'abierto',
  justificacion     text,
  creado_en         timestamptz not null default now(),
  resuelto_en       timestamptz,
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict,
  constraint justificado_con_texto check (estado <> 'justificado' or length(trim(justificacion)) > 0)
);

-- ---------------------------------------------------------------------------
-- Zona reservada a cumplimiento: verificaciones, alertas, riesgo, decisiones
-- ---------------------------------------------------------------------------
create table aml.verificaciones (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null,
  expediente_id     uuid not null,
  persona_relacionada_id uuid,                    -- null = el cliente
  nombre_consultado text not null,
  fuente            aml.fuente_verificacion not null,
  version_fuente    text,                          -- fecha o hash de la lista usada
  consultado_en     timestamptz not null default now(),
  resultado         aml.resultado_verificacion not null,
  coincidencias     jsonb not null default '[]'::jsonb,
  dispuesto_por     uuid,
  dispuesto_en      timestamptz,
  justificacion     text,
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict,
  foreign key (organizacion_id, persona_relacionada_id) references aml.personas_relacionadas(organizacion_id, id) on delete restrict,
  constraint disposicion_justificada check (
    resultado not in ('descartada', 'coincidencia_confirmada')
    or (dispuesto_por is not null and length(trim(justificacion)) > 0)
  )
);

create table aml.alertas (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null,
  expediente_id     uuid not null,
  senal             text not null,                 -- código del catálogo de señales
  descripcion       text not null,
  evidencia         jsonb not null default '{}'::jsonb,
  vence_en          timestamptz,                   -- p. ej. 24 h para comunicar al MP (art. 43)
  estado            aml.estado_alerta not null default 'abierta',
  responsable       uuid,
  cierre            text,
  creado_en         timestamptz not null default now(),
  cerrada_en        timestamptz,
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict
);

create table aml.evaluaciones_riesgo (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null,
  expediente_id     uuid not null,
  configuracion_id  uuid not null,
  entrada           jsonb not null,                -- perfil evaluado, tal como se usó
  puntajes          jsonb not null,                -- por factor
  puntaje_total     numeric(6,2) not null,
  nivel_calculado   aml.nivel_riesgo not null,
  medidas           aml.medidas_ddc not null,
  reglas_impuestas  jsonb not null default '[]'::jsonb,
  senales           jsonb not null default '[]'::jsonb,
  nivel_ajustado    aml.nivel_riesgo,
  justificacion_ajuste text,
  ajustado_por      uuid,
  calculado_en      timestamptz not null default now(),
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict,
  foreign key (organizacion_id, configuracion_id) references aml.configuraciones_riesgo(organizacion_id, id) on delete restrict,
  unique (organizacion_id, id),
  constraint ajuste_justificado check (
    nivel_ajustado is null or (ajustado_por is not null and length(trim(justificacion_ajuste)) >= 20)
  )
);

create table aml.decisiones (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null,
  expediente_id     uuid not null,
  evaluacion_id     uuid,
  tipo              aml.tipo_decision not null,
  condiciones       text,
  verificacion_diferida_hasta date,
  justificacion     text not null check (length(trim(justificacion)) >= 20),
  decidido_por      uuid not null,
  decidido_en       timestamptz not null default now(),
  foreign key (organizacion_id, expediente_id) references aml.expedientes(organizacion_id, id) on delete restrict,
  foreign key (organizacion_id, evaluacion_id) references aml.evaluaciones_riesgo(organizacion_id, id) on delete restrict,
  constraint diferida_con_fecha check (tipo <> 'aprobar_diferida' or verificacion_diferida_hasta is not null)
);

-- Registro diario de efectivo (art. 31). El umbral (USD 10,000) se evalúa en
-- la vista registro_efectivo_diario.
create table aml.pagos_efectivo (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null,
  operacion_id      uuid not null,
  cliente_id        uuid not null,
  fecha             date not null,
  monto             numeric(16,2) not null check (monto > 0),
  moneda            char(3) not null,
  tipo_cambio_usd   numeric(12,6) not null check (tipo_cambio_usd > 0), -- unidades de moneda por 1 USD
  monto_usd         numeric(16,2) generated always as (round(monto / tipo_cambio_usd, 2)) stored,
  registrado_por    uuid,
  creado_en         timestamptz not null default now(),
  foreign key (organizacion_id, operacion_id) references aml.operaciones(organizacion_id, id) on delete restrict,
  foreign key (organizacion_id, cliente_id) references aml.clientes(organizacion_id, id) on delete restrict
);

create view aml.registro_efectivo_diario with (security_invoker = true) as
select organizacion_id, cliente_id, fecha,
       count(*)        as pagos,
       sum(monto_usd)  as total_usd,
       sum(monto_usd) >= 10000 as sujeto_a_registro   -- única o estructurada
from aml.pagos_efectivo
group by organizacion_id, cliente_id, fecha;

-- Índices de consulta frecuente
create index on aml.expedientes (organizacion_id, estado);
create index on aml.documentos (expediente_id);
create index on aml.pendientes (expediente_id) where estado = 'abierto';
create index on aml.verificaciones (expediente_id);
create index on aml.alertas (organizacion_id, estado);
create index on aml.pagos_efectivo (organizacion_id, cliente_id, fecha);
