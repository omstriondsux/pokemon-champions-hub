# Pokémon Champions — Competitive Intelligence Hub

Herramienta gratuita de análisis competitivo para **Pokémon Champions** (individuales y dobles): qué sacar contra cada rival, cómo armar tu equipo, cálculos de daño exactos, speed tiers y el meta actualizado cada semana.

**▶ Úsala aquí: https://omstriondsux.github.io/pokemon-champions-hub/** (no hace falta instalar nada ni crear cuenta)

> Proyecto no oficial, hecho por fans. No afiliado a Nintendo, Game Freak ni The Pokémon Company. Las estadísticas de uso vienen de Smogon / Pokémon Showdown (simulador), no del juego oficial.

## Dos formas de usarla

| | Web pública | Versión local (en tu PC) |
|---|---|---|
| Cómo | Abre el enlace de arriba | `npm install` y `npm run dev` |
| Tus equipos e historial | En tu navegador (expórtalos desde Ajustes para no perderlos) | En `data/hub.db` (SQLite) con copia diaria |
| Datos del meta | Se actualizan solos cada lunes (GitHub Actions) | Se descargan solos cada 7 días |
| Coach con IA (opcional) | Con tu propia clave de Anthropic, guardada solo en tu navegador | Clave guardada en el servidor local |

Todo el cálculo (daño, probabilidades de KO, búsqueda de selecciones y equipos) se hace en tu propio dispositivo: no hay servidor ni base de datos central, y nadie más ve tus equipos.

### Versión local

```powershell
npm install
npm run dev        # servidor local (127.0.0.1:8787) + interfaz (http://127.0.0.1:5173)
```

### Compilar la web estática

```powershell
$env:VITE_STATIC='1'; $env:VITE_BASE='/pokemon-champions-hub/'; npm run build -w @pch/web
```

## Qué incluye

| Módulo | Qué hace |
|---|---|
| **Battle Advisor** | Escribes los 6 rivales (2-3 letras + Enter) y calcula la matriz 1v1 exacta contra las builds probables de cada rival (incluidas megas ocultas). Busca entre todas las selecciones posibles (15×15 en dobles, 20×20 en individuales) y propone 3 alternativas: mejor media, mejor peor caso (CVaR 25%) y mejor potencial, con leads, riesgos, condición de victoria y evidencia. ~0,2 s |
| **Mis Pokémon** | Inventario con varias builds por especie, estados de disponibilidad, favoritos, coste en VP y validación de legalidad en vivo. Importa y exporta en formato Showdown (convierte los EVs clásicos a SP) |
| **Equipos** | Equipos registrados por formato, con Species/Item Clause y aviso de megas múltiples. Equipo activo por modo |
| **Calculadora** | Daño con las mecánicas de Champions, probabilidades exactas de nHKO, clima, campos, pantallas, boosts. Umbrales de SP: velocidad, bulk mínimo y ofensiva mínima |
| **Speed Tiers** | Velocidades reales del meta (top spreads + Scarf), con tu equipo intercalado, Trick Room y Tailwind |
| **Historial** | Registro de combates, con estadísticas por Pokémon, rival, leads y si seguiste al Advisor. Intervalos de Wilson: no saca conclusiones con muestras pequeñas |
| **Dashboard** | Regulación y días restantes, frescura de los datos, top del meta, amenazas del top 20 sin respuesta en tu equipo activo |
| **Ajustes** | Español/inglés (nombres de PokéAPI), tema oscuro/claro, corte de rating, coste en VP, backup JSON, reglas sin verificar |

## Coach con IA (opcional)

Chat con Claude Sonnet 5.5 que conoce tu equipo, su análisis contra el meta y tu historial, y discute tus decisiones. Necesita una clave de API de Anthropic (console.anthropic.com → API Keys, saldo de prepago): pégala en **Ajustes → Coach con IA**. En la versión local se guarda solo en `data/secrets.json` (ignorado por git) y el navegador nunca la ve. En la web pública cada visitante usa su propia clave, que se queda en su navegador y solo se envía a la API de Anthropic. Precio: $2 / $10 por millón de tokens (entrada/salida), unos 2–3 céntimos de dólar por pregunta; cada respuesta muestra su coste. Los cálculos los sigue haciendo el motor; la IA solo interpreta y argumenta.

## Comandos

```powershell
npm test                 # motor (46 tests) + API (6 tests)
npm run validate:rules   # valida paquetes de regulación y lista reglas no verificadas
npm run ingest:smogon    # descarga el último mes de estadísticas (singles + dobles)
npm run build:i18n       # regenera los nombres en español desde PokéAPI
npm start                # build de producción servida por el servidor local en :8787
```

## Cómo añadir una regulación nueva (p. ej. M-D)

1. Copiar `data/regulations/M-C.json` a `M-D.json`, cambiar `id`, fechas y reglas, y citar las fuentes en `sources`.
2. Marcar cada regla con `confidence`: `verified`, `reported`, `assumed` o `disputed`.
3. Los cambios de balance que aún no estén en `@smogon/calc` van en `overrides`.
4. `npm run validate:rules` comprueba el esquema y avisa si la base de datos no tiene las especies u objetos nuevos (en ese caso hay que actualizar `@smogon/calc` y `@pkmn/mods`).

Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contribuir

Issues y pull requests bienvenidos: datos de regulaciones nuevas (`data/regulations/`), correcciones de mecánicas o mejoras de la interfaz. Licencia MIT.
