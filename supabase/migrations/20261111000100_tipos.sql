-- Agente AML · Fase 1 · Tipos base
-- Base legal: Decreto 15-2026 (Ley Integral para la Prevención y Represión del
-- Lavado de Dinero u Otros Activos y del Financiamiento del Terrorismo).

create extension if not exists pgcrypto;

create schema if not exists aml;

-- Roles dentro de una organización (sujeto obligado).
-- oficial y oficial_suplente: arts. 16 y 18. auditor: solo lectura.
create type aml.rol_usuario as enum (
  'administrador', 'ejecutivo', 'oficial', 'oficial_suplente', 'auditor'
);

-- Actividad que confiere la calidad de Persona Obligada (art. 3).
-- La fase 1 solo usa 'inmobiliaria'; las demás quedan previstas.
create type aml.actividad_po as enum (
  'inmobiliaria', 'vehiculos', 'arte_joyas_metales', 'blindaje',
  'servicios_societarios', 'loterias_rifas', 'activos_virtuales',
  'profesional', 'notario', 'financiera_no_supervisada', 'cooperativa',
  'casa_empeno'
);

create type aml.tipo_persona as enum ('individual', 'juridica', 'estructura');

create type aml.tipo_operacion as enum ('compraventa', 'intermediacion');

-- Parte de la operación que es cliente de la inmobiliaria.
-- El origen de fondos se exige solo al comprador (decisión 11/11/2026).
create type aml.parte_operacion as enum ('comprador', 'vendedor');

create type aml.estado_operacion as enum ('abierta', 'cerrada', 'cancelada');

create type aml.estado_expediente as enum (
  'invitado',             -- enlace enviado
  'en_captura',           -- el cliente está entregando información
  'en_revision',          -- el agente revisa pendientes
  'listo_para_decision',  -- caso preparado para el oficial
  'aprobado',
  'aprobado_condicionado',-- verificación diferida (art. 22, máx. 3 meses)
  'rechazado',
  'abstenido',            -- imposibilidad de aplicar DDC (art. 22)
  'en_examen'             -- examen de transacción inusual (art. 29)
);

create type aml.canal as enum ('web', 'whatsapp', 'consola');

create type aml.estado_documento as enum (
  'recibido', 'extraido', 'confirmado', 'observado', 'rechazado'
);

create type aml.origen_dato as enum ('cliente', 'documento', 'fuente_externa', 'revisor');

create type aml.rol_relacionado as enum (
  'representante', 'apoderado', 'beneficiario_final', 'accionista',
  'pariente_pep', 'asociado_pep', 'tercero_pagador'
);

create type aml.tipo_pendiente as enum (
  'faltante', 'ilegible', 'vencido', 'contradiccion', 'aclaracion'
);

create type aml.estado_pendiente as enum ('abierto', 'resuelto', 'justificado');

create type aml.fuente_verificacion as enum (
  'onu', 'ofac', 'pep', 'medios_adversos', 'ive_inscripcion', 'otra'
);

create type aml.resultado_verificacion as enum (
  'sin_coincidencia', 'posible_coincidencia', 'coincidencia_confirmada', 'descartada'
);

create type aml.estado_alerta as enum ('abierta', 'en_analisis', 'cerrada');

create type aml.nivel_riesgo as enum ('bajo', 'medio', 'alto');

create type aml.medidas_ddc as enum ('simplificada', 'estandar', 'intensificada');

create type aml.tipo_decision as enum (
  'aprobar', 'aprobar_diferida', 'intensificar', 'rechazar', 'abstener', 'abrir_examen'
);

create type aml.estado_canal as enum ('pendiente', 'activo', 'suspendido');
