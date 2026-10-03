# Seguridad de la base de datos (Supabase RLS)

El frontend habla directo con Supabase usando la clave pública (`anon key`).
Eso es normal y seguro **solo si** Postgres tiene políticas RLS que
repliquen el control de acceso por empresa y por rol. Antes de este cambio,
esas políticas no estaban versionadas en el repo y no se pudieron verificar
desde acá — hay que aplicarlas manualmente.

## Cómo aplicar

1. Entra a tu proyecto en [supabase.com](https://supabase.com/dashboard) →
   **SQL Editor**.
2. Pega y ejecuta **`migrations/0001_rls_aislamiento_por_empresa.sql`**
   completo. Es idempotente (se puede correr más de una vez sin romper
   nada).
3. **Antes** de correr `migrations/0002_reset_total_seguro.sql`, lee su
   cabecera — reemplaza la función `reset_total()` actual, así que primero
   compara con lo que ya tienes:
   ```sql
   select pg_get_functiondef('public.reset_total'::regproc);
   ```
   Si coincide en lo esencial (borra lo mismo), aplica el archivo. Si hace
   algo distinto, avísame y lo ajustamos antes de aplicarlo.
4. Revisa también a mano las funciones del portal público
   (`crear_ticket_publico`, `verificar_clave_soporte`,
   `consultar_ticket_publico`, `empresa_publica_info`): confirma que
   `consultar_ticket_publico` exige que coincidan **ticket + email + co**
   (no solo el ticket), y que `verificar_clave_soporte` tenga algún límite
   de intentos (para que no se pueda adivinar la clave por fuerza bruta).
   No las toqué porque no tengo su definición actual.

## Verificación — la prueba que realmente importa

Ejecutar las políticas no basta; hay que probarlas como lo haría un
atacante. **Esta prueba se hace logueado en itcontrol.kendal.cl, desde la
consola del navegador (F12) — nunca desde el SQL Editor de Supabase, que
corre como superusuario y se saltaría RLS igual.**

1. Crea (o pide prestado) un usuario de rol bajo, por ejemplo
   `lectura_empresa` de una empresa cualquiera, y logueate con él en el
   sitio.
2. Abre la consola del navegador y prueba, una por una:

   ```js
   // 1) ¿Puedo ver datos de OTRA empresa? (debería devolver [] o filas
   //    vacías, nunca filas de otra empresa)
   await sb.from('equipos').select('*').neq('co', currentUser.co)

   // 2) ¿Puedo auto-ascenderme a super_admin? (debe fallar con un error
   //    de política, "new row violates row-level security policy")
   await sb.from('usuarios').update({ rol: 'super_admin' }).eq('id', currentUser.usuario_id)

   // 3) ¿Puedo borrar un equipo siendo solo lector? (debe fallar)
   await sb.from('equipos').delete().eq('id', 'CUALQUIER_ID')

   // 4) ¿Puedo borrar TODO? (debe fallar con "Permiso denegado")
   await sb.rpc('reset_total')

   // 5) ¿Puedo leer un adjunto de otra empresa adivinando la ruta?
   await sb.storage.from('adjuntos').list('OTRA_EMPRESA_ID')
   ```

3. Si **cualquiera** de esas pruebas tiene éxito (no da error), las
   políticas no están bien aplicadas — revisa el paso 2 del SQL antes de
   seguir usando la app en producción con datos reales.
4. Repite el mismo test con un usuario `admin_empresa` real: debería poder
   gestionar su propia empresa sin problema, y seguir fallando en los
   puntos 1, 2 (ajeno) y 4.

## Qué quedó fuera (decisión consciente)

- Las funciones RPC del portal público de soporte (`crear_ticket_publico`,
  etc.) no se tocaron porque no tengo su código fuente actual desde este
  repo — quedan como un pendiente a revisar manualmente (ver punto 4 de
  "Cómo aplicar").
- `legacy/Code.gs` (el backend viejo de Apps Script) no se modificó más
  allá de marcarlo como deprecado; si sigue publicado como Web App,
  despublícalo (ver `legacy/README.md`).
