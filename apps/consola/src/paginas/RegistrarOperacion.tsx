import { DEPARTAMENTOS_GUATEMALA, municipiosDe, normalizarFinca, normalizarLibro } from '@agente-aml/riesgo';
import { useState, type ReactNode } from 'react';
import { Boton, Mensaje, Tarjeta } from '../componentes/ui';
import type { Fuente, MedioPago, NuevaOperacion } from '../fuente/tipos';
import { validarOperacion } from '../fuente/validacion';

const MEDIOS: { valor: MedioPago; texto: string }[] = [
  { valor: 'financiamiento_bancario', texto: 'Financiamiento bancario' },
  { valor: 'transferencia_local', texto: 'Transferencia local' },
  { valor: 'transferencia_exterior', texto: 'Transferencia del exterior' },
  { valor: 'cheque', texto: 'Cheque' },
  { valor: 'efectivo', texto: 'Efectivo' },
  { valor: 'activos_virtuales', texto: 'Activos virtuales' },
  { valor: 'otro', texto: 'Otro' },
];

type Parte = NuevaOperacion['partes'][number];
const parteVacia = (parte: Parte['parte']): Parte => ({ parte, tipoPersona: 'individual', nombre: '', telefono: '', correo: '' });

function Campo({ etiqueta, error, children }: { etiqueta: string; error?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block">{etiqueta}</span>
      {children}
      {error && <span className="text-xs text-alto">{error}</span>}
    </label>
  );
}
const claseEntrada = (error?: string) => `w-full rounded-lg border px-3 py-2 ${error ? 'border-alto' : 'border-borde'}`;

