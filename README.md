# Grand Hill · Back Office

Login y dashboard interno. Vite + React + TypeScript, Supabase Auth, estilos del design system "Grand Hill".

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # completa las dos variables
npm run dev
```

## Variables de entorno

| Variable | Valor |
|---|---|
| `VITE_SUPABASE_URL` | Project URL de Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave publishable (anon). Nunca la `service_role`. |

## Despliegue en Netlify

1. Sube este proyecto a un repositorio privado de GitHub.
2. En Netlify: Add new site > Import from Git. El build (`npm run build`) y el directorio (`dist`) ya están en `netlify.toml`.
3. En Site configuration > Environment variables agrega las dos variables de arriba.
4. En Domain management agrega `app.grandhillcorp.com` y crea en el DNS el registro que Netlify indique.

## Configuración en Supabase (Authentication > URL Configuration)

- **Site URL:** `https://app.grandhillcorp.com`
- **Redirect URLs:** `https://app.grandhillcorp.com/**` y `http://localhost:5173/**`
- **Sign In / Providers > Email:** desactivar "Allow new users to sign up" para que nadie pueda registrarse. Los usuarios se crean desde Authentication > Users.

## Base de datos y roles

1. En Supabase abre **SQL Editor**, pega el contenido de `supabase/migrations/0001_foundations.sql` y ejecútalo (una sola vez).
   Después haz lo mismo con `supabase/migrations/0002_projects.sql` (proyectos, subcontratistas asignados y movimientos).
   Y luego con `supabase/migrations/0003_leads.sql` (leads, responsables, seguimientos y actividad).
   Luego `supabase/migrations/0004_convert_lead.sql` (convierte un lead en cliente + bid en una sola transacción).
   Luego `supabase/migrations/0005_subcontractor_portal.sql` (portal y revisión de documentos). Aplícala **antes** de desplegar la versión de la app que la usa.
   Luego `supabase/migrations/0006_email_alerts.sql` (registro y programación de alertas por correo; no envía nada hasta activarlas).
   Luego `supabase/migrations/0007_settings.sql` (configuración editable desde la app). Aplícala **antes** de desplegar la versión de la app que la usa.
   Luego `supabase/migrations/0008_change_orders.sql` (órdenes de cambio de los proyectos y su detalle en el portal). Aplícala **antes** de desplegar la versión de la app que la usa.
   Luego `supabase/migrations/0009_change_order_decisions.sql` (quién aprobó o rechazó cada orden). Aplícala **antes** de desplegar la app y la función `email-alerts` que la usan.
   Luego `supabase/migrations/0010_record_links.sql` (enlaces a archivos de bids y proyectos en Google Drive; no usa Storage). Aplícala **antes** de desplegar la versión de la app que la usa.
   Luego `supabase/migrations/0011_estimates.sql` (cotizaciones de subcontratistas y partidas del estimado de cada bid). Aplícala **antes** de desplegar la versión de la app que la usa.
   Por último `supabase/migrations/0012_proposal_settings.sql` (datos de la empresa, condiciones y vigencia de la propuesta al cliente). Aplícala **antes** de desplegar la versión de la app que la usa.
2. Despliega la función de gestión de usuarios (ver abajo). Desde ese momento, un super admin invita, cambia roles y quita accesos en **Equipo** (`/equipo`), sin entrar a Supabase.

| Rol | Acceso |
| --- | --- |
| `super_admin` | Todo, incluida la gestión del equipo y los roles, y la **Configuración** (`/configuracion`) |
| `admin` | Bids, clientes, subcontratistas y proyectos; no cambia roles |
| `subcontractor` | Solo su portal (`/portal`): su empresa, sus documentos, sus trabajos y sus pagos. Sube documentos para aprobación y edita su contacto |

Un usuario sin fila en `profiles` inicia sesión pero no ve nada. La seguridad real vive en las políticas RLS de Postgres; el menú solo refleja lo que cada rol puede hacer.

## Gestión de usuarios (función `admin-users`)

Invitar personas y quitar accesos necesita la clave `service_role`, que nunca debe estar en el navegador. Por eso vive en una Edge Function de Supabase (`supabase/functions/admin-users/index.ts`) que solo atiende a un `super_admin` con sesión iniciada. Supabase le entrega la clave automáticamente; no hay que configurar ninguna variable.

Despliegue con la CLI (una vez, y de nuevo cada vez que cambie el archivo):

```bash
supabase login
supabase link --project-ref <ID_DEL_PROYECTO>
supabase functions deploy admin-users
```

Alternativa sin CLI: Supabase > **Edge Functions** > **Deploy a new function** > **Via Editor**, nombre `admin-users`, pega el contenido del archivo y despliega.

Después revisa en Supabase:

- **Authentication > URL Configuration**: las Redirect URLs deben incluir `/restablecer` (los patrones `/**` de arriba ya lo cubren). La invitación lleva a esa página para crear la contraseña.
- **Authentication > Emails**: el correo incluido de Supabase envía pocos mensajes por hora. Para invitar a varias personas seguidas, configura un SMTP propio.

Sin la función desplegada, **Equipo** sigue mostrando los roles y permite cambiarlos, y avisa que falta la función para invitar y quitar accesos.

## Formulario del sitio web (función `website-lead`)

Cada solicitud del formulario de cotización de `grandhillcorp.com/contact` crea un lead: origen **Sitio web**, etapa **Nuevo**, responsable el elegido en **Configuración**, seguimiento **hoy**, el servicio y los detalles en "Qué necesita" y el mensaje completo en su historial. Si ya hay un lead abierto con el mismo correo, el mensaje se agrega a ese lead en lugar de duplicarlo.

