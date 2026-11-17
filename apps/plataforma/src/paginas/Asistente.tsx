import { useState } from 'react';
import { Boton, Campo, Mensaje, Tarjeta } from '../componentes/ui';
import type { Fuente, NuevaOrganizacion, Rol } from '../fuente/tipos';
import { colorValido, correoValido, nitConFormato, nitVerificadorCorrecto, subdominioValido, sugerirSubdominio } from '../validacion';

const ACTIVIDADES: [string, string][] = [
  ['inmobiliaria', 'Inmobiliaria (promoción, intermediación o compraventa de inmuebles)'],
  ['vehiculos', 'Compraventa de vehículos'],
  ['arte_joyas_metales', 'Obras de arte, joyas y metales preciosos'],
  ['blindaje', 'Blindaje'],
  ['servicios_societarios', 'Servicios societarios y fiduciarios'],
  ['loterias_rifas', 'Loterías y rifas'],
  ['activos_virtuales', 'Proveedores de activos virtuales'],
];

const ROLES: [Rol, string][] = [
  ['oficial', 'Oficial de cumplimiento'],
  ['oficial_suplente', 'Oficial suplente'],
  ['administrador', 'Administrador'],
  ['ejecutivo', 'Ejecutivo comercial'],
  ['auditor', 'Auditor (solo lectura)'],
];

const PASOS = ['Datos legales', 'Marca y dirección', 'Usuarios', 'Revisión'];

