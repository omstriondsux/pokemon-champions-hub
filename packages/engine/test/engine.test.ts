import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calcStat, Generations } from '@smogon/calc';
import {
  activeRegulation,
  calcDamage,
  database,
  finalSpeed,
  finalStats,
  getSpecies,
  koProbabilities,
  makeBuild,
  minBulkToSurvive,
  minOffenseToKO,
  minSpeedSp,
  Regulation,
  STAT_IDS,
  statValue,
  validateBuild,
  validateSelection,
  validateTeam,
  wastedSpeedSp,
} from '../src/index.js';

const REG_DIR = join(__dirname, '../../../data/regulations');
const loadPack = (id: string) => new Regulation(JSON.parse(readFileSync(join(REG_DIR, `${id}.json`), 'utf8')));
const MC = loadPack('M-C');

const chomp = makeBuild({
  species: 'Garchomp',
  ability: 'Rough Skin',
  item: 'Life Orb',
  alignment: 'Jolly',
  moves: ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect'],
  sp: { hp: 2, atk: 32, spe: 32 },
});
const incin = makeBuild({
  species: 'Incineroar',
  ability: 'Blaze',
  item: 'Sitrus Berry',
  alignment: 'Careful',
  moves: ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Darkest Lariat'],
  sp: { hp: 32, spd: 20, def: 14 },
});

describe('regulation packs', () => {
  it('every pack in /data/regulations parses against the schema', () => {
    for (const f of readdirSync(REG_DIR).filter((f) => f.endsWith('.json'))) {
      expect(() => loadPack(f.replace('.json', '')), f).not.toThrow();
    }
  });

  it('M-C: every species and item the sources list as added exists in the database (stale-data guard)', () => {
    expect(MC.missingExpectedAdditions()).toEqual({ species: [], items: [] });
  });

  it('selects the active regulation by date', () => {
    expect(activeRegulation([MC], '2026-10-01')?.id).toBe('M-C');
    expect(activeRegulation([MC], '2026-12-15')).toBeUndefined();
  });

  it('format rules: bring 3 in singles, 4 in doubles, flagged as assumed', () => {
    expect(MC.format('singles').bring.value).toBe(3);
    expect(MC.format('doubles').bring.value).toBe(4);
    expect(MC.format('doubles').bring.confidence).toBe('assumed');
  });
});

