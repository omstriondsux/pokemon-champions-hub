# Arquitectura

## Decisiones (y por qué)

| Decisión | Alternativa descartada | Motivo |
|---|---|---|
| App local en el PC (Vite + React + TS) y servidor local mínimo (Node + Hono + SQLite) | Next.js, hosting en la nube | Uso personal en el PC; no hace falta SSR, SEO ni coste de hosting |
| Motor en TypeScript, en Web Workers en el navegador | Servicio en Python | Una sola implementación de las mecánicas; dos acabarían discrepando |
| `@smogon/calc` 0.12.0 como dependencia, con overrides por regulación | Calculadora propia desde cero / fork | Ya implementa Champions (gen 0: fórmula de SP, megas Z, cambios de potencia de M-C). Probada durante años |
| `@pkmn/mods/champions` para learnsets y metadatos | PokéAPI | PokéAPI no conoce la legalidad de Champions. Solo se usará para nombres en español (F1) |
| Regulaciones en JSON con `confidence` por regla | Reglas en el código | Las regulaciones cambian cada ~3 meses (M-D: 2-dic-2026) y las fuentes se contradicen |
| Smogon chaos JSON mensual | Scraping de Game8, Pokémon Zone, Doubles Dex | Fuente pública y estable; el scraping es frágil y tiene riesgo con los términos de uso |
| Probabilidades de KO exactas (convolución de las 16 tiradas + crítico + precisión) | Monte Carlo | Exacto y más rápido; Monte Carlo solo añade ruido aquí |
| Sin Coach LLM por ahora | — | Sin el motor debajo, un LLM solo produce alucinaciones bien redactadas. Se reevalúa en F4 |

## Paquetes

```
data/
  regulations/M-C.json        reglas versionadas, con fuentes y confianza
  snapshots/smogon/<mes>/     singles|doubles-<corte>.json (dataKind: "simulator")
packages/engine/              motor puro y testeable (sin UI ni red)
  src/data/dex.ts             acceso a datos de Champions
  src/rules/                  esquema y carga de regulaciones
  src/stats.ts                fórmula de Stat Points
  src/legality.ts             builds, equipos y selección en vista previa
  src/damage.ts               daño y probabilidades de KO
  src/optimize.ts             umbrales de velocidad, bulk y ofensiva
scripts/                      ingesta y validación
apps/web/                     (F1) interfaz
```

## Fórmula de estadísticas (verificada)

- PS = base + SP + 75
- Resto = ⌊alineación × (base + SP + 20)⌋, con alineación 1,1 / 1 / 0,9

Equivale a nivel 50 con IV 31 y 8 EV por SP: cada SP vale exactamente +1, así que no hay puntos desperdiciados por redondeo.

## Fases

- **F0 (hecha):** regulación, motor de estadísticas, legalidad, daño, umbrales e ingesta.
- **F1 (hecha, MVP):** interfaz con My Pokémon (inventario y builds; importar/exportar en formato Showdown), calculadora y speed tiers, Battle Advisor (matriz exhaustiva de 15×15 selecciones con tres alternativas: media, peor caso/CVaR y agresiva) e historial.
- **F2:** predicción bayesiana de builds rivales (priors de Smogon + compañeros + arquetipo + lo revelado), Build Optimizer y Squad Builder (beam search con restricciones).
- **F3:** Recruitment Advisor (valor marginal sobre el mejor equipo), situaciones de combate y tendencias.
- **F4:** reevaluar el Coach LLM.

## Battle Advisor (F1)

1. **Modelo del rival** (`opponent.ts`): para cada especie, sus formas visibles en la vista previa (incluye megas ocultas), las 3 distribuciones de SP y los 2 objetos más usados; peso = P(forma) × P(spread) × P(objeto). Sin datos, usa una hipótesis explícita (máxima ofensiva y velocidad) marcada como tal.
2. **Índice 1v1** (`advisor.ts`): s = clamp((usos_rival − usos_míos + (P(primero) − ½)) / 2, −1, 1), con los usos esperados para el KO calculados de forma exacta. Promedio ponderado sobre las builds plausibles, más el peor caso (variantes con un peso ≥ 5%).
3. **Selección**: V(S,T) = 0,6·cobertura + 0,4·media, con búsqueda exhaustiva sobre S y T. Alternativas: argmax E[V], argmax CVaR₂₅ (sobre la matriz de peor caso) y argmax del cuartil superior. Si coinciden, se dice.
4. **Leads**: en dobles, la pareja con mejor cobertura media contra las parejas rivales, más un bonus acotado (≤ 0,15) por Fake Out, control de velocidad, redirección e Intimidate. En individuales, el mejor índice medio.

Limitaciones declaradas en la propia salida: no modela cambios, posicionamiento, estados, prioridad ni daño residual. El índice no es una probabilidad de victoria.

## Lagunas de datos detectadas y cómo se cubren

- `@smogon/calc` 0.12.0 no tiene la forma base de Aegislash: se usa el alias `Aegislash-Both`. El roster es la unión de la calc y del mod de Showdown.
- Floette-Mega se registra como Floette-Eternal (`changesFrom`), no como Floette.
- Champions no permite Assault Vest, Choice Band ni Choice Specs, y Incineroar no aprende Knock Off. La validación lo detecta, y un test comprueba que el equipo de prueba es legal.
- Algunas megas nuevas no tienen sprite en Showdown: se muestra el de la especie base.

## Métricas

- Daño: 0 discrepancias en los casos de referencia, más el test cruzado contra la calc.
- Rendimiento medido: ~0,16 ms por cálculo de daño (objetivo < 5 ms). Battle Advisor: ~0,2 s en Node y 177 ms en el navegador para 6 rivales (objetivo < 2 s). Amenazas del Dashboard (top 20): ~3,9 s en un worker en segundo plano, por encima del objetivo; se optimizará en F2 con caché de pares.
- Predicción (F2): log-loss y acierto en el top 3 frente a lo que revelan los rivales en el historial.
