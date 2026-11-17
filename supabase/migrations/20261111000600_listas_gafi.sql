-- Agente AML · Listas del GAFI, versionadas
--
-- El GAFI no publica un archivo descargable ni una API: publica dos
-- declaraciones en su sitio después de cada pleno (febrero, junio y octubre):
-- "High-Risk Jurisdictions subject to a Call for Action" y "Jurisdictions under
-- Increased Monitoring". La plataforma las registra aquí, una versión por pleno,
-- y el motor de riesgo usa siempre la versión vigente (art. 24 ii).

create table aml.listas_gafi (
  id                uuid primary key default gen_random_uuid(),
  plenario          date not null unique,          -- fecha de la declaración del GAFI
  alto_riesgo       char(2)[] not null,            -- llamado a la acción, ISO 3166-1 alfa-2
  monitoreo         char(2)[] not null,            -- monitoreo intensificado
  fuente_alto_riesgo text not null,                -- URL de la declaración oficial
  fuente_monitoreo  text not null,
  cargada_por       text not null,
  cargada_en        timestamptz not null default now(),
  constraint codigos_validos check (
    array_to_string(alto_riesgo, '') ~ '^([A-Z]{2})*$' and array_to_string(monitoreo, '') ~ '^([A-Z]{2})*$'
  ),
  constraint sin_traslape check (not (alto_riesgo && monitoreo))
);

create trigger listas_gafi_inmutables before update or delete on aml.listas_gafi
  for each row execute function aml.impedir_cambios();

create view aml.lista_gafi_vigente with (security_invoker = true) as
select * from aml.listas_gafi order by plenario desc limit 1;

-- Avisos para el administrador de la plataforma (no pertenecen a una organización).
create table aml.avisos_plataforma (
  id          uuid primary key default gen_random_uuid(),
  asunto      text not null,
  cuerpo      text not null,
  creado_en   timestamptz not null default now(),
  atendido_en timestamptz
);

alter table aml.listas_gafi enable row level security;
alter table aml.avisos_plataforma enable row level security;
create policy listas_gafi_ver on aml.listas_gafi for select to authenticated using (true);

grant select on aml.listas_gafi, aml.lista_gafi_vigente to authenticated;
grant all on aml.listas_gafi, aml.avisos_plataforma to service_role;
grant select on aml.lista_gafi_vigente to service_role;
