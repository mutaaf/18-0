/**
 * Every team code the sources use, mapped onto its franchise lineage.
 *
 * nflverse collapses relocations onto the current franchise code in its
 * statistics but not in its schedules, so `LA`, `STL`, `SD`, `OAK` and the
 * rest all still appear and all still have to land on the right city. Shared
 * because the dataset build and the schedule build must agree about who is
 * who -- they used to hold separate copies, which is one edit away from a
 * gameday that offers a franchise the dataset has never heard of.
 */
export const TEAM_TO_FRANCHISE: Readonly<Record<string, string>> = {
  ARI: 'ari', ATL: 'atl', BAL: 'bal', BUF: 'buf', CAR: 'car', CHI: 'chi', CIN: 'cin',
  CLE: 'cle', DAL: 'dal', DEN: 'den', DET: 'det', GB: 'gb', HOU: 'hou', IND: 'ind',
  JAX: 'jax', KC: 'kc', LA: 'lar', LAR: 'lar', STL: 'lar', LAC: 'lac', SD: 'lac',
  LV: 'lv', OAK: 'lv', MIA: 'mia', MIN: 'min', NE: 'ne', NO: 'no', NYG: 'nyg',
  NYJ: 'nyj', PHI: 'phi', PIT: 'pit', SEA: 'sea', SF: 'sf', TB: 'tb', TEN: 'ten',
  WAS: 'was',
};

/** The franchise a team code belongs to, or null if the code is unknown. */
export function franchiseForTeam(code: string): string | null {
  return TEAM_TO_FRANCHISE[code.trim().toUpperCase()] ?? null;
}
