-- ═══════════════════════════════════════════════════════════════════════
--  reset_total() — versión con guardia de rol server-side
-- ═══════════════════════════════════════════════════════════════════════
--  ⚠️  ESTE ARCHIVO REEMPLAZA LA FUNCIÓN `reset_total()` ACTUAL.
--
--  Hallazgo crítico: en index.html, `_supaResetTotal()` solo hace
--  `sb.rpc('reset_total')` sin ningún chequeo de rol en el JS (el botón de
--  la UI sí valida "_esTitularOSuper()", pero eso es cosmético — cualquiera
--  puede llamar `apiFetch('reset_total', {})` desde la consola del
--  navegador). Si `reset_total()` en Supabase no vuelve a validar el rol
--  del que llama, CUALQUIER usuario autenticado (hasta un 'lectura_empresa')
--  puede borrar TODOS los datos de TODAS las empresas.
--
--  ANTES DE CORRER ESTE ARCHIVO:
--  ------------------------------
--  1. Mira la definición actual con:
--       select pg_get_functiondef('public.reset_total'::regproc);
--  2. Compárala con la de abajo. Si tu versión actual hace algo distinto
--     (por ejemplo, también limpia una tabla que no está acá, o conserva
--     algo que acá se borra), AVISA — ajustamos este archivo antes de
--     aplicarlo. No lo corras a ciegas sobre una base con datos reales
--     sin comparar.
--  3. Idealmente, prueba primero en un proyecto de Supabase de staging.
--
--  QUÉ HACE ESTA VERSIÓN (según el texto de la UI en index.html:
--  "borra TODO de TODAS las empresas: equipos, compras, asignaciones,
--  personas, licencias, tareas, mantenciones, control de tinta, tickets
--  de soporte, historial, inventarios, accesorios, bajas y logs. También
--  borra todos los usuarios, excepto el tuyo. Los contadores vuelven a
--  cero."):
--    1. Verifica que quien llama sea 'titular' o 'super_admin' — si no,
--       lanza una excepción y no borra NADA.
--    2. Vacía las tablas operativas de todas las empresas.
--    3. Borra todos los usuarios EXCEPTO el que ejecuta la acción.
--    4. Resetea los contadores en `empresas` (no borra las empresas).
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.reset_total()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _mi_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  _mi_rol   text;
begin
  select lower(coalesce(rol, '')) into _mi_rol
  from usuarios
  where lower(email) = _mi_email
  limit 1;

  if _mi_rol is null or _mi_rol not in ('titular', 'super_admin') then
    raise exception 'Permiso denegado: reset_total() requiere rol titular o super_admin (rol actual: %)', coalesce(_mi_rol, 'ninguno');
  end if;

  delete from equipos;
  delete from compras;
  delete from historial;
  delete from asignaciones;
  delete from licencias;
  delete from tareas;
  delete from bajas;
  delete from programas_mant;
  delete from solicitudes_soporte;
  delete from sesiones_inventario;
  delete from accesorios;
  delete from personas;
  delete from tinta_recargas;
  delete from log_auditoria;

  -- Todos los usuarios excepto quien ejecuta el reset (para no perder el acceso).
  delete from usuarios where lower(email) <> _mi_email;

  -- Contadores de cada empresa vuelven a cero; no se borran las empresas.
  update empresas set
    counter = 0,
    "counterCompra" = 0,
    "counterCompraAnio" = 0;
end;
$$;

-- Solo usuarios autenticados pueden intentar llamarla (la función igual
-- revisa el rol por dentro y rechaza a quien no sea titular/super_admin).
revoke all on function public.reset_total() from public, anon;
grant execute on function public.reset_total() to authenticated;
