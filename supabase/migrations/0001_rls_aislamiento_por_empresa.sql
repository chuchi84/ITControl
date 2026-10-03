-- ═══════════════════════════════════════════════════════════════════════
--  ITControl Pro — RLS: aislamiento por empresa + control de roles
-- ═══════════════════════════════════════════════════════════════════════
--  POR QUÉ EXISTE ESTE ARCHIVO
--  ---------------------------
--  El frontend (index.html) habla DIRECTO con Supabase usando la "anon key"
--  (pública, embebida en la página). No hay ningún servidor intermedio que
--  valide roles o empresa antes de leer/escribir — esa validación hoy la
--  hace solo el JavaScript del navegador (`_minRoleOk`, el "co" forzado en
--  `apiFetchWithToken`), que un atacante puede saltarse por completo abriendo
--  la consola del navegador y llamando a Supabase directamente.
--
--  La ÚNICA barrera real son las políticas RLS (Row Level Security) de
--  Postgres, que se evalúan en la base de datos sin importar qué JS use el
--  cliente. Este archivo las define, replicando exactamente las reglas que
--  tenía el backend original de Apps Script (legacy/Code.gs):
--    - Cada usuario solo ve/edita registros de SU empresa (columna `co`),
--      salvo rol 'titular' / 'super_admin' (o co = 'todas') que ve todas.
--    - Jerarquía de roles: lector(20) < tecnico(40) < admin_empresa(60) <
--      titular/super_admin(100).
--    - Un admin_empresa nunca puede asignarse a sí mismo (ni a otros) el rol
--      super_admin/titular, ni la empresa 'todas' (anti-escalada).
--
--  CÓMO APLICAR
--  ------------
--  1. Supabase Dashboard → tu proyecto → SQL Editor → pega este archivo
--     completo → Run.
--  2. Verifica con las consultas de la sección "VERIFICACIÓN" al final.
--  3. Repite la prueba manual descrita en supabase/README.md (loguéate con
--     un usuario de rol bajo y prueba acceder a datos de otra empresa desde
--     la consola del navegador).
--
--  Es idempotente: se puede volver a ejecutar sin romper nada (usa
--  CREATE OR REPLACE / DROP POLICY IF EXISTS en todos lados).
-- ═══════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────
-- 1) FUNCIONES DE IDENTIDAD
--    SECURITY DEFINER: corren con los privilegios de quien las creó (el
--    dueño de la tabla, que por defecto puede saltarse RLS). Así evitamos
--    la recursión infinita de "para saber tu rol hay que leer `usuarios`,
--    pero leer `usuarios` requiere saber tu rol".
-- ───────────────────────────────────────────────────────────────────────

create or replace function public.app_usuario()
returns table(email text, rol text, co text, activo boolean)
language sql
security definer
set search_path = public
stable
as $$
  select u.email, u.rol, u.co, u.activo
  from usuarios u
  where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.app_rol()
returns text language sql security definer set search_path = public stable as $$
  select rol from public.app_usuario();
$$;

create or replace function public.app_co()
returns text language sql security definer set search_path = public stable as $$
  select co from public.app_usuario();
$$;

create or replace function public.app_activo()
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select activo from public.app_usuario()), false);
$$;

-- scope_all: ve TODAS las empresas (titular / super_admin / co = 'todas')
create or replace function public.app_scope_all()
returns boolean language sql security definer set search_path = public stable as $$
  select lower(coalesce((select rol from public.app_usuario()), '')) in ('titular','super_admin')
      or lower(coalesce((select co  from public.app_usuario()), '')) = 'todas';
$$;

-- Nivel numérico del rol (mismo mapeo que ROLE_LEVEL en legacy/Code.gs)
create or replace function public.app_role_level()
returns int language sql security definer set search_path = public stable as $$
  select case lower(coalesce((select rol from public.app_usuario()), ''))
    when 'titular'          then 100
    when 'super_admin'      then 100
    when 'admin'            then 60
    when 'admin_empresa'    then 60
    when 'tecnico'          then 40
    when 'lector'           then 20
    when 'lectura'          then 20
    when 'lectura_empresa'  then 20
    else 0
  end;
$$;

-- Acceso de LECTURA/ESCRITURA permitido a una empresa puntual.
create or replace function public.app_can_access_co(target_co text)
returns boolean language sql security definer set search_path = public stable as $$
  select public.app_activo() and (
    public.app_scope_all() or coalesce(target_co, '') = coalesce(public.app_co(), '*nunca*')
  );
$$;

grant execute on function public.app_usuario()        to authenticated;
grant execute on function public.app_rol()             to authenticated;
grant execute on function public.app_co()              to authenticated;
grant execute on function public.app_activo()          to authenticated;
grant execute on function public.app_scope_all()        to authenticated;
grant execute on function public.app_role_level()       to authenticated;
grant execute on function public.app_can_access_co(text) to authenticated;