export function Asistente({ fuente, terminar, cancelar }: { fuente: Fuente; terminar: (id: string) => void; cancelar: () => void }) {
  const [paso, setPaso] = useState(0);
  const [d, setD] = useState({
    nombreLegal: '', nombreComercial: '', nit: '', actividad: 'inmobiliaria', inscripcionIve: '',
    nombreVisible: '', colorPrimario: '#0f5e5a', logoUrl: '', subdominio: '',
  });
  const [usuarios, setUsuarios] = useState<{ correo: string; rol: Rol }[]>([{ correo: '', rol: 'oficial' }]);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [resultado, setResultado] = useState<{ id: string; advertencias: string[]; fallidos: string[] } | null>(null);
  const cambiar = (k: keyof typeof d) => (v: string) => setD({ ...d, [k]: v });

  const errores = {
    nombreLegal: d.nombreLegal && d.nombreLegal.trim().length < 3 ? 'Muy corto' : null,
    nit: d.nit && !nitConFormato(d.nit) ? 'Formato: dígitos, guion opcional y dígito verificador (número o K)' : null,
    subdominio: d.subdominio && !subdominioValido(d.subdominio) ? '3 a 42 caracteres: minúsculas, números y guiones; no puede ser reservado' : null,
    color: !colorValido(d.colorPrimario) ? 'Formato #RRGGBB' : null,
    logo: d.logoUrl && !d.logoUrl.startsWith('https://') ? 'Debe empezar con https://' : null,
  };
  const usuariosValidos = usuarios.filter((u) => u.correo.trim());
  const pasoValido = [
    d.nombreLegal.trim().length >= 3 && d.nombreComercial.trim().length >= 2 && nitConFormato(d.nit),
    d.nombreVisible.trim().length >= 2 && subdominioValido(d.subdominio) && !errores.color && !errores.logo,
    usuariosValidos.every((u) => correoValido(u.correo)) && usuariosValidos.some((u) => u.rol === 'oficial'),
    true,
  ][paso];

  const avanzar = () => {
    if (paso === 0 && !d.nombreVisible) setD((x) => ({ ...x, nombreVisible: x.nombreComercial, subdominio: x.subdominio || sugerirSubdominio(x.nombreComercial) }));
    setPaso(paso + 1);
  };

  const crear = async () => {
    setCreando(true); setError(null);
    try {
      const nueva: NuevaOrganizacion = {
        nombreLegal: d.nombreLegal.trim(), nombreComercial: d.nombreComercial.trim(), nit: d.nit.trim(), actividad: d.actividad,
        inscripcionIve: d.inscripcionIve.trim() || undefined, subdominio: d.subdominio,
        marca: { nombreVisible: d.nombreVisible.trim(), colorPrimario: d.colorPrimario, logoUrl: d.logoUrl.trim() || undefined },
      };
      const r = await fuente.crearOrganizacion(nueva);
      const fallidos: string[] = [];
      for (const u of usuariosValidos) {
        try { await fuente.invitarUsuario(r.id, u.correo.trim(), u.rol); } catch (x) { fallidos.push(`${u.correo}: ${(x as Error).message}`); }
      }
      setResultado({ ...r, fallidos });
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setCreando(false);
    }
  };

  if (resultado) {
    return (
      <Tarjeta titulo="Organización creada">
        <div className="space-y-4 text-sm">
          <Mensaje tipo="ok">Se creó {d.nombreComercial} con su metodología base pendiente de aprobación y se enviaron las invitaciones.</Mensaje>
          {resultado.advertencias.length > 0 && <Mensaje tipo="aviso"><ul className="list-disc pl-4">{resultado.advertencias.map((a) => <li key={a}>{a}</li>)}</ul></Mensaje>}
          {resultado.fallidos.length > 0 && <Mensaje tipo="error"><ul className="list-disc pl-4">{resultado.fallidos.map((a) => <li key={a}>{a}</li>)}</ul></Mensaje>}
          <p className="text-tinta-suave">Siguientes pasos: registrar la aprobación de la metodología por el órgano de dirección y conectar el número de WhatsApp.</p>
          <Boton onClick={() => terminar(resultado.id)}>Ir a la organización</Boton>
        </div>
      </Tarjeta>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <button onClick={cancelar} className="text-sm text-tinta-suave hover:text-tinta">← Organizaciones</button>
        <h1 className="mt-2 text-2xl font-semibold">Nueva organización</h1>
      </div>
      <ol className="flex gap-2 text-sm">
        {PASOS.map((p, i) => (
          <li key={p} className={`flex-1 rounded-lg border px-3 py-2 ${i === paso ? 'border-marca bg-marca-claro font-medium text-marca' : i < paso ? 'border-borde bg-white text-bajo' : 'border-borde bg-white text-tinta-suave'}`}>
            {i + 1}. {p}
          </li>
        ))}
      </ol>

      <Tarjeta>
        <div className="space-y-4">
          {paso === 0 && (
            <>
              <Campo etiqueta="Razón social" valor={d.nombreLegal} setValor={cambiar('nombreLegal')} placeholder="Inmuebles del Valle, S.A." error={errores.nombreLegal} />
              <Campo etiqueta="Nombre comercial" valor={d.nombreComercial} setValor={cambiar('nombreComercial')} placeholder="Inmuebles del Valle" />
              <Campo etiqueta="NIT" valor={d.nit} setValor={cambiar('nit')} placeholder="1234567-8" error={errores.nit}
                ayuda={d.nit && nitConFormato(d.nit) && !nitVerificadorCorrecto(d.nit) ? 'El dígito verificador no cuadra; confírmelo con la constancia de RTU.' : undefined} />
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Actividad (art. 3)</span>
                <select value={d.actividad} onChange={(e) => cambiar('actividad')(e.target.value)} className="w-full rounded-lg border border-borde px-3 py-2">
                  {ACTIVIDADES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
                {d.actividad !== 'inmobiliaria' && <span className="mt-1 block text-xs text-medio">La metodología base es la de inmobiliarias: deberá ajustarse antes de aprobarla.</span>}
              </label>
              <Campo etiqueta="Número de inscripción ante la IVE (opcional por ahora)" valor={d.inscripcionIve} setValor={cambiar('inscripcionIve')}
                ayuda="Art. 5: sin inscripción la organización no queda lista para operar." />
            </>
          )}
          {paso === 1 && (
            <>
              <Campo etiqueta="Nombre que verá el cliente" valor={d.nombreVisible} setValor={cambiar('nombreVisible')} />
              <div className="grid grid-cols-[auto_1fr] items-end gap-3">
                <input type="color" value={colorValido(d.colorPrimario) ? d.colorPrimario : '#0f5e5a'} onChange={(e) => cambiar('colorPrimario')(e.target.value)}
                  className="h-10 w-12 cursor-pointer rounded border border-borde" aria-label="Color primario" />
                <Campo etiqueta="Color primario" valor={d.colorPrimario} setValor={cambiar('colorPrimario')} error={errores.color} />
              </div>
              <Campo etiqueta="Logo (URL https, opcional)" valor={d.logoUrl} setValor={cambiar('logoUrl')} error={errores.logo} />
              <Campo etiqueta="Subdominio" valor={d.subdominio} setValor={(v) => cambiar('subdominio')(v.toLowerCase())} error={errores.subdominio}
                ayuda={d.subdominio && subdominioValido(d.subdominio) ? `Enlace del cliente: https://${d.subdominio}.<dominio de la plataforma>/e/…` : undefined} />
              <div className="rounded-lg border border-borde p-4">
                <div className="mb-2 text-xs text-tinta-suave">Vista previa del encabezado del portal</div>
                <div className="flex items-center gap-3 rounded-lg px-4 py-3 text-white" style={{ background: colorValido(d.colorPrimario) ? d.colorPrimario : '#0f5e5a' }}>
                  <span className="flex h-8 w-8 items-center justify-center rounded bg-white/20 text-xs font-bold">{(d.nombreVisible || '?').slice(0, 2).toUpperCase()}</span>
                  <span className="font-medium">{d.nombreVisible || 'Nombre visible'}</span>
                </div>
              </div>
            </>
          )}
          {paso === 2 && (
            <>
              <p className="text-sm text-tinta-suave">Se enviará una invitación por correo. Debe haber al menos un oficial de cumplimiento (arts. 16 y 18).</p>
              {usuarios.map((u, i) => (
                <div key={i} className="grid grid-cols-[1fr_14rem_auto] items-end gap-3">
                  <Campo etiqueta={i === 0 ? 'Correo' : ''} valor={u.correo} setValor={(v) => setUsuarios(usuarios.map((x, j) => (j === i ? { ...x, correo: v } : x)))}
                    error={u.correo && !correoValido(u.correo) ? 'Correo inválido' : null} />
                  <select value={u.rol} onChange={(e) => setUsuarios(usuarios.map((x, j) => (j === i ? { ...x, rol: e.target.value as Rol } : x)))}
                    className="h-[42px] rounded-lg border border-borde px-3 text-sm">
                    {ROLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                  <button onClick={() => setUsuarios(usuarios.filter((_, j) => j !== i))} disabled={usuarios.length === 1}
                    className="h-[42px] px-2 text-sm text-tinta-suave hover:text-alto disabled:opacity-30">Quitar</button>
                </div>
              ))}
              <button onClick={() => setUsuarios([...usuarios, { correo: '', rol: 'ejecutivo' }])} className="text-sm font-medium text-marca">+ Agregar usuario</button>
              {!usuariosValidos.some((u) => u.rol === 'oficial') && <Mensaje tipo="aviso">Falta un usuario con rol de oficial de cumplimiento.</Mensaje>}
            </>
          )}
          {paso === 3 && (
            <dl className="space-y-2 text-sm">
              {[
                ['Razón social', d.nombreLegal], ['Nombre comercial', d.nombreComercial], ['NIT', d.nit],
                ['Actividad', ACTIVIDADES.find(([v]) => v === d.actividad)?.[1] ?? d.actividad],
                ['Inscripción IVE', d.inscripcionIve || 'Pendiente'], ['Subdominio', d.subdominio],
                ['Usuarios', usuariosValidos.map((u) => `${u.correo} (${ROLES.find(([r]) => r === u.rol)?.[1]})`).join(', ')],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-3 gap-3"><dt className="text-tinta-suave">{k}</dt><dd className="col-span-2">{v}</dd></div>
              ))}
              <div className="pt-2"><Mensaje tipo="aviso">Se creará la metodología de riesgo base <strong>sin aprobar</strong>. El órgano de dirección debe aprobarla (art. 8) antes de evaluar clientes.</Mensaje></div>
            </dl>
          )}
          {error && <Mensaje tipo="error">{error}</Mensaje>}
          <div className="flex justify-between pt-2">
            <Boton tipo="secundario" onClick={() => (paso ? setPaso(paso - 1) : cancelar())}>{paso ? 'Anterior' : 'Cancelar'}</Boton>
            {paso < 3
              ? <Boton disabled={!pasoValido} onClick={avanzar}>Siguiente</Boton>
              : <Boton disabled={creando} onClick={crear}>{creando ? 'Creando…' : 'Crear organización'}</Boton>}
          </div>
        </div>
      </Tarjeta>
    </div>
  );
}
