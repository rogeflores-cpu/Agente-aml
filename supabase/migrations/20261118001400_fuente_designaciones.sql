-- Agente AML · Fuente de verificación para las designaciones de la S/RES/1373(2001)
--
-- Va sola en su archivo: un valor nuevo de un tipo enumerado no se puede usar
-- en la misma transacción en que se agrega, y la migración siguiente lo usa.
alter type aml.fuente_verificacion add value if not exists 'designacion_1373';