-- ───────────────────────────────────────────────────────────────────────
-- 2) TABLA EMPRESAS (clave = la propia empresa; no tiene columna "co")
-- ───────────────────────────────────────────────────────────────────────
alter table public.empresas enable row level security;

drop policy if exists empresas_select on public.empresas;
create policy empresas_select on public.empresas for select
  using ( app_activo() and (app_scope_all() or id = app_co()) );

-- Solo el titular/super_admin puede CREAR empresas nuevas.
drop policy if exists empresas_insert on public.empresas;
create policy empresas_insert on public.empresas for insert
  with check ( app_scope_all() );

-- Un admin_empresa puede editar SU propia empresa; el titular, cualquiera.
drop policy if exists empresas_update on public.empresas;
create policy empresas_update on public.empresas for update
  using ( app_activo() and (app_scope_all() or id = app_co()) )
  with check ( app_activo() and app_role_level() >= 60 and (app_scope_all() or id = app_co()) );

-- Borrar una empresa (y en cascada sus datos) solo el titular.
drop policy if exists empresas_delete on public.empresas;
create policy empresas_delete on public.empresas for delete
  using ( app_scope_all() and app_role_level() >= 100 );


-- ───────────────────────────────────────────────────────────────────────
-- 3) TABLAS OPERATIVAS CON COLUMNA "co"
--    Patrón genérico: SELECT con rol lector+; INSERT/UPDATE con rol
--    tecnico+; DELETE con rol admin_empresa+ (salvo que se indique otra
--    cosa). Todas exigen pertenecer a la empresa del registro, salvo
--    scope_all.
-- ───────────────────────────────────────────────────────────────────────

-- Genera las 4 políticas estándar para una tabla con columna "co".
-- (Se deja expandido tabla por tabla para que cada política quede visible
-- y auditable individualmente en el dashboard de Supabase; no se usa un
-- DO $$ loop a propósito.)

-- equipos ------------------------------------------------------------
alter table public.equipos enable row level security;
drop policy if exists equipos_select on public.equipos;
create policy equipos_select on public.equipos for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists equipos_insert on public.equipos;
create policy equipos_insert on public.equipos for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists equipos_update on public.equipos;
create policy equipos_update on public.equipos for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists equipos_delete on public.equipos;
create policy equipos_delete on public.equipos for delete
  using ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );

-- compras --------------------------------------------------------------
alter table public.compras enable row level security;
drop policy if exists compras_select on public.compras;
create policy compras_select on public.compras for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists compras_insert on public.compras;
create policy compras_insert on public.compras for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists compras_update on public.compras;
create policy compras_update on public.compras for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists compras_delete on public.compras;
create policy compras_delete on public.compras for delete
  using ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );

-- historial --------------------------------------------------------------
alter table public.historial enable row level security;
drop policy if exists historial_select on public.historial;
create policy historial_select on public.historial for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists historial_insert on public.historial;
create policy historial_insert on public.historial for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists historial_update on public.historial;
create policy historial_update on public.historial for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists historial_delete on public.historial;
create policy historial_delete on public.historial for delete
  using ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );

-- asignaciones --------------------------------------------------------------
alter table public.asignaciones enable row level security;
drop policy if exists asignaciones_select on public.asignaciones;
create policy asignaciones_select on public.asignaciones for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists asignaciones_insert on public.asignaciones;
create policy asignaciones_insert on public.asignaciones for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists asignaciones_update on public.asignaciones;
create policy asignaciones_update on public.asignaciones for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists asignaciones_delete on public.asignaciones;
create policy asignaciones_delete on public.asignaciones for delete
  using ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );

-- licencias --------------------------------------------------------------
alter table public.licencias enable row level security;
drop policy if exists licencias_select on public.licencias;
create policy licencias_select on public.licencias for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists licencias_insert on public.licencias;
create policy licencias_insert on public.licencias for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists licencias_update on public.licencias;
create policy licencias_update on public.licencias for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists licencias_delete on public.licencias;
create policy licencias_delete on public.licencias for delete
  using ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );

-- tareas --------------------------------------------------------------
alter table public.tareas enable row level security;
drop policy if exists tareas_select on public.tareas;
create policy tareas_select on public.tareas for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists tareas_insert on public.tareas;
create policy tareas_insert on public.tareas for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists tareas_update on public.tareas;
create policy tareas_update on public.tareas for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists tareas_delete on public.tareas;
create policy tareas_delete on public.tareas for delete
  using ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );

-- personas --------------------------------------------------------------
alter table public.personas enable row level security;
drop policy if exists personas_select on public.personas;
create policy personas_select on public.personas for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists personas_insert on public.personas;
create policy personas_insert on public.personas for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists personas_update on public.personas;
create policy personas_update on public.personas for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists personas_delete on public.personas;
create policy personas_delete on public.personas for delete
  using ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );

