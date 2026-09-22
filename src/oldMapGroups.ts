// Shared by the browser selectors and the build-time count catalogue.
export const OLD_MAP_SELECTION_GROUPS: Record<string, readonly string[]> = {
  'atlas-1912': ['cartografia-1912', 'taipa-1912', 'coloane-1912'],
}

export function oldMapSelectionId(id: string): string {
  return Object.keys(OLD_MAP_SELECTION_GROUPS).find(group => OLD_MAP_SELECTION_GROUPS[group].includes(id)) ?? id
}
