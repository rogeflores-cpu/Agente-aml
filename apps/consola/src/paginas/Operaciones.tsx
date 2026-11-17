import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boton, Insignia, Mensaje, Tarjeta, Vacio, fecha, moneda } from '../componentes/ui';
import type { EstadoComercial, FilaOperacion, Fuente, NuevoPagoEfectivo, ParteOperativa } from '../fuente/tipos';
import { hoyGuatemala, validarPagoEfectivo } from '../fuente/validacion';
import { RegistrarOperacion } from './RegistrarOperacion';

/**
 * Vista operativa de la inmobiliaria (administrador y ejecutivo).
 * Art. 38: aquí no hay información de cumplimiento; los estados vienen
 * enmascarados desde la fuente.
 */
export const ESTADOS_COMERCIALES: Record<EstadoComercial, { texto: string; clase: string }> = {
  invitado: { texto: 'Invitado', clase: 'bg-slate-100 text-slate-700' },
  en_captura: { texto: 'Completando información', clase: 'bg-sky-50 text-sky-800' },
  en_revision: { texto: 'En revisión', clase: 'bg-indigo-50 text-indigo-800' },
  aprobado: { texto: 'Aprobado', clase: 'bg-bajo-claro text-bajo' },
  no_aprobado: { texto: 'No aprobado', clase: 'bg-slate-200 text-slate-800' },
};