-- bajas --------------------------------------------------------------
-- (Solo hay acción "baja_add" en la app; igual se protege update/delete
-- por si se usa desde el SQL editor o se agrega esa acción después.)
alter table public.bajas enable row level security;
drop policy if exists bajas_select on public.bajas;
create policy bajas_select on public.bajas for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists bajas_insert on public.bajas;
create policy bajas_insert on public.bajas for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists bajas_update on public.bajas;
create policy bajas_update on public.bajas for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );
drop policy if exists bajas_delete on public.bajas;
create policy bajas_delete on public.bajas for delete
  using ( app_role_level() >= 100 and app_scope_all() );

-- programas_mant --------------------------------------------------------------
alter table public.programas_mant enable row level security;
drop policy if exists programas_mant_select on public.programas_mant;
create policy programas_mant_select on public.programas_mant for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists programas_mant_insert on public.programas_mant;
create policy programas_mant_insert on public.programas_mant for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists programas_mant_update on public.programas_mant;
create policy programas_mant_update on public.programas_mant for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists programas_mant_delete on public.programas_mant;
create policy programas_mant_delete on public.programas_mant for delete
  using ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );

-- accesorios --------------------------------------------------------------
alter table public.accesorios enable row level security;
drop policy if exists accesorios_select on public.accesorios;
create policy accesorios_select on public.accesorios for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists accesorios_insert on public.accesorios;
create policy accesorios_insert on public.accesorios for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists accesorios_update on public.accesorios;
create policy accesorios_update on public.accesorios for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists accesorios_delete on public.accesorios;
create policy accesorios_delete on public.accesorios for delete
  using ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );

-- tinta_recargas --------------------------------------------------------------
alter table public.tinta_recargas enable row level security;
drop policy if exists tinta_recargas_select on public.tinta_recargas;
create policy tinta_recargas_select on public.tinta_recargas for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists tinta_recargas_insert on public.tinta_recargas;
create policy tinta_recargas_insert on public.tinta_recargas for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists tinta_recargas_update on public.tinta_recargas;
create policy tinta_recargas_update on public.tinta_recargas for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists tinta_recargas_delete on public.tinta_recargas;
create policy tinta_recargas_delete on public.tinta_recargas for delete
  using ( app_role_level() >= 60 and (app_scope_all() or co = app_co()) );

-- sesiones_inventario --------------------------------------------------------------
-- (Solo add/edit en la app; sin delete expuesto → sin política de delete,
-- lo que la deniega por defecto.)
alter table public.sesiones_inventario enable row level security;
drop policy if exists sesiones_inventario_select on public.sesiones_inventario;
create policy sesiones_inventario_select on public.sesiones_inventario for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists sesiones_inventario_insert on public.sesiones_inventario;
create policy sesiones_inventario_insert on public.sesiones_inventario for insert
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists sesiones_inventario_update on public.sesiones_inventario;
create policy sesiones_inventario_update on public.sesiones_inventario for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );

-- solicitudes_soporte --------------------------------------------------------------
-- El portal público (anónimo, sin login) inserta tickets vía la función
-- `crear_ticket_publico` (SECURITY DEFINER) — por eso NO hay política de
-- INSERT para el rol anon aquí: la función se la salta a propósito, con su
-- propia validación de clave y rate limiting. Estas políticas son solo
-- para el personal autenticado (staff) que gestiona los tickets.
-- Sin delete expuesto en la app → sin política de delete (denegado).
alter table public.solicitudes_soporte enable row level security;
drop policy if exists solicitudes_soporte_select on public.solicitudes_soporte;
create policy solicitudes_soporte_select on public.solicitudes_soporte for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );
drop policy if exists solicitudes_soporte_insert on public.solicitudes_soporte;
create policy solicitudes_soporte_insert on public.solicitudes_soporte for insert
  to authenticated
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );
drop policy if exists solicitudes_soporte_update on public.solicitudes_soporte;
create policy solicitudes_soporte_update on public.solicitudes_soporte for update
  to authenticated
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );

-- log_auditoria --------------------------------------------------------------
-- Inmutable a propósito: sin política de UPDATE ni DELETE (un log que se
-- puede editar o borrar no sirve como auditoría).
alter table public.log_auditoria enable row level security;
drop policy if exists log_auditoria_select on public.log_auditoria;
create policy log_auditoria_select on public.log_auditoria for select
  using ( app_activo() and app_role_level() >= 60 and (app_scope_all() or co = app_co()) );
drop policy if exists log_auditoria_insert on public.log_auditoria;
create policy log_auditoria_insert on public.log_auditoria for insert
  to authenticated
  with check ( app_role_level() >= 40 and (app_scope_all() or co = app_co()) );


