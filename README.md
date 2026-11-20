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
2. Crea el perfil de cada persona. La migración ya crea el de Adrian (`adriangerig@gmail.com`) como `super_admin`. Para Adiel, primero créalo en Authentication > Users y luego ejecuta:

```sql
insert into public.profiles (id, full_name, email, role)
select id, 'Adiel', email, 'admin' from auth.users where lower(email) = lower('EMAIL_DE_ADIEL');
```

| Rol | Acceso |
| --- | --- |
| `super_admin` | Todo, incluida la gestión del equipo y los roles |
| `admin` | Bids, clientes, subcontratistas y proyectos; no cambia roles |
| `subcontractor` | Solo su propia empresa y sus documentos (`/portal`) |

Un usuario sin fila en `profiles` inicia sesión pero no ve nada. La seguridad real vive en las políticas RLS de Postgres; el menú solo refleja lo que cada rol puede hacer.

## Rutas

- `/login` inicio de sesión y recuperación de contraseña
- `/restablecer` destino del enlace del correo de recuperación
- `/` redirige según el rol
- `/dashboard`, `/bids`, `/clientes`, `/subcontratistas`, `/proyectos` personal interno (super admin y admin)
- `/equipo` solo super admin
- `/portal` solo subcontratistas