Netlify sigue recibiendo el formulario, filtrando el spam y enviando el correo de aviso como siempre. Además avisa a la función `supabase/functions/website-lead` con un webhook firmado; la función rechaza todo lo que no traiga la firma de Netlify.

1. Despliega la función. Va sin verificación de sesión de Supabase (Netlify no tiene sesión); la protege la firma:

```bash
supabase functions deploy website-lead --no-verify-jwt
```

2. Crea el secreto compartido. Este comando lo genera, lo guarda en Supabase y lo deja copiado en el portapapeles para pegarlo en Netlify:

```bash
S=$(openssl rand -hex 32) && supabase secrets set NETLIFY_WEBHOOK_SECRET="$S" && printf %s "$S" | pbcopy && unset S
```

3. En Netlify, en el sitio **grandhillcorp.com**: **Site configuration > Notifications > Emails and webhooks > Form submission notifications > Add notification > HTTP POST request**.
   - Event to listen for: **New form submission**
   - URL to notify: `https://<ID_DEL_PROYECTO>.supabase.co/functions/v1/website-lead`
   - Form: **quote**
   - JWS secret token: pega el secreto del paso 2
4. Envía una prueba desde `grandhillcorp.com/contact`. En segundos debe aparecer el lead en **Leads** y en **Seguimientos de leads** del Resumen.

La notificación por correo de Netlify no se toca: sigue llegando igual.

Para que los leads de la web vayan a otra persona, cámbiala en **Configuración > Leads del sitio web**. El secreto `WEBSITE_LEAD_OWNER` solo se usa si la migración 0007 no está aplicada.

## Alertas por correo (función `email-alerts`)

| Quién | Qué recibe | Cuándo |
| --- | --- | --- |
| Admins y super admins | Documentos por revisar, vencidos o por vencer, y órdenes de cambio por aprobar | Resumen de lunes a viernes por la mañana (Florida), solo si hay pendientes |
| Responsable del lead | Sus seguimientos de hoy o atrasados | En ese mismo resumen |
| Super admins | Además, los leads sin responsable | En ese mismo resumen |
| Subcontratista con login | Su COI o licencia en cada fecha de aviso y al vencer | Días laborables por la mañana |
| Subcontratista con login | Documento aprobado o rechazado, con el motivo | Hasta 15 minutos después de la revisión |
| Subcontratista con login | Orden de cambio aprobada que cambia su monto acordado, con el nuevo total | Hasta 15 minutos después de aprobarla |

Los subcontratistas sin login no reciben correos. La hora del resumen, quién lo recibe, los días de aviso y los correos a subcontratistas se cambian en **Configuración** (por defecto: 8:00 a. m., todo el equipo, 30, 15 y 7 días, avisos a subcontratistas encendidos).

1. En [Resend](https://resend.com), verifica el subdominio `updates.grandhillcorp.com` agregando sus registros DNS y crea una API key con permiso **Sending access**.
2. Aplica `supabase/migrations/0006_email_alerts.sql` en el SQL Editor.
3. Guarda la clave de Resend:

```bash
read -rs "K?Clave de Resend: " && supabase secrets set RESEND_API_KEY="$K" && unset K
```

4. Crea el secreto de la programación. Queda en la variable `S` de esa terminal y copiado en el portapapeles:

```bash
S=$(openssl rand -hex 32) && supabase secrets set ALERTS_CRON_SECRET="$S" && printf %s "$S" | pbcopy
```

5. Despliega la función:

```bash
supabase functions deploy email-alerts --no-verify-jwt
```

6. Prueba sin avisar a nadie. El primero solo cuenta lo que se enviaría; el segundo manda una muestra de cada tipo a tu correo:

```bash
curl -s -X POST https://<ID_DEL_PROYECTO>.supabase.co/functions/v1/email-alerts -H "x-alerts-secret: $S" -H "Content-Type: application/json" -d '{"dry_run":true}'
```

```bash
curl -s -X POST https://<ID_DEL_PROYECTO>.supabase.co/functions/v1/email-alerts -H "x-alerts-secret: $S" -H "Content-Type: application/json" -d '{"preview_to":"tu@correo.com"}'
```

7. Activa los envíos en el SQL Editor, pegando el secreto del paso 4:

```sql
select vault.create_secret('PEGA_AQUI_EL_SECRETO', 'email_alerts_secret');
```

8. Ajusta el resto en **Configuración**. El secreto `ALERTS_SUBS_ENABLED` solo se usa si la migración 0007 no está aplicada.

Secretos opcionales: `ALERTS_FROM` (remitente, por defecto `Grand Hill <alerts@updates.grandhillcorp.com>`), `ALERTS_REPLY_TO` (buzón real para las respuestas, porque `updates` no recibe correo) y `APP_URL`. Para pausar todo: `select cron.unschedule('email-alerts');`. Cada envío queda registrado en la tabla `email_log`.

## Rutas

- `/login` inicio de sesión y recuperación de contraseña
- `/restablecer` destino del enlace del correo de recuperación
- `/bids/:id/propuesta` propuesta al cliente, lista para imprimir o guardar como PDF (solo equipo)
- `/` redirige según el rol
- `/dashboard`, `/leads`, `/bids`, `/clientes`, `/subcontratistas`, `/proyectos` personal interno (super admin y admin), cada uno con `/nuevo`, `/:id` y `/:id/editar`
- `/proyectos/nuevo?bid=<id>` crea un proyecto copiando los datos de un bid ganado
- `/equipo` solo super admin
- `/portal` solo subcontratistas
