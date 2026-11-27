import { describe, expect, it } from 'vitest';
import { makeBuild } from '../src/build.js';
import { decide, evaluate, joint, slotOptions, solveZeroSum, type BotContext } from '../src/battle/bot.js';
import { newBattle } from '../src/battle/sim.js';
import { parseLog, reviewBattle } from '../src/battle/log.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const T = (species: string, item: string, ability: string, alignment: string, moves: string[], sp: Record<string, number>) => makeBuild({ species, item, ability, alignment, moves, sp });

const teamA = [
  T('Garchomp', 'Choice Scarf', 'Rough Skin', 'Jolly', ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Stomping Tantrum'], { hp: 2, atk: 32, spe: 32 }),
  T('Incineroar', 'Sitrus Berry', 'Intimidate', 'Careful', ['Fake Out', 'Flare Blitz', 'Parting Shot', 'Protect'], { hp: 32, atk: 2, spd: 32 }),
  T('Sinistcha', 'Leftovers', 'Hospitality', 'Bold', ['Matcha Gotcha', 'Rage Powder', 'Trick Room', 'Protect'], { hp: 32, def: 32, spa: 2 }),
  T('Kingambit', 'Black Glasses', 'Defiant', 'Adamant', ['Kowtow Cleave', 'Sucker Punch', 'Iron Head', 'Protect'], { hp: 32, atk: 32, spe: 2 }),
  T('Whimsicott', 'Focus Sash', 'Prankster', 'Timid', ['Tailwind', 'Moonblast', 'Encore', 'Protect'], { hp: 2, spa: 32, spe: 32 }),
  T('Sneasler', 'White Herb', 'Unburden', 'Jolly', ['Close Combat', 'Dire Claw', 'Fake Out', 'Protect'], { hp: 2, atk: 32, spe: 32 }),
];

const ctx = (): BotContext => ({ guesses: {}, revealed: new Set(teamA.map((b) => b.species)), depth: 1, rng: () => 0.5 });

function play(botSide: 'p1' | 'p2', seed: number[], maxTurns = 40) {
  const b = newBattle('doubles', { name: 'Uno', team: teamA }, { name: 'Dos', team: teamA }, seed);
  b.choose('p1', 'team 1234');
  b.choose('p2', 'team 5621');
  let rnd = seed[0]!;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let maxMs = 0;
  for (let step = 0; step < maxTurns * 3 && !b.ended; step++) {
    for (const side of ['p1', 'p2'] as const) {
      const r = (b.sides[side === 'p1' ? 0 : 1] as any).activeRequest;
      if (!r || r.wait || b.ended) continue;
      if (side === botSide) {
        const d = decide(b, side, ctx());
        maxMs = Math.max(maxMs, d.ms);
        if (!b.choose(side, d.choice)) b.choose(side, 'default');
      } else {
        const opts = joint(slotOptions(b, side));
        const o = opts[Math.floor(rand() * opts.length)];
        if (!o || !b.choose(side, o.choice)) b.choose(side, 'default');
      }
    }
    (b as any).sentLogPos = b.log.length;
  }
  return { won: b.winner === (botSide === 'p1' ? 'Uno' : 'Dos'), ended: b.ended, turns: b.turn, maxMs };
}

describe('battle engine (Showdown + Champions)', () => {
  it('uses Champions stats: HP = base + SP + 75', () => {
    const b = newBattle('doubles', { name: 'A', team: teamA }, { name: 'B', team: teamA }, [1, 2, 3, 4]);
    b.choose('p1', 'team 1234');
    b.choose('p2', 'team 1234');
    const chomp = (b.sides[0] as any).pokemon.find((p: any) => p.species.name === 'Garchomp');
    expect(chomp.maxhp).toBe(108 + 2 + 75);
    expect(evaluate(b, 'p1')).toBeCloseTo(evaluate(b, 'p2'), 5); // same teams, same position
  });

  it('solves a matching-pennies style game with a 50/50 mix', () => {
    const eq = solveZeroSum([
      [1, -1],
      [-1, 1],
    ]);
    expect(eq.row[0]).toBeCloseTo(0.5, 1);
    expect(eq.value).toBeCloseTo(0, 1);
  });

  it('the bot beats a random player', () => {
    let wins = 0;
    let worst = 0;
    const seeds = [
      [11, 22, 33, 44],
      [5, 6, 7, 8],
      [101, 202, 303, 404],
      [7, 77, 777, 7777],
    ];
    seeds.forEach((s, i) => {
      const r = play(i % 2 ? 'p1' : 'p2', s);
      expect(r.ended).toBe(true);
      if (r.won) wins++;
      worst = Math.max(worst, r.maxMs);
    });
    console.log(`bot won ${wins}/${seeds.length}, slowest decision ${worst.toFixed(0)} ms`);
    expect(wins).toBeGreaterThanOrEqual(3);
  }, 240_000);
});

describe('replay reader', () => {
  const replay = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/replay-vgc.json', import.meta.url)), 'utf8'));
  it('parses a real Showdown Reg M-C replay', () => {
    const pb = parseLog(replay.log);
    expect(pb.gameType).toBe('doubles');
    expect(pb.players.p1).toBe('Jugador1');
    expect(pb.winner).toBe('Jugador2');
    expect(pb.brought.p1).toHaveLength(4);
    expect(pb.revealed.p1.Gardevoir?.mega).toBe('Gardevoirite');
    const t4 = pb.turns.find((t) => t.turn === 4)!;
    expect(t4.actions.find((a) => a.actor === 'Hawlucha')?.kos).toContain('Volcarona');
  });
  it('flags attacks into Protect and finds the decisive turns', () => {
    const pb = parseLog(replay.log);
    const r = reviewBattle(pb, 'p1', undefined, () => undefined);
    expect(r.summary.kosAgainst).toBe(4);
    expect(r.summary.intoProtect).toBeGreaterThan(0);
    expect(r.keyTurns.length).toBeGreaterThan(0);
    expect(pb.turns.at(-1)!.winP1).toBeLessThan(0.5);
  });
});
