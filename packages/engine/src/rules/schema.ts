import { z } from 'zod';

/**
 * Regulation packs live in /data/regulations/*.json, outside the code.
 * A new regulation (M-D, M-E...) = a new JSON file, no rebuild of the engine.
 *
 * Every rule that matters carries its own provenance, because sources disagree
 * and we must never present an assumption as a verified fact.
 */
export const Confidence = z.enum([
  'verified', // stated by an official source, or by 2+ independent sources that agree
  'reported', // stated by one reliable community source
  'assumed', // not stated anywhere we found; standard VGC/Showdown convention used
  'disputed', // sources disagree; `value` is our best pick, see `note`
]);
export type Confidence = z.infer<typeof Confidence>;

export const sourced = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value,
    confidence: Confidence,
    sources: z.array(z.string()).default([]), // ids into pack.sources
    note: z.string().optional(),
  });

export const Source = z.object({
  id: z.string(),
  url: z.string().url(),
  kind: z.enum(['official', 'community', 'dataset']),
  retrieved: z.string(), // ISO date
});

export const Clause = z.enum(['species', 'item']);

export const FormatRules = z.object({
  gameType: z.enum(['Singles', 'Doubles']),
  level: sourced(z.number().int()),
  teamSize: sourced(z.object({ min: z.number().int(), max: z.number().int() })),
  /** Pokémon chosen at team preview to actually battle */
  bring: sourced(z.number().int()),
  timers: sourced(
    z.object({
      teamPreviewSec: z.number().int(),
      turnSec: z.number().int(),
      playerTotalSec: z.number().int(),
    }),
  ),
  clauses: sourced(z.array(Clause)),
});
export type FormatRules = z.infer<typeof FormatRules>;

export const RegulationPack = z.object({
  schemaVersion: z.literal(1),
  id: z.string(), // "M-C"
  name: z.string(),
  packVersion: z.string(), // bump when the pack itself is corrected
  validFrom: sourced(z.string()),
  validTo: sourced(z.string()),
  sources: z.array(Source),
  formats: z.object({ singles: FormatRules, doubles: FormatRules }),
  /** Which data base the roster/items/moves come from. */
  dataBase: z.object({
    calc: z.string(), // "@smogon/calc@0.12.0 gen 0"
    dex: z.string(), // "@pkmn/mods@0.11.0 champions"
  }),
  roster: sourced(
    z.object({
      mode: z.enum(['all-in-database', 'explicit']),
      allow: z.array(z.string()).optional(), // required when mode = explicit
      deny: z.array(z.string()).default([]),
      /** Species the sources say were added this regulation: used as a sanity test against the database. */
      expectedAdditions: z.array(z.string()).default([]),
    }),
  ),
  items: sourced(
    z.object({
      mode: z.enum(['all-in-database', 'explicit']),
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).default([]),
      expectedAdditions: z.array(z.string()).default([]),
    }),
  ),
  moves: sourced(z.object({ deny: z.array(z.string()).default([]) })),
  abilities: sourced(z.object({ deny: z.array(z.string()).default([]) })),
  mechanics: sourced(
    z.object({
      mega: z.boolean(),
      zMega: z.boolean(),
      tera: z.boolean(),
      dynamax: z.boolean(),
      zMoves: z.boolean(),
      megaPerBattle: z.number().int(),
    }),
  ),
  statPoints: z.object({
    total: sourced(z.number().int()),
    perStatMax: sourced(z.number().int()),
    vpCostPerPoint: sourced(z.number().nullable()),
    vpCostAlignment: sourced(z.number().nullable()),
  }),
  /**
   * Balance patches NOT yet reflected in the calc database.
   * Applied on top of @smogon/calc via its `overrides` option.
   */
  overrides: z
    .object({
      moves: z.record(z.object({ basePower: z.number().optional(), accuracy: z.number().optional(), type: z.string().optional() })).default({}),
      species: z.record(z.object({ baseStats: z.record(z.number()).optional() })).default({}),
    })
    .default({}),
});
export type RegulationPack = z.infer<typeof RegulationPack>;
export type FormatId = keyof RegulationPack['formats'];
