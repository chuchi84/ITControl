# Legacy — Backend Google Apps Script

`Code.gs` fue el backend original de ITControl Pro (Google Sheets + Apps
Script). **Ya no es el backend en uso**: hoy la app corre 100% sobre
Supabase (ver `SUPABASE_URL` / `SUPABASE_ANON_KEY` en `index.html` y las
políticas en `../supabase/migrations/`).

Se conserva acá solo como referencia histórica, porque su diseño de roles
(`ACTION_MIN_ROLE`, `canAccessCo`, aislamiento por empresa) fue la base para
las políticas RLS actuales de Supabase.

## Si todavía está desplegado como Web App

Si en algún momento este script se publicó como Web App en Apps Script
(Extensiones → Apps Script → Implementar), **despublícalo**:

1. Abre el proyecto de Apps Script vinculado a la planilla
   (`1MXWlVfOETOXvaqxI7evb3_ic0v3w0d4s0udogUhJdkU`).
2. Implementar → Administrar implementaciones.
3. Archiva o elimina la implementación de tipo "Aplicación web".

Mantener una Web App vieja publicada, aunque nadie la use desde el
frontend, es una superficie de ataque innecesaria (cualquiera que tenga la
URL puede seguir llamándola).
