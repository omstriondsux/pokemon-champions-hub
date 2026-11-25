import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adviseRecruitment, analyseSituation, buildMetaSet, buildSquads, makeBuild, optimizeBuild, Regulation, validateTeam, type MetaSnapshot, type PoolEntry } from '../src/index.js';

const ROOT = join(__dirname, '../../..');
const MC = new Regulation(JSON.parse(readFileSync(join(ROOT, 'data/regulations/M-C.json'), 'utf8')));
const D: MetaSnapshot = JSON.parse(readFileSync(join(ROOT, 'data/snapshots/smogon/2026-10/doubles-1630.json'), 'utf8'));

const builds = [
  makeBuild({ species: 'Garchomp', ability: 'Rough Skin', item: 'Life Orb', alignment: 'Jolly', moves: ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect'], sp: { hp: 2, atk: 32, spe: 32 } }),
  makeBuild({ species: 'Incineroar', ability: 'Intimidate', item: 'Sitrus Berry', alignment: 'Careful', moves: ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Darkest Lariat'], sp: { hp: 32, def: 14, spd: 20 } }),
  makeBuild({ species: 'Rillaboom', ability: 'Grassy Surge', item: 'Miracle Seed', alignment: 'Adamant', moves: ['Fake Out', 'Grassy Glide', 'Wood Hammer', 'U-turn'], sp: { hp: 32, atk: 32, spd: 2 } }),
  makeBuild({ species: 'Sinistcha', ability: 'Hospitality', item: 'Rocky Helmet', alignment: 'Bold', moves: ['Matcha Gotcha', 'Trick Room', 'Rage Powder', 'Strength Sap'], sp: { hp: 32, def: 32, spa: 2 } }),
  makeBuild({ species: 'Kingambit', ability: 'Defiant', item: 'Black Glasses', alignment: 'Adamant', moves: ['Kowtow Cleave', 'Sucker Punch', 'Iron Head', 'Protect'], sp: { hp: 32, atk: 32, spd: 2 } }),
  makeBuild({ species: 'Archaludon', ability: 'Stamina', item: 'Leftovers', alignment: 'Modest', moves: ['Electro Shot', 'Flash Cannon', 'Draco Meteor', 'Protect'], sp: { hp: 32, spa: 32, spd: 2 } }),
  makeBuild({ species: 'Charizard', ability: 'Solar Power', item: 'Charizardite Y', alignment: 'Timid', moves: ['Heat Wave', 'Solar Beam', 'Protect', 'Air Slash'], sp: { hp: 2, spa: 32, spe: 32 } }),
  makeBuild({ species: 'Garchomp', ability: 'Rough Skin', item: 'Choice Scarf', alignment: 'Jolly', moves: ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Stone Edge'], sp: { hp: 2, atk: 32, spe: 32 } }),
];
const pool: PoolEntry[] = builds.map((b, i) => ({ id: `b${i}`, ownerId: b.species === 'Garchomp' ? 'garchomp' : `o${i}`, label: b.species, build: b, favorite: i === 3 }));

describe('F2 engines', async () => {
  const meta = await buildMetaSet(D, 12);

  it('meta set: top species with normalised usage weights', () => {
    expect(meta.models.length).toBe(12);
    expect(meta.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('build optimizer: measured deltas, no fake improvements', async () => {
    const r = await optimizeBuild(builds[0]!, meta, MC, 'doubles', { budgetEvals: 30 });
    console.log(`optimizer: ${r.elapsedMs.toFixed(0)} ms, ${r.evaluations} evals`);
    expect(r.moves).toHaveLength(4);
    expect(r.moves.find((m) => m.move === 'Protect')!.status).toBe(true);
    for (const s of r.moveSwaps) expect(s.delta).toBeGreaterThan(0);
    if (r.spread) expect(r.spread.delta).toBeGreaterThan(0);
    expect(r.verdict.length).toBeGreaterThan(0);
  }, 60_000);

  it('squad builder: legal teams, locked member kept, one build per owner', async () => {
    const r = buildSquads(pool, meta, MC, 'doubles', 'balanced', { locked: ['b3'] });
    console.log(`squad: ${r.elapsedMs.toFixed(0)} ms`);
    expect(r.teams.length).toBeGreaterThan(0);
    for (const t of r.teams) {
      expect(t.members).toHaveLength(6);
      expect(t.members).toContain(3);
      const team = t.members.map((i) => pool[i]!.build);
      expect((await validateTeam(team, MC, 'doubles')).filter((i) => i.severity === 'error')).toEqual([]);
      expect(new Set(t.members.map((i) => pool[i]!.ownerId)).size).toBe(6);
    }
  }, 60_000);

  it('recruitment: ranks candidates and separates individual vs inventory value', async () => {
    const r = await adviseRecruitment([{ species: 'Sneasler' }, { species: 'Pelipper' }, { species: 'Wigglytuff' }], pool, meta, D, MC, 'doubles');
    console.log(`recruit: ${r.elapsedMs.toFixed(0)} ms`, r.rows.map((x) => x.reasons.join(' ')).join(' || '));
    expect(r.basis).toBe('inventory');
    expect(r.rows.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(r.verdict.length).toBeGreaterThan(0);
  }, 120_000);

  it('situation: ranks actions and threats with current HP', async () => {
    const r = await analyseSituation(
      { format: 'doubles', mine: [{ build: builds[0]!, hpPercent: 100 }, { build: builds[1]!, hpPercent: 60 }], theirs: [{ species: 'Sneasler', hpPercent: 40 }, { species: 'Pelipper', hpPercent: 100, reveals: { moves: ['Tailwind'] } }], field: {} },
      D,
      MC,
    );
    expect(r.actions[0]!.target).toBeGreaterThanOrEqual(0);
    expect(r.threats.length).toBeGreaterThan(0);
    expect(r.models[1]!.updatedByReveals).toBe(true);
  }, 60_000);
});

describe('history personalisation', () => {
  it('small samples barely move the prior; large ones dominate', async () => {
    const { opponentModel, HISTORY_ALPHA } = await import('../src/index.js');
    const base = await opponentModel('Garchomp', D);
    const item = base.candidates[base.candidates.length - 1]!.build.item!;
    const share = (m: typeof base) => m.candidates.filter((c) => c.build.item === item).reduce((s, c) => s + c.weight, 0);
    const one = await opponentModel('Garchomp', D, { history: [{ item }] });
    const many = await opponentModel('Garchomp', D, { history: Array.from({ length: 60 }, () => ({ item })) });
    expect(share(one) - share(base)).toBeLessThan(1 / (1 + HISTORY_ALPHA) + 1e-9);
    expect(share(many)).toBeGreaterThan(0.6);
  });
});