export function Operaciones({ fuente, organizacionId }: { fuente: Fuente; organizacionId: string }) {
  const [ops, setOps] = useState<FilaOperacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'aviso' | 'error'; texto: string; url?: string } | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [pagoPara, setPagoPara] = useState<ParteOperativa | null>(null);

  const cargar = useCallback(() => fuente.operaciones(organizacionId).then(setOps).catch((e) => setError(e.message)), [fuente, organizacionId]);
  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (ops ?? []).filter((o) => !q || o.codigo.toLowerCase().includes(q) || o.partes.some((p) => p.nombre.toLowerCase().includes(q)));
  }, [ops, busqueda]);

  const resumen = useMemo(() => {
    const partes = (ops ?? []).flatMap((o) => o.partes);
    return {
      operaciones: (ops ?? []).length,
      esperando: partes.filter((p) => p.estado === 'invitado' || p.estado === 'en_captura').length,
      revision: partes.filter((p) => p.estado === 'en_revision').length,
      aprobados: partes.filter((p) => p.estado === 'aprobado').length,
    };
  }, [ops]);

  if (registrando) {
    return (
      <RegistrarOperacion fuente={fuente} organizacionId={organizacionId} cancelar={() => setRegistrando(false)}
        alRegistrar={(codigo) => { setRegistrando(false); setAviso({ tipo: 'ok', texto: `Operación ${codigo} registrada. Los clientes recibirán su enlace.` }); cargar(); }} />
    );
  }
  if (error) return <Mensaje tipo="error">{error}</Mensaje>;

  const reenviar = async (p: ParteOperativa) => {
    setAviso(null);
    try {
      const r = await fuente.reenviarEnlace(p.expedienteId);
      setAviso(r.canal === 'whatsapp'
        ? { tipo: 'ok', texto: `Se envió un nuevo enlace por WhatsApp a ${p.nombre}. Vence el ${fecha(r.expiraEn)}.` }
        : r.canal === 'correo'
          ? { tipo: 'ok', texto: `Se envió un nuevo enlace por correo a ${p.nombre}${p.correo ? ` (${p.correo})` : ''}. Vence el ${fecha(r.expiraEn)}.` }
          : { tipo: 'aviso', texto: `${p.nombre} no tiene WhatsApp ni correo disponible. Comparta este enlace por otro medio (vence el ${fecha(r.expiraEn)}):`, url: r.url });
    } catch (e) {
      setAviso({ tipo: 'error', texto: (e as Error).message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Operaciones</h1>
        <Boton onClick={() => setRegistrando(true)}>Registrar operación</Boton>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { t: 'Operaciones', v: resumen.operaciones },
          { t: 'Clientes completando información', v: resumen.esperando },
          { t: 'Expedientes en revisión', v: resumen.revision },
          { t: 'Expedientes aprobados', v: resumen.aprobados },
        ].map((k) => (
          <div key={k.t} className="rounded-xl border border-borde bg-white px-5 py-4">
            <div className="text-xs font-medium text-tinta-suave">{k.t}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{ops ? k.v : '…'}</div>
          </div>
        ))}
      </div>

      {aviso && (
        <Mensaje tipo={aviso.tipo}>
          {aviso.texto}
          {aviso.url && <code className="mt-2 block break-all rounded bg-white px-2 py-1 text-xs text-tinta">{aviso.url}</code>}
        </Mensaje>
      )}

      {pagoPara && (
        <PagoEfectivo fuente={fuente} parte={pagoPara} cerrar={() => setPagoPara(null)}
          alRegistrar={() => { setAviso({ tipo: 'ok', texto: `Pago en efectivo registrado para ${pagoPara.nombre}.` }); setPagoPara(null); }} />
      )}

      <div className="flex justify-end">
        <input placeholder="Buscar por cliente u operación" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          className="w-72 rounded-lg border border-borde bg-white px-3 py-1.5 text-sm outline-none focus:border-marca" />
      </div>

      {!ops ? <Vacio>Cargando…</Vacio> : visibles.length === 0 ? <Tarjeta><Vacio>No hay operaciones registradas.</Vacio></Tarjeta> : (
        <div className="space-y-4">
          {visibles.map((o) => (
            <Tarjeta key={o.id}
              titulo={<span>{o.codigo} <span className="font-normal text-tinta-suave">· {o.tipo === 'intermediacion' ? 'Intermediación' : 'Compraventa'}</span></span>}
              accion={<span className="text-sm tabular-nums">{moneda(o.precio, o.moneda)}</span>}>
              <p className="mb-3 text-sm text-tinta-suave">
                {[o.inmueble.finca, o.inmueble.direccion, o.inmueble.municipio, o.inmueble.departamento].filter(Boolean).join(', ') || 'Inmueble sin datos'}
                {' · '}registrada el {fecha(o.creadaEn)}
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-tinta-suave">
                    <th className="pb-2 font-medium">Cliente</th><th className="pb-2 font-medium">Estado</th>
                    <th className="pb-2 font-medium">Pendientes</th><th className="pb-2 font-medium">WhatsApp</th><th />
                  </tr>
                </thead>
                <tbody>
                  {o.partes.map((p) => {
                    const enCurso = p.estado !== 'aprobado' && p.estado !== 'no_aprobado';
                    return (
                      <tr key={p.expedienteId} className="border-t border-borde">
                        <td className="py-2.5">
                          <div className="font-medium">{p.nombre}</div>
                          <div className="text-xs capitalize text-tinta-suave">{p.parte} · {p.tipoPersona === 'individual' ? 'persona individual' : 'persona jurídica'}</div>
                        </td>
                        <td className="py-2.5"><Insignia clase={ESTADOS_COMERCIALES[p.estado].clase}>{ESTADOS_COMERCIALES[p.estado].texto}</Insignia></td>
                        <td className="py-2.5 tabular-nums">{p.pendientes || '—'}</td>
                        <td className="py-2.5 text-tinta-suave">{p.whatsappVinculado ? 'Vinculado' : 'No vinculado'}</td>
                        <td className="py-2.5">
                          <div className="flex justify-end gap-2">
                            {enCurso && <Boton tipo="secundario" onClick={() => reenviar(p)}>Reenviar enlace</Boton>}
                            {p.parte === 'comprador' && <Boton tipo="secundario" onClick={() => setPagoPara(p)}>Registrar efectivo</Boton>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Tarjeta>
          ))}
        </div>
      )}
    </div>
  );
}

function PagoEfectivo({ fuente, parte, cerrar, alRegistrar }: { fuente: Fuente; parte: ParteOperativa; cerrar: () => void; alRegistrar: () => void }) {
  const hoy = hoyGuatemala();
  const [p, setP] = useState<NuevoPagoEfectivo>({ expedienteId: parte.expedienteId, fecha: hoy, monto: 0, moneda: 'GTQ', tipoCambioUsd: 0 });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const usd = p.monto > 0 && p.tipoCambioUsd > 0 ? p.monto / p.tipoCambioUsd : null;
  const campo = (clave: keyof NuevoPagoEfectivo, etiqueta: string, tipo: string, extra: Record<string, string> = {}) => (
    <label className="block text-sm">
      <span className="mb-1 block">{etiqueta}</span>
      <input type={tipo} {...extra} value={p[clave] === 0 ? '' : String(p[clave])}
        onChange={(e) => setP({ ...p, [clave]: tipo === 'number' ? Number(e.target.value) : clave === 'moneda' ? e.target.value.toUpperCase() : e.target.value })}
        className={`w-full rounded-lg border px-3 py-2 ${errores[clave] ? 'border-alto' : 'border-borde'}`} />
      {errores[clave] && <span className="text-xs text-alto">{errores[clave]}</span>}
    </label>
  );
  return (
    <Tarjeta titulo={`Registrar pago en efectivo · ${parte.nombre}`} accion={<button onClick={cerrar} className="text-sm text-tinta-suave hover:text-tinta">Cerrar</button>}>
      <p className="mb-4 text-xs text-tinta-suave">
        Registre cada pago en efectivo el día que lo recibe. Los pagos del mismo día se suman para el control de USD 10,000 (art. 31).
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        {campo('fecha', 'Fecha', 'date', { max: hoy })}
        {campo('monto', 'Monto', 'number', { step: '0.01', min: '0' })}
        {campo('moneda', 'Moneda', 'text', { maxLength: '3' })}
        {campo('tipoCambioUsd', 'Tipo de cambio por USD', 'number', { step: '0.0001', min: '0' })}
      </div>
      {usd !== null && <p className="mt-2 text-sm text-tinta-suave">Equivale a USD {usd.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</p>}
      {error && <div className="mt-3"><Mensaje tipo="error">{error}</Mensaje></div>}
      <div className="mt-4">
        <Boton disabled={enviando} onClick={async () => {
          const e = validarPagoEfectivo(p);
          setErrores(e);
          if (Object.keys(e).length) return;
          setEnviando(true); setError(null);
          try { await fuente.registrarPagoEfectivo(p); alRegistrar(); } catch (x) { setError((x as Error).message); } finally { setEnviando(false); }
        }}>Registrar pago</Boton>
      </div>
    </Tarjeta>
  );
}
