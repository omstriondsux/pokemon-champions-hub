import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adviseSelection, combinations, evaluatePair, supportValue, makeBuild, opponentModel, pairScore, Regulation, registeredForme, selectionValue, validateSelection, validateTeam, type MetaSnapshot } from '../src/index.js';

const ROOT = join(__dirname, '../../..');
const MC = new Regulation(JSON.parse(readFileSync(join(ROOT, 'data/regulations/M-C.json'), 'utf8')));
const snap = (mode: string): MetaSnapshot => JSON.parse(readFileSync(join(ROOT, `data/snapshots/smogon/2026-10/${mode}-1630.json`), 'utf8'));
const DOUBLES = snap('doubles');
const SINGLES = snap('singles');

const team = [
  makeBuild({ species: 'Garchomp', ability: 'Rough Skin', item: 'Life Orb', alignment: 'Jolly', moves: ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Protect'], sp: { hp: 2, atk: 32, spe: 32 } }),
  makeBuild({ species: 'Incineroar', ability: 'Intimidate', item: 'Sitrus Berry', alignment: 'Careful', moves: ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Darkest Lariat'], sp: { hp: 32, def: 14, spd: 20 } }),
  makeBuild({ species: 'Rillaboom', ability: 'Grassy Surge', item: 'Miracle Seed', alignment: 'Adamant', moves: ['Fake Out', 'Grassy Glide', 'Wood Hammer', 'U-turn'], sp: { hp: 32, atk: 32, spd: 2 } }),
  makeBuild({ species: 'Sinistcha', ability: 'Hospitality', item: 'Rocky Helmet', alignment: 'Bold', moves: ['Matcha Gotcha', 'Trick Room', 'Rage Powder', 'Strength Sap'], sp: { hp: 32, def: 32, spa: 2 } }),
  makeBuild({ species: 'Kingambit', ability: 'Defiant', item: 'Black Glasses', alignment: 'Adamant', moves: ['Kowtow Cleave', 'Sucker Punch', 'Iron Head', 'Protect'], sp: { hp: 32, atk: 32, spd: 2 } }),
  makeBuild({ species: 'Archaludon', ability: 'Stamina', item: 'Leftovers', alignment: 'Modest', moves: ['Electro Shot', 'Flash Cannon', 'Draco Meteor', 'Protect'], sp: { hp: 32, spa: 32, spd: 2 } }),
];
const rivals = ['Sneasler', 'Charizard', 'Basculegion', 'Farigiraf', 'Indeedee-F', 'Pelipper'];

describe('fixture', () => {
  it('the test team is itself legal in M-C (Champions differs from SV: no Assault Vest, no Knock Off on Incineroar)', async () => {
    expect((await validateTeam(team, MC, 'doubles')).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('opponent model', () => {
  it('includes Mega formes hidden at team preview, weighted by usage', async () => {
    const m = await opponentModel('Charizard', DOUBLES);
    expect(m.source).toBe('meta');
    expect(m.candidates.some((c) => c.forme.includes('Mega'))).toBe(true);
    expect(m.candidates.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
    expect(m.candidates[0]!.build.species).toBe('Charizard'); // registered as base species + stone
  });

  it('falls back to an explicit hypothesis without data', async () => {
    const m = await opponentModel('Garchomp', undefined);
    expect(m.reliability).toBe('hypothesis');
    expect(m.candidates[0]!.build.moves.length).toBeGreaterThan(0);
  });
});

describe('selection maths', () => {
  it('pair score: faster OHKO vs 2HKO is a clear win; mirror speed tie is neutral', () => {
    expect(pairScore(1, 2, 1)).toBeCloseTo(0.75);
    expect(pairScore(1, 1, 0.5)).toBe(0);
    expect(pairScore(2, 1, 0)).toBeCloseTo(-0.75);
  });
  it('combinations and coverage value', () => {
    expect(combinations([0, 1, 2, 3, 4, 5], 4)).toHaveLength(15);
    const M = [[1, -1], [-1, 1]];
    expect(selectionValue([0, 1], [0, 1], M)).toBeCloseTo(0.6);
    expect(selectionValue([0], [0, 1], M)).toBeCloseTo(0);
  });
});

describe('battle advisor', () => {
  it('doubles: 3 legal alternatives of 4 from the registered team, 2 leads + 2 back, fast', async () => {
    const opps = await Promise.all(rivals.map((s) => opponentModel(s, DOUBLES)));
    const r = adviseSelection(team, opps, MC, { format: 'doubles' }, DOUBLES.meta);
    console.log(`doubles advisor: ${r.elapsedMs.toFixed(0)} ms`);
    expect(r.alternatives).toHaveLength(3);
    for (const a of r.alternatives) {
      expect(validateSelection(team, a.members, MC, 'doubles')).toEqual([]);
      expect(a.leads).toHaveLength(2);
      expect([...a.leads, ...a.back].sort()).toEqual([...a.members].sort());
    }
    expect(r.threats).toHaveLength(6);
    expect(r.elapsedMs).toBeLessThan(3000);
  });

  it('singles: picks 3 with 1 lead', async () => {
    const opps = await Promise.all(['Primarina', 'Gholdengo', 'Garchomp', 'Hippowdon', 'Salamence', 'Mimikyu'].map((s) => opponentModel(s, SINGLES)));
    const r = adviseSelection(team, opps, MC, { format: 'singles' }, SINGLES.meta);
    console.log(`singles advisor: ${r.elapsedMs.toFixed(0)} ms`);
    for (const a of r.alternatives) {
      expect(a.members).toHaveLength(3);
      expect(a.leads).toHaveLength(1);
    }
  });

  it('conservative pick never has a worse worst-quartile than the best-average pick', async () => {
    const opps = await Promise.all(rivals.map((s) => opponentModel(s, DOUBLES)));
    const r = adviseSelection(team, opps, MC, { format: 'doubles' });
    const [best, cons] = r.alternatives;
    expect(cons!.worstQuartile).toBeGreaterThanOrEqual(best!.worstQuartile - 1e-12);
  });
});

describe('threat variants', () => {
  it('a dangerous variant is only flagged when it flips one of my answers', async () => {
    const opps = await Promise.all(rivals.map((s) => opponentModel(s, DOUBLES)));
    const r = adviseSelection(team, opps, MC, { format: 'doubles' });
    for (const th of r.threats) {
      if (!th.dangerousVariant) continue;
      expect(th.answers.length).toBeGreaterThan(0);
      expect(th.dangerousVariant.worst).toBeLessThan(0);
    }
  });
});

describe('roster gaps between data sources', () => {
  it('every species in the usage stats can be modelled and evaluated (Aegislash, Floette-Mega…)', async () => {
    const me = team[0]!;
    for (const S of [DOUBLES, SINGLES]) {
      for (const name of Object.keys(S.pokemon)) {
        const m = await opponentModel(name, S);
        expect(() => evaluatePair(me, m, MC, { format: 'doubles' }), name).not.toThrow();
      }
    }
  }, 60_000);

  it('megas are registered as the forme holding the stone', async () => {
    expect(registeredForme('Floette-Mega')).toBe('Floette-Eternal');
    expect(registeredForme('Charizard-Mega-Y')).toBe('Charizard');
    const m = await opponentModel('Floette-Eternal', DOUBLES);
    expect(m.candidates.some((c) => c.forme === 'Floette-Mega')).toBe(true);
  });
});

describe('support value', () => {
  it('credits Intimidate vs physical teams and Trick Room when slower; bounded', () => {
    const ctx = { mySpeed: [50, 60], oppSpeed: [100, 120], oppPhysical: [1, 1], oppTrickRoom: false, doubles: true, team: [team[1]!, team[3]!] };
    const r = supportValue([0, 1], [0, 1], ctx);
    expect(r.value).toBeGreaterThan(0.1);
    expect(r.value).toBeLessThanOrEqual(0.2);
    expect(r.why.join(' ')).toMatch(/Intimidate/);
    expect(r.why.join(' ')).toMatch(/Trick Room/);
    const fast = supportValue([0, 1], [0, 1], { ...ctx, mySpeed: [200, 200], oppPhysical: [0, 0] });
    expect(fast.value).toBeLessThan(r.value);
  });
});

describe('Bayesian update and archetypes', () => {
  it('revealed item filters candidates; inconsistent evidence synthesises a labelled set', async () => {
    const base = await opponentModel('Garchomp', DOUBLES);
    const items = new Set(base.candidates.map((c) => c.build.item));
    const someItem = [...items][0]!;
    const upd = await opponentModel('Garchomp', DOUBLES, { reveals: { item: someItem, moves: ['Earthquake'] } });
    expect(upd.updatedByReveals).toBe(true);
    expect(upd.candidates.every((c) => c.build.item === someItem)).toBe(true);
    expect(upd.candidates.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1);
    const odd = await opponentModel('Garchomp', DOUBLES, { reveals: { item: 'Leek' } });
    expect(odd.candidates).toHaveLength(1);
    expect(odd.candidates[0]!.build.item).toBe('Leek');
  });

  it('a Trick Room team raises the weight of min-speed spreads', async () => {
    const plain = await opponentModel('Farigiraf', DOUBLES);
    const tr = await opponentModel('Farigiraf', DOUBLES, { team: ['Farigiraf', 'Indeedee-F', 'Sinistcha'] });
    expect(tr.archetypes).toContain('trickroom');
    const slow = (m: typeof plain) => m.candidates.filter((c) => c.build.sp.spe === 0).reduce((s, c) => s + c.weight, 0);
    expect(slow(tr)).toBeGreaterThanOrEqual(slow(plain));
  });
});