-- ───────────────────────────────────────────────────────────────────────
-- 4) TABLA USUARIOS (caso especial: anti-escalada de privilegios)
-- ───────────────────────────────────────────────────────────────────────
alter table public.usuarios enable row level security;

-- Cualquier usuario activo ve el listado de SU empresa (igual que
-- `loadAll` en legacy/Code.gs: hasta un 'lector' ve la lista, sin password).
drop policy if exists usuarios_select on public.usuarios;
create policy usuarios_select on public.usuarios for select
  using ( app_activo() and (app_scope_all() or co = app_co()) );

-- Crear/editar usuarios: admin_empresa+, dentro de su propia empresa, y
-- JAMÁS asignando rol super_admin/titular ni co='todas' si no es scope_all.
drop policy if exists usuarios_insert on public.usuarios;
create policy usuarios_insert on public.usuarios for insert
  with check (
    app_role_level() >= 60
    and (app_scope_all() or (co = app_co() and lower(coalesce(rol,'')) not in ('titular','super_admin') and lower(coalesce(co,'')) <> 'todas'))
  );

drop policy if exists usuarios_update on public.usuarios;
create policy usuarios_update on public.usuarios for update
  using ( app_activo() and (app_scope_all() or co = app_co()) )
  with check (
    app_role_level() >= 60
    and (app_scope_all() or (co = app_co() and lower(coalesce(rol,'')) not in ('titular','super_admin') and lower(coalesce(co,'')) <> 'todas'))
  );

-- Borrar: admin_empresa+, dentro de su empresa, nunca a sí mismo.
drop policy if exists usuarios_delete on public.usuarios;
create policy usuarios_delete on public.usuarios for delete
  using (
    app_role_level() >= 60
    and (app_scope_all() or co = app_co())
    and lower(email) <> lower(coalesce(auth.jwt() ->> 'email', '*nunca*'))
  );


-- ───────────────────────────────────────────────────────────────────────
-- 5) STORAGE — bucket "adjuntos" (documentos de compras)
--    Rutas con forma  <co>/<compra_id>/<archivo>  (ver _supaAdjSubir en
--    index.html). Sin esto, CUALQUIER usuario autenticado podría leer o
--    sobrescribir adjuntos de OTRAS empresas con solo adivinar/enumerar
--    el "co" en la ruta.
-- ───────────────────────────────────────────────────────────────────────
drop policy if exists adjuntos_select on storage.objects;
create policy adjuntos_select on storage.objects for select
  using (
    bucket_id = 'adjuntos'
    and app_role_level() >= 40
    and (app_scope_all() or (storage.foldername(name))[1] = app_co())
  );

drop policy if exists adjuntos_insert on storage.objects;
create policy adjuntos_insert on storage.objects for insert
  with check (
    bucket_id = 'adjuntos'
    and app_role_level() >= 40
    and (app_scope_all() or (storage.foldername(name))[1] = app_co())
  );

drop policy if exists adjuntos_update on storage.objects;
create policy adjuntos_update on storage.objects for update
  using (
    bucket_id = 'adjuntos'
    and app_role_level() >= 40
    and (app_scope_all() or (storage.foldername(name))[1] = app_co())
  );

drop policy if exists adjuntos_delete on storage.objects;
create policy adjuntos_delete on storage.objects for delete
  using (
    bucket_id = 'adjuntos'
    and app_role_level() >= 40
    and (app_scope_all() or (storage.foldername(name))[1] = app_co())
  );


-- ═══════════════════════════════════════════════════════════════════════
--  VERIFICACIÓN (ejecutar después, cada una por separado, y leer el
--  resultado — no basta con que no tiren error)
-- ═══════════════════════════════════════════════════════════════════════

-- A) ¿Quedó RLS habilitado en todas las tablas de la app? (debe dar "true"
--    en TODAS las filas; si alguna tabla no aparece acá, falta agregarla)
-- select relname, relrowsecurity
-- from pg_class
-- where relnamespace = 'public'::regnamespace
--   and relname in (
--     'empresas','equipos','compras','historial','asignaciones','licencias',
--     'tareas','personas','bajas','programas_mant','solicitudes_soporte',
--     'sesiones_inventario','accesorios','usuarios','tinta_recargas','log_auditoria'
--   );

-- B) Lista de políticas creadas, para revisar a ojo:
-- select schemaname, tablename, policyname, cmd from pg_policies
-- where schemaname in ('public','storage') order by tablename, cmd;

-- C) La prueba que realmente importa: repetirla como se describe en
--    supabase/README.md, logueado como un usuario de rol bajo, desde la
--    consola del navegador en itcontrol.kendal.cl (NO desde el SQL editor,
--    que corre como superusuario y se saltaría RLS igual).
