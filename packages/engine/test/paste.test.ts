import { describe, expect, it } from 'vitest';
import { evToSp, exportPaste, importPaste, statValue } from '../src/index.js';

const PASTE = `Garchomp @ Life Orb
Ability: Rough Skin
Level: 50
EVs: 2 HP / 32 Atk / 32 Spe
Jolly Nature
- Earthquake
- Dragon Claw
- Rock Slide
- Protect

Charizard-Mega-Y @ Charizardite Y
Ability: Blaze
EVs: 4 HP / 252 SpA / 252 Spe
Timid Nature
- Heat Wave
- Solar Beam
- Protect
- Air Slash`;

describe('Showdown paste', () => {
  it('imports SP pastes as-is and converts classic EVs', () => {
    const { builds, warnings } = importPaste(PASTE);
    expect(builds).toHaveLength(2);
    expect(builds[0]!.sp).toEqual({ hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 });
    expect(builds[1]!.species).toBe('Charizard'); // mega → base species + stone
    expect(builds[1]!.sp.spa).toBe(32);
    expect(builds[1]!.sp.hp).toBe(1);
    expect(warnings.some((w) => w.includes('convertidos'))).toBe(true);
  });

  it('EV→SP conversion is exact at Lv50/IV31', () => {
    // classic Lv50 stat: floor((2B + 31 + floor(EV/4)) / 2) + 5
    const classic = (b: number, ev: number) => Math.floor((2 * b + 31 + Math.floor(ev / 4)) / 2) + 5;
    for (const ev of [0, 4, 12, 20, 100, 252]) expect(statValue('atk', 100, evToSp(ev))).toBe(classic(100, ev));
  });

  it('round-trips', () => {
    const { builds } = importPaste(PASTE);
    const again = importPaste(exportPaste(builds));
    expect(again.builds[0]).toEqual(builds[0]);
  });
});
