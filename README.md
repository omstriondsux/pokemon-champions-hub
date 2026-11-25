# Pokémon Champions — Competitive Intelligence Hub

Herramienta personal de análisis competitivo para Pokémon Champions (individuales y dobles).
Uso local en el PC: se juega en el móvil y se consulta el Advisor en el PC.

> Proyecto no oficial. No afiliado a Nintendo, Game Freak ni The Pokémon Company.

## Estado: Fase F0 — cimientos

| Pieza | Estado |
|---|---|
| Paquetes de regulación en JSON (fuera del código) con procedencia y confianza por regla | ✅ M-C |
| Motor de estadísticas con Stat Points (66 total / 32 por stat) | ✅ verificado contra @smogon/calc en >10.000 casos |
| Validación de builds, equipos y selección de combate | ✅ |
| Calculadora de daño (Champions, gen 0 de @smogon/calc) + probabilidades exactas de OHKO/2HKO/3HKO/4HKO con precisión y críticos | ✅ |
| Velocidad final (Tailwind, Scarf, boosts…) y umbrales: SP para superar en velocidad, sobrevivir, garantizar KO | ✅ |
| Ingesta mensual de estadísticas de Smogon (simulador, etiquetadas como tal) | ✅ |
| Interfaz web (F1) | ⏳ |

## Comandos

```powershell
npm install
npm test                 # tests del motor
npm run typecheck
npm run validate:rules   # valida los paquetes de regulación y lista reglas no verificadas
npm run ingest:smogon    # descarga el último mes de estadísticas (singles + dobles)
```

## Cómo añadir una regulación nueva (p. ej. M-D)

1. Copiar `data/regulations/M-C.json` a `M-D.json`, cambiar `id`, fechas y reglas, y citar las fuentes en `sources`.
2. Marcar cada regla con `confidence`: `verified`, `reported`, `assumed` o `disputed`.
3. Los cambios de balance que aún no estén en `@smogon/calc` van en `overrides`.
4. `npm run validate:rules` comprueba el esquema y avisa si la base de datos no tiene las especies u objetos nuevos (en ese caso hay que actualizar `@smogon/calc` y `@pkmn/mods`).

Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