export function RegistrarOperacion({ fuente, organizacionId, cancelar, alRegistrar }: {
  fuente: Fuente; organizacionId: string; cancelar: () => void; alRegistrar: (codigo: string) => void;
}) {
  const [op, setOpBase] = useState<NuevaOperacion>({
    tipo: 'compraventa', inmueble: { departamento: 'Guatemala', municipio: '', finca: '', folio: '', libro: '', direccion: '' },
    moneda: 'GTQ', formaPago: [], partes: [parteVacia('comprador'), parteVacia('vendedor')],
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const limpia = (op: NuevaOperacion): NuevaOperacion => ({
    ...op,
    inmueble: Object.fromEntries(Object.entries({
      ...op.inmueble,
      finca: normalizarFinca(op.inmueble.finca ?? ''), folio: normalizarFinca(op.inmueble.folio ?? ''), libro: normalizarLibro(op.inmueble.libro ?? ''),
    }).filter(([, v]) => v?.trim())) as NuevaOperacion['inmueble'],
    partes: op.partes.map((p) => ({ ...p, nombre: p.nombre.trim(), telefono: p.telefono?.trim() || undefined, correo: p.correo?.trim() || undefined })),
  });
  // Tras el primer intento, los errores se recalculan al corregir cada campo.
  const setOp = (nueva: NuevaOperacion) => {
    setOpBase(nueva);
    if (Object.keys(errores).length) setErrores(validarOperacion(limpia(nueva)));
  };
  const setParte = (i: number, cambio: Partial<Parte>) => setOp({ ...op, partes: op.partes.map((p, j) => (j === i ? { ...p, ...cambio } : p)) });
  const setPago = (i: number, cambio: Partial<NuevaOperacion['formaPago'][number]>) =>
    setOp({ ...op, formaPago: op.formaPago.map((p, j) => (j === i ? { ...p, ...cambio } : p)) });
  const num = (v: string) => (v === '' ? undefined : Number(v));

  return (
    <div className="space-y-5">
      <button onClick={cancelar} className="text-sm text-tinta-suave hover:text-tinta">← Operaciones</button>
      <h1 className="text-xl font-semibold">Registrar operación</h1>

      <Tarjeta titulo="Operación e inmueble">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo etiqueta="Tipo de operación">
            <select value={op.tipo} onChange={(e) => setOp({ ...op, tipo: e.target.value as NuevaOperacion['tipo'] })} className={claseEntrada()}>
              <option value="compraventa">Compraventa</option><option value="intermediacion">Intermediación</option>
            </select>
          </Campo>
          <Campo etiqueta="Departamento" error={errores['inmueble.departamento']}>
            <select value={op.inmueble.departamento}
              onChange={(e) => setOp({ ...op, inmueble: { ...op.inmueble, departamento: e.target.value, municipio: '' } })} className={claseEntrada()}>
              {DEPARTAMENTOS_GUATEMALA.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Municipio" error={errores['inmueble.municipio']}>
            <select value={op.inmueble.municipio} onChange={(e) => setOp({ ...op, inmueble: { ...op.inmueble, municipio: e.target.value } })}
              className={claseEntrada(errores['inmueble.municipio'])}>
              <option value="">Seleccione…</option>
              {municipiosDe(op.inmueble.departamento).map((m) => <option key={m}>{m}</option>)}
            </select>
          </Campo>
          <div className="grid grid-cols-3 gap-3 sm:col-span-2 lg:col-span-4">
            <Campo etiqueta="No. de finca" error={errores['inmueble.finca']}>
              <input value={op.inmueble.finca} inputMode="numeric" placeholder="1234" onChange={(e) => setOp({ ...op, inmueble: { ...op.inmueble, finca: e.target.value } })}
                className={claseEntrada(errores['inmueble.finca'])} />
            </Campo>
            <Campo etiqueta="Folio" error={errores['inmueble.folio']}>
              <input value={op.inmueble.folio} inputMode="numeric" placeholder="56" onChange={(e) => setOp({ ...op, inmueble: { ...op.inmueble, folio: e.target.value } })}
                className={claseEntrada(errores['inmueble.folio'])} />
            </Campo>
            <Campo etiqueta="Libro" error={errores['inmueble.libro']}>
              <input value={op.inmueble.libro} placeholder="789 o 45E" onChange={(e) => setOp({ ...op, inmueble: { ...op.inmueble, libro: e.target.value } })}
                className={claseEntrada(errores['inmueble.libro'])} />
            </Campo>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Campo etiqueta="Dirección">
              <input value={op.inmueble.direccion} onChange={(e) => setOp({ ...op, inmueble: { ...op.inmueble, direccion: e.target.value } })} className={claseEntrada()} />
            </Campo>
          </div>
          <Campo etiqueta="Precio" error={errores.precio}>
            <input type="number" min="0" step="0.01" value={op.precio ?? ''} onChange={(e) => setOp({ ...op, precio: num(e.target.value) })} className={claseEntrada(errores.precio)} />
          </Campo>
          <Campo etiqueta="Moneda">
            <select value={op.moneda} onChange={(e) => setOp({ ...op, moneda: e.target.value })} className={claseEntrada()}>
              <option value="GTQ">GTQ</option><option value="USD">USD</option>
            </select>
          </Campo>
          <Campo etiqueta="Valor de referencia (opcional)" error={errores.valorReferencia}>
            <input type="number" min="0" step="0.01" value={op.valorReferencia ?? ''} placeholder="Avalúo o valor de mercado"
              onChange={(e) => setOp({ ...op, valorReferencia: num(e.target.value) })} className={claseEntrada(errores.valorReferencia)} />
          </Campo>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Forma de pago" accion={
        <Boton tipo="secundario" onClick={() => setOp({ ...op, formaPago: [...op.formaPago, { medio: 'financiamiento_bancario', monto: 0, pagador: 'cliente' }] })}>Agregar pago</Boton>
      }>
        {op.formaPago.length === 0 ? <p className="text-sm text-tinta-suave">Opcional. Indique cómo se pagará si ya lo sabe.</p> : (
          <div className="space-y-3">
            {op.formaPago.map((p, i) => (
              <div key={i} className="grid items-end gap-3 sm:grid-cols-[2fr_1fr_1.5fr_auto]">
                <Campo etiqueta="Medio">
                  <select value={p.medio} onChange={(e) => setPago(i, { medio: e.target.value as MedioPago })} className={claseEntrada()}>
                    {MEDIOS.map((m) => <option key={m.valor} value={m.valor}>{m.texto}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta={`Monto (${op.moneda})`} error={errores[`formaPago.${i}.monto`]}>
                  <input type="number" min="0" step="0.01" value={p.monto || ''} onChange={(e) => setPago(i, { monto: Number(e.target.value) })} className={claseEntrada(errores[`formaPago.${i}.monto`])} />
                </Campo>
                <Campo etiqueta="Quién paga">
                  <select value={p.pagador} onChange={(e) => setPago(i, { pagador: e.target.value as 'cliente' | 'tercero' })} className={claseEntrada()}>
                    <option value="cliente">El cliente</option><option value="tercero">Un tercero</option>
                  </select>
                </Campo>
                <Boton tipo="secundario" onClick={() => setOp({ ...op, formaPago: op.formaPago.filter((_, j) => j !== i) })}>Quitar</Boton>
              </div>
            ))}
            {errores.formaPago && <p className="text-xs text-alto">{errores.formaPago}</p>}
          </div>
        )}
      </Tarjeta>

      <Tarjeta titulo="Partes" accion={
        <div className="flex gap-2">
          <Boton tipo="secundario" onClick={() => setOp({ ...op, partes: [...op.partes, parteVacia('comprador')] })}>Agregar comprador</Boton>
          <Boton tipo="secundario" onClick={() => setOp({ ...op, partes: [...op.partes, parteVacia('vendedor')] })}>Agregar vendedor</Boton>
        </div>
      }>
        <p className="mb-4 text-xs text-tinta-suave">Cada parte recibe su propio enlace seguro. Con teléfono, también por el WhatsApp de la inmobiliaria.</p>
        {errores.partes && <p className="mb-3 text-xs text-alto">{errores.partes}</p>}
        <div className="space-y-4">
          {op.partes.map((p, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-borde p-4 sm:grid-cols-2 lg:grid-cols-5">
              <Campo etiqueta="Parte">
                <select value={p.parte} onChange={(e) => setParte(i, { parte: e.target.value as Parte['parte'] })} className={claseEntrada()}>
                  <option value="comprador">Comprador</option><option value="vendedor">Vendedor</option>
                </select>
              </Campo>
              <Campo etiqueta="Tipo de persona">
                <select value={p.tipoPersona} onChange={(e) => setParte(i, { tipoPersona: e.target.value as Parte['tipoPersona'] })} className={claseEntrada()}>
                  <option value="individual">Individual</option><option value="juridica">Jurídica</option><option value="estructura">Fideicomiso u otra estructura</option>
                </select>
              </Campo>
              <Campo etiqueta={p.tipoPersona === 'individual' ? 'Nombre completo' : 'Razón social'} error={errores[`partes.${i}.nombre`]}>
                <input value={p.nombre} onChange={(e) => setParte(i, { nombre: e.target.value })} className={claseEntrada(errores[`partes.${i}.nombre`])} />
              </Campo>
              <Campo etiqueta="Teléfono (WhatsApp)" error={errores[`partes.${i}.telefono`]}>
                <input value={p.telefono} placeholder="+50255550000" onChange={(e) => setParte(i, { telefono: e.target.value })} className={claseEntrada(errores[`partes.${i}.telefono`])} />
              </Campo>
              <Campo etiqueta="Correo" error={errores[`partes.${i}.correo`]}>
                <div className="flex gap-2">
                  <input type="email" value={p.correo} onChange={(e) => setParte(i, { correo: e.target.value })} className={claseEntrada(errores[`partes.${i}.correo`])} />
                  {op.partes.length > 1 && (
                    <button title="Quitar parte" onClick={() => setOp({ ...op, partes: op.partes.filter((_, j) => j !== i) })} className="px-2 text-tinta-suave hover:text-alto">✕</button>
                  )}
                </div>
              </Campo>
            </div>
          ))}
        </div>
      </Tarjeta>

      {error && <Mensaje tipo="error">{error}</Mensaje>}
      {Object.keys(errores).length > 0 && <Mensaje tipo="error">Revise los campos marcados.</Mensaje>}
      <div className="flex gap-3">
        <Boton disabled={enviando} onClick={async () => {
          const datos = limpia(op);
          const e = validarOperacion(datos);
          setErrores(e);
          if (Object.keys(e).length) return;
          setEnviando(true); setError(null);
          try { const r = await fuente.registrarOperacion(organizacionId, datos); alRegistrar(r.codigo); }
          catch (x) { setError((x as Error).message); } finally { setEnviando(false); }
        }}>{enviando ? 'Registrando…' : 'Registrar y enviar enlaces'}</Boton>
        <Boton tipo="secundario" onClick={cancelar}>Cancelar</Boton>
      </div>
    </div>
  );
}
