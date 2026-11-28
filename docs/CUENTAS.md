# Activar las cuentas (login) — unos 5 minutos

Las cuentas son opcionales: sin configurarlas, la web funciona igual y guarda todo en el navegador.
Con cuentas, todo lo que cambia cada persona (Pokémon, builds, equipos, historial, ajustes y equipos de
«Contra la IA») se guarda en su cuenta y lo ve en cualquier dispositivo.

## 1. Crear el proyecto (gratis)

1. Entra a https://supabase.com, crea una cuenta y pulsa **New project**. Elige una contraseña larga para la base de datos (no la necesitarás en la web) y la región más cercana.
2. Cuando termine de crearse, abre **SQL Editor**, pega todo el archivo `supabase/schema.sql` de este repositorio y pulsa **Run**.

## 2. Seguridad del login

En **Authentication**:

- **Sign In / Providers → Email**: deja activado *Confirm email* (cada cuenta debe confirmar su correo).
- **Sign In / Providers → Email**: *Minimum password length* = 8.
- **URL Configuration**:
  - *Site URL*: `https://omstriondsux.github.io/pokemon-champions-hub/`
  - *Redirect URLs*: añade `https://omstriondsux.github.io/pokemon-champions-hub/` (y `http://localhost:4173/pokemon-champions-hub/` si quieres probar en tu PC).

## 3. Conectar la web

En **Project Settings → API** copia:

- **Project URL** (`https://xxxx.supabase.co`)
- **anon public key** (empieza por `eyJ…` o `sb_publishable_…`). Es pública por diseño: sin sesión no da acceso a nada gracias a las reglas de la base de datos.

**Nunca** uses la *service_role* / *secret* key en la web.

En GitHub: repositorio → **Settings → Secrets and variables → Actions → Variables** → crea:

| Nombre | Valor |
|---|---|
| `SUPABASE_URL` | la Project URL |
| `SUPABASE_ANON_KEY` | la anon public key |

Luego en **Actions → Web pública → Run workflow**. En un minuto aparece el botón **Entrar** en la web.

## Qué protege qué

- **Contraseñas**: las guarda y verifica Supabase (cifradas con bcrypt), con confirmación de correo y límite de intentos. La web nunca las almacena.
- **Datos**: Row Level Security en `user_docs`: cada usuario solo puede leer y escribir sus propias filas. Hay un límite de 5.000 elementos y 200 KB por elemento por cuenta.
- **Sesión**: flujo PKCE (ningún token viaja en la URL). Al cerrar sesión se borran los datos de ese navegador; si otra persona entra en el mismo navegador, no hereda los datos de la anterior.
- **Borrar cuenta**: en Ajustes → Tu cuenta. Elimina la cuenta y todo lo guardado en ella.
