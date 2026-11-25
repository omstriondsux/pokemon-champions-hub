import { toID } from '@pch/engine';

export type Lang = 'es' | 'en';

const UI = {
  'nav.dashboard': ['Dashboard', 'Dashboard'],
  'nav.advisor': ['Battle Advisor', 'Battle Advisor'],
  'nav.mypokemon': ['Mis Pokémon', 'My Pokémon'],
  'nav.teams': ['Equipos', 'Teams'],
  'nav.calc': ['Calculadora', 'Damage Calc'],
  'nav.speed': ['Speed Tiers', 'Speed Tiers'],
  'nav.history': ['Historial', 'Battle History'],
  'nav.settings': ['Ajustes', 'Settings'],
  'nav.squad': ['Squad Builder', 'Squad Builder'],
  'nav.optimizer': ['Build Optimizer', 'Build Optimizer'],
  'nav.recruit': ['Reclutamiento', 'Recruitment'],
  'nav.meta': ['Meta Intelligence', 'Meta Intelligence'],
  'nav.coach': ['Coach', 'Coach'],
  'nav.simulator': ['Simulador', 'Situation Sim'],
  'nav.soon': ['Próximamente', 'Coming soon'],
  'mode.singles': ['Individuales', 'Singles'],
  'mode.doubles': ['Dobles', 'Doubles'],
  'common.save': ['Guardar', 'Save'],
  'common.cancel': ['Cancelar', 'Cancel'],
  'common.delete': ['Eliminar', 'Delete'],
  'common.edit': ['Editar', 'Edit'],
  'common.add': ['Añadir', 'Add'],
  'common.new': ['Nuevo', 'New'],
  'common.search': ['Buscar Pokémon…', 'Search Pokémon…'],
  'common.import': ['Importar', 'Import'],
  'common.export': ['Exportar', 'Export'],
  'common.none': ['Ninguno', 'None'],
  'common.loading': ['Cargando…', 'Loading…'],
  'status.available': ['Disponible', 'Available'],
  'status.pending_recruit': ['Pendiente de reclutamiento', 'Pending recruitment'],
  'status.temporary': ['Disponible temporalmente', 'Temporarily available'],
  'status.pending_training': ['Pendiente de entrenamiento', 'Pending training'],
  'status.transferable': ['Potencialmente transferible', 'Potentially transferable'],
  'status.unavailable': ['No disponible', 'Unavailable'],
  'alt.best': ['Mejor selección general', 'Best overall'],
  'alt.conservative': ['Conservadora y consistente', 'Conservative & consistent'],
  'alt.aggressive': ['Agresiva / especializada', 'Aggressive / specialised'],
  'result.win': ['Victoria', 'Win'],
  'result.loss': ['Derrota', 'Loss'],
  'result.draw': ['Empate', 'Draw'],
} as const satisfies Record<string, readonly [string, string]>;

export type UIKey = keyof typeof UI;

export function makeT(lang: Lang) {
  return (k: UIKey) => UI[k][lang === 'es' ? 0 : 1];
}

export type NameKind = 'species' | 'moves' | 'abilities' | 'items' | 'natures' | 'types';
export type NameTable = Partial<Record<NameKind, Record<string, string>>>;

/** Localised game-term names. Falls back to English when no translation exists. */
export function makeNames(lang: Lang, es: NameTable) {
  const tr = (kind: NameKind, name?: string) => {
    if (!name) return '';
    if (lang === 'en') return name;
    return es[kind]?.[toID(name)] ?? name;
  };
  return {
    species: (n?: string) => tr('species', n),
    move: (n?: string) => tr('moves', n),
    ability: (n?: string) => tr('abilities', n),
    item: (n?: string) => tr('items', n),
    nature: (n?: string) => tr('natures', n),
    type: (n?: string) => tr('types', n),
    /** Both names, for search matching. */
    searchKeys: (kind: NameKind, name: string) => [toID(name), toID(es[kind]?.[toID(name)] ?? '')].filter(Boolean),
  };
}
export type Names = ReturnType<typeof makeNames>;
