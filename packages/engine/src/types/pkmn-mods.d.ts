// @pkmn/mods ships .d.ts files its package.json "exports" map does not expose.
// The data is cast to ModData at the use site (see src/data/dex.ts), as the package README recommends.
declare module '@pkmn/mods/champions';