describe('Champions stats (Stat Points)', () => {
  it('Garchomp Jolly 2/32/0/0/0/32 → 185/182/115/90/105/169 (hand-checked)', () => {
    expect(finalStats('Garchomp', chomp.sp, 'Jolly')).toEqual({ hp: 185, atk: 182, def: 115, spa: 90, spd: 105, spe: 169 });
  });

  it('matches @smogon/calc for every Champions species, several spreads and alignments', () => {
    const gen = Generations.get(0 as never);
    const alignments = ['Hardy', 'Adamant', 'Modest', 'Timid', 'Bold', 'Brave'];
    let checked = 0;
    for (const id of database.speciesIds()) {
      const s = getSpecies(id);
      if (!s) continue;
      for (const [i, a] of alignments.entries()) {
        for (const stat of STAT_IDS) {
          const sp = (i * 7 + stat.length * 5) % 33;
          expect(statValue(stat, s.baseStats[stat], sp, a)).toBe(calcStat(gen, stat, s.baseStats[stat], 31, sp, 50, a));
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it('1 SP = +1 stat (no wasted points, unlike EVs)', () => {
    for (let sp = 0; sp < 32; sp++) expect(statValue('atk', 130, sp + 1) - statValue('atk', 130, sp)).toBe(1);
  });
});

describe('legality', () => {
  it('accepts a standard Garchomp', async () => {
    const issues = await validateBuild(chomp, MC);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('rejects registering a mega forme directly', async () => {
    const codes = (await validateBuild({ ...chomp, species: 'Garchomp-Mega' }, MC)).map((i) => i.code);
    expect(codes).toContain('species-battle-only');
  });

  it('rejects unlearnable moves, wrong abilities and illegal spreads', async () => {
    const bad = { ...chomp, ability: 'Intimidate', moves: ['Earthquake', 'Spore'], sp: { ...chomp.sp, atk: 33 } };
    const codes = (await validateBuild(bad, MC)).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['ability-not-available', 'move-not-learnable', 'sp-per-stat', 'sp-total']));
  });

  it('mega stones: Z stone works on its species, wrong stone is rejected', async () => {
    const z = await validateBuild({ ...chomp, item: 'Garchompite Z' }, MC);
    expect(z.filter((i) => i.severity === 'error')).toEqual([]);
    const wrong = await validateBuild({ ...chomp, item: 'Charizardite X' }, MC);
    expect(wrong.map((i) => i.code)).toContain('mega-stone-mismatch');
  });

  it('team: species clause and item clause', async () => {
    const team = [chomp, { ...chomp, item: 'Focus Sash' }, incin, { ...incin, species: 'Incineroar', item: 'Life Orb' }];
    const codes = (await validateTeam(team, MC, 'doubles')).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['species-clause', 'item-clause']));
  });

  it('selection must come from the registered team and match the bring count', () => {
    const team = [chomp, incin, chomp, incin, chomp, incin];
    expect(validateSelection(team, [0, 1, 2, 3], MC, 'doubles')).toEqual([]);
    expect(validateSelection(team, [0, 1, 2], MC, 'singles')).toEqual([]);
    expect(validateSelection(team, [0, 1, 6], MC, 'singles').map((i) => i.code)).toContain('selection-not-in-team');
  });
});

describe('damage engine', () => {
  it('hand-calculated case: Garchomp (182 Atk) Earthquake vs 0-SP Incineroar, singles, no item', () => {
    // base = floor(floor(22 * 100 * 182 / 110) / 50) + 2 = 74 ; rolls 62..74 ; STAB 1.5 ; Fire weak 2x
    const atk = { ...chomp, item: undefined };
    const def = makeBuild({ species: 'Incineroar', ability: 'Blaze', alignment: 'Hardy', moves: ['Fake Out'] });
    const r = calcDamage(atk, def, 'Earthquake', MC, { field: { gameType: 'Singles' } });
    expect(r.defenderHP).toBe(170);
    expect(r.min).toBe(186);
    expect(r.max).toBe(222);
    expect(r.koChance[0]).toBeCloseTo(1, 10); // 100% accuracy, min roll > HP
  });

  it('spread moves do less in doubles', () => {
    const s = calcDamage(chomp, incin, 'Earthquake', MC, { field: { gameType: 'Singles' } });
    const d = calcDamage(chomp, incin, 'Earthquake', MC, { field: { gameType: 'Doubles' } });
    expect(d.max).toBeLessThan(s.max);
  });

  it('exact KO probabilities with accuracy', () => {
    const d = new Map([[50, 1]]);
    expect(koProbabilities(100, d, d, 1, 0)).toEqual([0, 1, 1, 1]);
    const p = koProbabilities(100, d, d, 0.5, 0);
    expect(p[1]).toBeCloseTo(0.25);
    expect(p[2]).toBeCloseTo(0.5);
    expect(p[3]).toBeCloseTo(11 / 16);
  });

  it('accuracy and crit are reflected: Rock Slide 90% never "guarantees"', () => {
    const r = calcDamage(chomp, incin, 'Rock Slide', MC);
    expect(r.accuracy).toBe(0.9);
    expect(r.koChance[3]).toBeLessThanOrEqual(1 - 0.1 ** 4 + 1e-12);
    expect(r.critChance).toBeCloseTo(1 / 24);
  });

  it('Champions balance data is used (Meteor Assault 170 BP in calc patch) and pack overrides apply', () => {
    const boosted = new Regulation({ ...MC.pack, overrides: { moves: { 'Dragon Claw': { basePower: 160 } }, species: {} } });
    const base = calcDamage(chomp, incin, 'Dragon Claw', MC);
    const over = calcDamage(chomp, incin, 'Dragon Claw', boosted);
    expect(over.max).toBeGreaterThan(base.max * 1.8);
  });
});

describe('speed & thresholds', () => {
  it('final speed with Tailwind and Scarf', () => {
    expect(finalSpeed(chomp, MC)).toBe(169);
    expect(finalSpeed(chomp, MC, { tailwind: true })).toBe(338);
    expect(finalSpeed({ ...chomp, item: 'Choice Scarf' }, MC)).toBe(253);
  });

  it('min Speed SP to outspeed, and wasted SP', () => {
    const r = minSpeedSp({ ...chomp, sp: { ...chomp.sp, spe: 0 } }, MC, 150)!;
    expect(r.speed).toBeGreaterThan(150);
    expect(finalSpeed({ ...chomp, sp: { ...chomp.sp, spe: r.sp - 1 } }, MC)).toBeLessThanOrEqual(150);
    expect(wastedSpeedSp(chomp, MC, 150)).toBe(32 - r.sp);
  });

  it('min bulk to survive is minimal and correct', () => {
    const def = { ...incin, item: undefined, sp: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };
    const r = minBulkToSurvive(chomp, def, 'Dragon Claw', MC)!;
    expect(r).not.toBeNull();
    expect(r.survivalChance).toBe(1);
    // one less total point can never give a guaranteed survival
    for (let hp = 0; hp <= r.totalUsed - 1; hp++) {
      const trial = { ...def, sp: { ...def.sp, hp, def: r.totalUsed - 1 - hp } };
      expect(calcDamage(chomp, trial, 'Dragon Claw', MC, { accuracy: 1, ignoreCrit: true }).koChance[0]).toBeGreaterThan(0);
    }
  });

  it('min offense to OHKO', () => {
    const frail = makeBuild({ species: 'Dragapult', ability: 'Clear Body', alignment: 'Hardy', moves: ['Protect'] });
    const r = minOffenseToKO({ ...chomp, sp: { ...chomp.sp, atk: 0 } }, frail, 'Dragon Claw', MC);
    expect(r).not.toBeNull();
    expect(r!.koChance).toBe(1);
    if (r!.sp > 0) {
      const less = calcDamage({ ...chomp, sp: { ...chomp.sp, atk: r!.sp - 1 } }, frail, 'Dragon Claw', MC, { accuracy: 1, ignoreCrit: true });
      expect(less.koChance[0]).toBeLessThan(1);
    }
  });
});

describe('performance budget', () => {
  it('a single damage calc stays well under 5 ms on average', () => {
    const t0 = performance.now();
    const N = 500;
    for (let i = 0; i < N; i++) calcDamage(chomp, incin, 'Earthquake', MC);
    const avg = (performance.now() - t0) / N;
    console.log(`avg calcDamage: ${avg.toFixed(3)} ms`);
    expect(avg).toBeLessThan(5);
  });
});
