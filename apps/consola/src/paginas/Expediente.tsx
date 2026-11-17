import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Boton, ESTADOS, Insignia, Mensaje, NIVELES, NOMBRE_DOCUMENTO, Tarjeta, Vacio,
  etiquetaCampo, fecha, moneda, mostrarValor,
} from '../componentes/ui';
import type { AjustesEvaluacion, DetalleExpediente, Fuente, NuevaDecision, Verificacion } from '../fuente/tipos';

type Pestana = 'resumen' | 'datos' | 'documentos' | 'listas' | 'riesgo' | 'alertas' | 'decision' | 'bitacora';

export function Expediente({ fuente, id, volver }: { fuente: Fuente; id: string; volver: () => void }) {
  const [e, setE] = useState<DetalleExpediente | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>('resumen');
  const recargar = useCallback(() => fuente.expediente(id).then(setE).catch((x) => setError(x.message)), [fuente, id]);
  useEffect(() => { recargar(); }, [recargar]);

  if (error) return <Mensaje tipo="error">{error}</Mensaje>;
  if (!e) return <Vacio>Cargando expediente…</Vacio>;

  const porDisponer = e.verificaciones.filter((v) => v.resultado === 'posible_coincidencia').length;
  const alertas = e.alertas.filter((a) => a.estado !== 'cerrada').length;
  const ev = e.evaluaciones[0];
  const nivel = ev ? ev.nivelAjustado ?? ev.nivelCalculado : null;
  const decidido = ['aprobado', 'aprobado_condicionado', 'rechazado', 'abstenido'].includes(e.estado);

  const siguiente: { texto: string; ir: Pestana } | null =
    e.verificaciones.some((v) => v.resultado === 'coincidencia_confirmada') && alertas
      ? { texto: 'Coincidencia confirmada: limite la disposición de fondos y comunique al Ministerio Público dentro de 24 horas.', ir: 'alertas' }
      : porDisponer ? { texto: `Disponga ${porDisponer} posible(s) coincidencia(s) con la lista de la ONU.`, ir: 'listas' }
      : e.pendientes.length ? { texto: `El cliente tiene ${e.pendientes.length} pendiente(s). El agente le está dando seguimiento.`, ir: 'resumen' }
      : !ev ? { texto: 'Calcule la evaluación de riesgo.', ir: 'riesgo' }
      : alertas && !decidido ? { texto: `Analice ${alertas} alerta(s) abierta(s) antes de decidir.`, ir: 'alertas' }
      : !decidido ? { texto: 'El expediente está listo para su decisión.', ir: 'decision' }
      : null;

  const pestanas: { clave: Pestana; texto: string; cuenta?: number }[] = [
    { clave: 'resumen', texto: 'Resumen' },
    { clave: 'datos', texto: 'Datos', cuenta: e.datos.length },
    { clave: 'documentos', texto: 'Documentos', cuenta: e.documentos.length },
    { clave: 'listas', texto: 'Listas', cuenta: porDisponer || undefined },
    { clave: 'riesgo', texto: 'Riesgo' },
    { clave: 'alertas', texto: 'Alertas', cuenta: alertas || undefined },
    { clave: 'decision', texto: 'Decisión' },
    { clave: 'bitacora', texto: 'Bitácora' },
  ];

  return (
    <div className="space-y-5">
      <button onClick={volver} className="text-sm text-tinta-suave hover:text-tinta">← Bandeja</button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{e.contacto.nombre}</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            {e.codigoOperacion} · <span className="capitalize">{e.parte}</span> · {e.tipoPersona === 'individual' ? 'Persona individual' : 'Persona jurídica'}
          </p>
        </div>
        <div className="flex gap-2">
          <Insignia clase={ESTADOS[e.estado].clase}>{ESTADOS[e.estado].texto}</Insignia>
          {nivel && <Insignia clase={NIVELES[nivel].clase}>{NIVELES[nivel].texto}</Insignia>}
        </div>
      </div>

      {siguiente && (
        <button onClick={() => setPestana(siguiente.ir)} className="flex w-full items-center justify-between rounded-xl border border-marca/30 bg-marca-claro px-5 py-3 text-left text-sm text-marca">
          <span><strong className="font-semibold">Siguiente paso: </strong>{siguiente.texto}</span>
          <span aria-hidden>→</span>
        </button>
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-borde">
        {pestanas.map((p) => (
          <button key={p.clave} onClick={() => setPestana(p.clave)}
            className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${pestana === p.clave ? 'border-marca font-medium text-marca' : 'border-transparent text-tinta-suave hover:text-tinta'}`}>
            {p.texto}
            {p.cuenta !== undefined && <span className="rounded-full bg-papel px-1.5 text-xs">{p.cuenta}</span>}
          </button>
        ))}
      </nav>

      {pestana === 'resumen' && <Resumen e={e} />}
      {pestana === 'datos' && <Datos e={e} />}
      {pestana === 'documentos' && <Documentos e={e} fuente={fuente} />}
      {pestana === 'listas' && <Listas e={e} fuente={fuente} alCambiar={recargar} />}
      {pestana === 'riesgo' && <Riesgo e={e} fuente={fuente} alCambiar={recargar} />}
      {pestana === 'alertas' && <Alertas e={e} fuente={fuente} alCambiar={recargar} />}
      {pestana === 'decision' && <Decision e={e} fuente={fuente} alCambiar={recargar} />}
      {pestana === 'bitacora' && <Bitacora e={e} />}
    </div>
  );
}

function Fila({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1.5 text-sm">
      <dt className="text-tinta-suave">{etiqueta}</dt>
      <dd className="col-span-2">{children}</dd>
    </div>
  );
}

function Resumen({ e }: { e: DetalleExpediente }) {
  const ultima = e.decisiones[0];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Tarjeta titulo="Operación">
        <dl>
          <Fila etiqueta="Tipo"><span className="capitalize">{e.operacion.tipo}</span></Fila>
          <Fila etiqueta="Precio">{moneda(e.operacion.precio, e.operacion.moneda)}</Fila>
          <Fila etiqueta="Inmueble">{[e.operacion.inmueble.finca, e.operacion.inmueble.municipio, e.operacion.inmueble.departamento].filter(Boolean).join(', ') || '—'}</Fila>
          <Fila etiqueta="Forma de pago">
            {e.operacion.formaPago.length ? e.operacion.formaPago.map((p, i) => (
              <div key={i}>{p.medio.replace(/_/g, ' ')}: {moneda(p.monto, p.moneda ?? e.operacion.moneda)}</div>
            )) : '—'}
          </Fila>
        </dl>
      </Tarjeta>
      <Tarjeta titulo="Contacto">
        <dl>
          <Fila etiqueta="Nombre">{e.contacto.nombre}</Fila>
          <Fila etiqueta="Teléfono">{e.contacto.telefono ?? '—'}</Fila>
          <Fila etiqueta="Correo">{e.contacto.correo ?? '—'}</Fila>
          <Fila etiqueta="WhatsApp">{e.contacto.whatsappVinculado ? 'Vinculado' : 'No vinculado'}</Fila>
          {e.verificacionDiferidaHasta && <Fila etiqueta="Verificación diferida">hasta {e.verificacionDiferidaHasta}</Fila>}
        </dl>
      </Tarjeta>
      <Tarjeta titulo={`Pendientes del cliente (${e.pendientes.length})`}>
        {e.pendientes.length ? (
          <ul className="space-y-2 text-sm">
            {e.pendientes.map((p) => (
              <li key={p.id} className="flex gap-2"><Insignia clase="bg-slate-100 text-slate-700">{p.tipo}</Insignia><span>{p.descripcion}</span></li>
            ))}
          </ul>
        ) : <Vacio>Sin pendientes.</Vacio>}
      </Tarjeta>
      <Tarjeta titulo="Última decisión">
        {ultima ? (
          <div className="text-sm">
            <div className="font-medium capitalize">{ultima.tipo.replace(/_/g, ' ')}</div>
            <p className="mt-1 text-tinta-suave">{ultima.justificacion}</p>
            <p className="mt-2 text-xs text-tinta-suave">{ultima.decididoPor} · {fecha(ultima.decididoEn)}</p>
          </div>
        ) : <Vacio>Aún no hay decisión.</Vacio>}
      </Tarjeta>
    </div>
  );
}

function Datos({ e }: { e: DetalleExpediente }) {
  const doc = (id: string | null) => e.documentos.find((d) => d.id === id);
  return (
    <Tarjeta>
      {e.datos.length === 0 ? <Vacio>El cliente aún no ha entregado información.</Vacio> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-tinta-suave"><th className="pb-2 font-medium">Dato</th><th className="pb-2 font-medium">Valor</th><th className="pb-2 font-medium">Procedencia</th></tr></thead>
          <tbody>
            {e.datos.map((d) => (
              <tr key={d.campo} className="border-t border-borde align-top">
                <td className="py-2 pr-4 text-tinta-suave">{etiquetaCampo(d.campo)}</td>
                <td className="py-2 pr-4">{mostrarValor(d.valor)}</td>
                <td className="py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {d.origen === 'documento'
                      ? <Insignia clase="bg-indigo-50 text-indigo-800">{NOMBRE_DOCUMENTO[doc(d.documentoId)?.tipo ?? ''] ?? 'Documento'}{d.pagina ? `, p. ${d.pagina}` : ''}</Insignia>
                      : <Insignia clase="bg-slate-100 text-slate-700">Declarado por el cliente</Insignia>}
                    {d.confianza != null && d.confianza < 0.85 && <Insignia clase="bg-medio-claro text-medio">lectura dudosa</Insignia>}
                    {!d.confirmado && <Insignia clase="bg-medio-claro text-medio">sin confirmar</Insignia>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Tarjeta>
  );
}

function Documentos({ e, fuente }: { e: DetalleExpediente; fuente: Fuente }) {
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <Tarjeta>
      {aviso && <div className="mb-4"><Mensaje tipo="aviso">{aviso}</Mensaje></div>}
      {e.documentos.length === 0 ? <Vacio>No hay documentos recibidos.</Vacio> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-tinta-suave"><th className="pb-2 font-medium">Documento</th><th className="pb-2 font-medium">Recibido</th><th className="pb-2 font-medium">Canal</th><th className="pb-2 font-medium">Sello SHA-256</th><th /></tr></thead>
          <tbody>
            {e.documentos.map((d) => (
              <tr key={d.id} className="border-t border-borde">
                <td className="py-2.5">
                  <div className="font-medium">{NOMBRE_DOCUMENTO[d.tipo] ?? d.tipo}</div>
                  {d.estado === 'observado' && <Insignia clase="bg-medio-claro text-medio">requiere reenvío</Insignia>}
                </td>
                <td className="py-2.5 text-tinta-suave">{fecha(d.creadoEn)}</td>
                <td className="py-2.5 capitalize text-tinta-suave">{d.canal}</td>
                <td className="py-2.5 font-mono text-xs text-tinta-suave" title={d.sha256}>{d.sha256.slice(0, 12)}…{d.sha256.slice(-6)}</td>
                <td className="py-2.5 text-right">
                  <Boton tipo="secundario" onClick={async () => {
                    const url = await fuente.urlDocumento(d.id).catch(() => null);
                    if (url) window.open(url, '_blank', 'noopener'); else setAviso('En modo demostración no hay archivos para mostrar.');
                  }}>Ver</Boton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Tarjeta>
  );
}

function AreaTexto({ valor, setValor, placeholder }: { valor: string; setValor: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <textarea value={valor} onChange={(x) => setValor(x.target.value)} placeholder={placeholder} rows={3}
        className="w-full rounded-lg border border-borde px-3 py-2 text-sm outline-none focus:border-marca" />
      <div className={`text-right text-xs ${valor.trim().length < 20 ? 'text-tinta-suave' : 'text-bajo'}`}>{valor.trim().length}/20 mínimo</div>
    </div>
  );
}

function Listas({ e, fuente, alCambiar }: { e: DetalleExpediente; fuente: Fuente; alCambiar: () => void }) {
  if (!e.verificaciones.length) return <Tarjeta><Vacio>Aún no se ha cotejado este expediente. El cotejo se hace al confirmar el nombre del cliente.</Vacio></Tarjeta>;
  return <div className="space-y-4">{e.verificaciones.map((v) => <TarjetaVerificacion key={v.id} v={v} fuente={fuente} alCambiar={alCambiar} />)}</div>;
}

const RESULTADOS: Record<Verificacion['resultado'], { texto: string; clase: string }> = {
  sin_coincidencia: { texto: 'Sin coincidencias', clase: 'bg-bajo-claro text-bajo' },
  posible_coincidencia: { texto: 'Posible coincidencia: por disponer', clase: 'bg-alto-claro text-alto' },
  coincidencia_confirmada: { texto: 'Coincidencia confirmada', clase: 'bg-alto text-white' },
  descartada: { texto: 'Descartada por el oficial', clase: 'bg-slate-100 text-slate-700' },
};

function TarjetaVerificacion({ v, fuente, alCambiar }: { v: Verificacion; fuente: Fuente; alCambiar: () => void }) {
  const [resultado, setResultado] = useState<'descartada' | 'coincidencia_confirmada'>('descartada');
  const [justificacion, setJustificacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <Tarjeta titulo={<span>{v.nombreConsultado} <span className="font-normal text-tinta-suave">· lista {v.fuente.toUpperCase()} del {v.versionFuente ?? '—'}</span></span>}
      accion={<Insignia clase={RESULTADOS[v.resultado].clase}>{RESULTADOS[v.resultado].texto}</Insignia>}>
      <p className="mb-3 text-xs text-tinta-suave">Consultado el {fecha(v.consultadoEn)}</p>
      {v.coincidencias.length > 0 && (
        <table className="mb-4 w-full text-sm">
          <thead><tr className="text-left text-xs text-tinta-suave"><th className="pb-2 font-medium">Nombre en la lista</th><th className="pb-2 font-medium">Referencia</th><th className="pb-2 font-medium">Similitud</th><th className="pb-2 font-medium">Fecha de nacimiento</th></tr></thead>
          <tbody>
            {v.coincidencias.map((c) => (
              <tr key={c.referencia} className="border-t border-borde">
                <td className="py-2">{c.nombreCoincidente}</td>
                <td className="py-2 font-mono text-xs">{c.referencia}</td>
                <td className="py-2 tabular-nums">{Math.round(c.puntaje * 100)} %</td>
                <td className="py-2">{{ coincide: 'Coincide', difiere: 'Difiere', sin_dato: 'Sin dato' }[c.fechaNacimiento] ?? c.fechaNacimiento}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {v.justificacion && <p className="text-sm"><span className="text-tinta-suave">Disposición ({fecha(v.dispuestoEn)}): </span>{v.justificacion}</p>}
      {v.resultado === 'posible_coincidencia' && (
        <div className="space-y-3 rounded-lg bg-papel p-4">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" checked={resultado === 'descartada'} onChange={() => setResultado('descartada')} /> Descartar: no es la misma persona</label>
            <label className="flex items-center gap-2"><input type="radio" checked={resultado === 'coincidencia_confirmada'} onChange={() => setResultado('coincidencia_confirmada')} /> Confirmar coincidencia</label>
          </div>
          {resultado === 'coincidencia_confirmada' && (
            <Mensaje tipo="error">Al confirmar se abre una alerta con plazo de 24 horas para limitar la disposición de fondos bajo su administración y comunicar por escrito al Ministerio Público (art. 43). El cliente no será informado (art. 38).</Mensaje>
          )}
          <AreaTexto valor={justificacion} setValor={setJustificacion} placeholder="Justificación: datos comparados (fecha de nacimiento, nacionalidad, documento) y conclusión" />
          {error && <Mensaje tipo="error">{error}</Mensaje>}
          <Boton tipo={resultado === 'coincidencia_confirmada' ? 'peligro' : 'primario'} disabled={enviando || justificacion.trim().length < 20}
            onClick={async () => {
              setEnviando(true); setError(null);
              try { await fuente.disponer(v.id, resultado, justificacion); alCambiar(); } catch (x) { setError((x as Error).message); } finally { setEnviando(false); }
            }}>
            {resultado === 'coincidencia_confirmada' ? 'Confirmar coincidencia' : 'Descartar coincidencia'}
          </Boton>
        </div>
      )}
    </Tarjeta>
  );
}

const MEDIDAS: Record<string, string> = { simplificada: 'simplificada', estandar: 'estándar', intensificada: 'intensificada' };
const FACTORES: Record<string, string> = { cliente: 'Cliente', geografia: 'Ubicación geográfica', canal: 'Canal', producto: 'Producto u operación' };

function Riesgo({ e, fuente, alCambiar }: { e: DetalleExpediente; fuente: Fuente; alCambiar: () => void }) {
  const [ajustes, setAjustes] = useState<AjustesEvaluacion>({ presencial: false, coherenciaPerfilMonto: 'coherente' });
  const [advertencias, setAdvertencias] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [calculando, setCalculando] = useState(false);
  const ev = e.evaluaciones[0];
  const casilla = (clave: keyof AjustesEvaluacion, texto: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!ajustes[clave]} onChange={(x) => setAjustes({ ...ajustes, [clave]: x.target.checked })} /> {texto}
    </label>
  );
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Tarjeta titulo="Criterio del oficial" className="lg:col-span-2">
        <p className="mb-3 text-xs text-tinta-suave">Lo que el expediente no permite deducir. Queda guardado con la evaluación.</p>
        <div className="space-y-2.5">
          {casilla('presencial', 'Identificación presencial (en oficina)')}
          {casilla('intermediario', 'Interviene un intermediario')}
          {casilla('actuaPorRepresentacion', 'Actúa por medio de apoderado')}
          {casilla('contratistaOProveedorEstado', 'Contratista o proveedor del Estado')}
          {casilla('noDomiciliado', 'No domiciliado en Guatemala')}
          {casilla('transaccionInusual', 'Transacción inusual identificada')}
          <label className="block text-sm">
            <span className="mb-1 block">Coherencia entre perfil y monto</span>
            <select value={ajustes.coherenciaPerfilMonto} onChange={(x) => setAjustes({ ...ajustes, coherenciaPerfilMonto: x.target.value as AjustesEvaluacion['coherenciaPerfilMonto'] })}
              className="w-full rounded-lg border border-borde px-3 py-2">
              <option value="coherente">Coherente</option><option value="dudosa">Dudosa</option><option value="incoherente">No coherente</option>
            </select>
          </label>
          {e.operacion.moneda !== 'USD' && (
            <label className="block text-sm">
              <span className="mb-1 block">Tipo de cambio {e.operacion.moneda} por USD</span>
              <input type="number" step="0.0001" min="0" value={ajustes.tipoCambioUsd ?? ''} placeholder="Ej. tipo de referencia del día"
                onChange={(x) => setAjustes({ ...ajustes, tipoCambioUsd: x.target.value ? Number(x.target.value) : undefined })}
                className="w-full rounded-lg border border-borde px-3 py-2" />
            </label>
          )}
        </div>
        {error && <div className="mt-3"><Mensaje tipo="error">{error}</Mensaje></div>}
        <div className="mt-4">
          <Boton disabled={calculando || (e.operacion.moneda !== 'USD' && !fuente.modoDemo && !ajustes.tipoCambioUsd)} onClick={async () => {
            setCalculando(true); setError(null);
            try { const r = await fuente.evaluar(e.id, ajustes); setAdvertencias(r.advertencias); alCambiar(); } catch (x) { setError((x as Error).message); } finally { setCalculando(false); }
          }}>{calculando ? 'Calculando…' : ev ? 'Volver a calcular' : 'Calcular evaluación'}</Boton>
        </div>
      </Tarjeta>

      <div className="space-y-5 lg:col-span-3">
        {advertencias.length > 0 && <Mensaje tipo="aviso"><ul className="list-disc pl-4">{advertencias.map((a) => <li key={a}>{a}</li>)}</ul></Mensaje>}
        {!ev ? <Tarjeta><Vacio>Aún no hay evaluación de riesgo.</Vacio></Tarjeta> : (
          <Tarjeta titulo={`Evaluación del ${fecha(ev.calculadoEn)}`}
            accion={<Insignia clase={NIVELES[ev.nivelAjustado ?? ev.nivelCalculado].clase}>{NIVELES[ev.nivelAjustado ?? ev.nivelCalculado].texto}</Insignia>}>
            <div className="mb-4 flex items-baseline gap-3">
              <span className="text-3xl font-semibold tabular-nums">{ev.puntajeTotal.toFixed(1)}</span>
              <span className="text-sm text-tinta-suave">puntaje ponderado · debida diligencia <strong className="text-tinta">{MEDIDAS[ev.medidas] ?? ev.medidas}</strong></span>
            </div>
            <div className="space-y-2.5">
              {Object.entries(ev.puntajes).map(([f, p]) => (
                <div key={f} className="text-sm">
                  <div className="mb-1 flex justify-between"><span>{FACTORES[f] ?? f}</span><span className="tabular-nums text-tinta-suave">{p}/100</span></div>
                  <div className="h-2 rounded-full bg-papel"><div className="h-2 rounded-full bg-marca" style={{ width: `${p}%` }} /></div>
                </div>
              ))}
            </div>
            {ev.reglas.length > 0 && (
              <div className="mt-5">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tinta-suave">Reglas aplicadas</h4>
                <ul className="space-y-2 text-sm">
                  {ev.reglas.map((r) => (
                    <li key={r.codigo} className="rounded-lg border border-borde px-3 py-2">
                      <div>{r.descripcion}</div>
                      <div className="mt-0.5 text-xs text-tinta-suave">{r.fundamento}{r.nivelMinimo ? ` · nivel mínimo ${r.nivelMinimo}` : ''}{r.medidas ? ` · ${MEDIDAS[r.medidas] ?? r.medidas}` : ''}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {ev.senales.length > 0 && (
              <div className="mt-5">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-tinta-suave">Señales de alerta</h4>
                <div className="flex flex-wrap gap-1.5">{ev.senales.map((s) => <Insignia key={s.codigo} clase="bg-medio-claro text-medio">{s.descripcion}</Insignia>)}</div>
              </div>
            )}
          </Tarjeta>
        )}
      </div>
    </div>
  );
}

function Alertas({ e, fuente, alCambiar }: { e: DetalleExpediente; fuente: Fuente; alCambiar: () => void }) {
  if (!e.alertas.length) return <Tarjeta><Vacio>No hay alertas.</Vacio></Tarjeta>;
  return <div className="space-y-4">{e.alertas.map((a) => <TarjetaAlerta key={a.id} a={a} fuente={fuente} alCambiar={alCambiar} />)}</div>;
}

function TarjetaAlerta({ a, fuente, alCambiar }: { a: DetalleExpediente['alertas'][number]; fuente: Fuente; alCambiar: () => void }) {
  const [cierre, setCierre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const urgente = a.venceEn && a.estado !== 'cerrada';
  const horas = a.venceEn ? Math.round((new Date(a.venceEn).getTime() - Date.now()) / 3_600_000) : null;
  return (
    <Tarjeta titulo={a.descripcion}
      accion={<Insignia clase={a.estado === 'cerrada' ? 'bg-slate-100 text-slate-700' : urgente ? 'bg-alto text-white' : 'bg-medio-claro text-medio'}>
        {a.estado === 'cerrada' ? 'Cerrada' : urgente ? `Vence en ${horas} h` : 'Abierta'}
      </Insignia>}>
      <p className="text-xs text-tinta-suave">{a.senal} · {fecha(a.creadoEn)}</p>
      {a.cierre && <p className="mt-2 text-sm"><span className="text-tinta-suave">Cierre: </span>{a.cierre}</p>}
      {a.estado !== 'cerrada' && (
        <div className="mt-3 space-y-3">
          <AreaTexto valor={cierre} setValor={setCierre} placeholder="Análisis y conclusión. Si procede, indique el número de RTS o la constancia de la comunicación al Ministerio Público." />
          {error && <Mensaje tipo="error">{error}</Mensaje>}
          <Boton tipo="secundario" disabled={cierre.trim().length < 20} onClick={async () => {
            try { await fuente.cerrarAlerta(a.id, cierre); alCambiar(); } catch (x) { setError((x as Error).message); }
          }}>Cerrar alerta</Boton>
        </div>
      )}
    </Tarjeta>
  );
}

const DECISIONES: { valor: NuevaDecision['tipo']; texto: string; ayuda: string }[] = [
  { valor: 'aprobar', texto: 'Aprobar la vinculación', ayuda: 'Debida diligencia completa y riesgo aceptable.' },
  { valor: 'aprobar_diferida', texto: 'Aprobar con verificación diferida', ayuda: 'Completar la verificación en un plazo máximo de 3 meses (art. 22).' },
  { valor: 'intensificar', texto: 'Solicitar debida diligencia intensificada', ayuda: 'Regresa a revisión para pedir más información.' },
  { valor: 'abrir_examen', texto: 'Abrir examen de transacción inusual', ayuda: 'Análisis para determinar si procede un RTS (arts. 29-30).' },
  { valor: 'abstener', texto: 'Abstenerse', ayuda: 'No fue posible aplicar la debida diligencia (art. 22).' },
  { valor: 'rechazar', texto: 'Rechazar la vinculación', ayuda: 'El riesgo excede lo aceptado por la política.' },
];

function Decision({ e, fuente, alCambiar }: { e: DetalleExpediente; fuente: Fuente; alCambiar: () => void }) {
  const [tipo, setTipo] = useState<NuevaDecision['tipo']>('aprobar');
  const [justificacion, setJustificacion] = useState('');
  const [condiciones, setCondiciones] = useState('');
  const [hasta, setHasta] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const maximo = new Date(); maximo.setMonth(maximo.getMonth() + 3);
  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Tarjeta titulo="Registrar decisión" className="lg:col-span-3">
        <div className="space-y-2">
          {DECISIONES.map((d) => (
            <label key={d.valor} className={`flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 text-sm ${tipo === d.valor ? 'border-marca bg-marca-claro' : 'border-borde'}`}>
              <input type="radio" checked={tipo === d.valor} onChange={() => setTipo(d.valor)} className="mt-0.5" />
              <span><span className="font-medium">{d.texto}</span><span className="block text-xs text-tinta-suave">{d.ayuda}</span></span>
            </label>
          ))}
        </div>
        {tipo === 'aprobar_diferida' && (
          <label className="mt-4 block text-sm">
            <span className="mb-1 block">Fecha límite de la verificación</span>
            <input type="date" value={hasta} max={maximo.toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })} onChange={(x) => setHasta(x.target.value)} className="rounded-lg border border-borde px-3 py-2" />
          </label>
        )}
        <div className="mt-4 space-y-3">
          <AreaTexto valor={justificacion} setValor={setJustificacion} placeholder="Justificación de la decisión" />
          {(tipo === 'aprobar_diferida' || tipo === 'intensificar') && (
            <input value={condiciones} onChange={(x) => setCondiciones(x.target.value)} placeholder="Condiciones o información adicional requerida"
              className="w-full rounded-lg border border-borde px-3 py-2 text-sm" />
          )}
          {error && <Mensaje tipo="error">{error}</Mensaje>}
          {ok && <Mensaje tipo="ok">Decisión registrada.</Mensaje>}
          <Boton tipo={tipo === 'rechazar' || tipo === 'abstener' ? 'peligro' : 'primario'} disabled={justificacion.trim().length < 20 || (tipo === 'aprobar_diferida' && !hasta)}
            onClick={async () => {
              setError(null); setOk(false);
              try {
                await fuente.decidir(e.id, { tipo, justificacion, condiciones: condiciones || undefined, verificacionDiferidaHasta: hasta || undefined });
                setOk(true); setJustificacion(''); alCambiar();
              } catch (x) { setError((x as Error).message); }
            }}>Registrar decisión</Boton>
          <p className="text-xs text-tinta-suave">Las decisiones no se pueden modificar ni borrar. Quedan en la bitácora con su autor y fecha.</p>
        </div>
      </Tarjeta>
      <Tarjeta titulo="Historial de decisiones" className="lg:col-span-2">
        {e.decisiones.length ? (
          <ol className="space-y-4">
            {e.decisiones.map((d) => (
              <li key={d.id} className="text-sm">
                <div className="font-medium capitalize">{d.tipo.replace(/_/g, ' ')}</div>
                <p className="text-tinta-suave">{d.justificacion}</p>
                {d.condiciones && <p className="text-xs text-tinta-suave">Condiciones: {d.condiciones}</p>}
                <p className="mt-1 text-xs text-tinta-suave">{d.decididoPor} · {fecha(d.decididoEn)}</p>
              </li>
            ))}
          </ol>
        ) : <Vacio>Sin decisiones.</Vacio>}
      </Tarjeta>
    </div>
  );
}

function Bitacora({ e }: { e: DetalleExpediente }) {
  const actores: Record<string, string> = { usuario: 'Usuario', cliente: 'Cliente', agente: 'Agente', sistema: 'Sistema' };
  return (
    <Tarjeta titulo="Bitácora inalterable" accion={<span className="text-xs text-tinta-suave">Cada evento está encadenado con SHA-256</span>}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-tinta-suave"><th className="pb-2 font-medium">Fecha</th><th className="pb-2 font-medium">Actor</th><th className="pb-2 font-medium">Evento</th><th className="pb-2 font-medium">Sello</th></tr></thead>
        <tbody>
          {e.bitacora.map((b) => (
            <tr key={b.id} className="border-t border-borde">
              <td className="py-2 text-tinta-suave">{fecha(b.ocurridoEn)}</td>
              <td className="py-2">{actores[b.actorTipo] ?? b.actorTipo}</td>
              <td className="py-2">{b.evento} · {b.entidad.replace(/_/g, ' ')}</td>
              <td className="py-2 font-mono text-xs text-tinta-suave">{b.hash.slice(0, 16)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Tarjeta>
  );
}
