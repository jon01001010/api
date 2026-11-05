/**
 * Hugging Face's model search only matches text inside the repo id
 * (`owner/name`), so a typed query is turned into a search the API can
 * answer plus a check the results must pass.
 *
 * - Words are matched in any order, and "granite 3.1" finds
 *   "granite-3.1-…": spaces, dashes, dots and underscores are equal.
 * - "moe" (mixture of experts) is not part of repo names; those models name
 *   their active size instead (`a400m`, `a3b`, `A1B`), so "moe" becomes that.
 */
export interface SearchPlan {
  /** Text sent to the API's `search` (a substring of the repo id). */
  search: string;
  /** Extra check on each result's id; absent when the API search suffices. */
  matches?: (id: string) => boolean;
}

const MOE_WORDS = new Set(['moe', 'mixture-of-experts', 'experts', 'expert']);
/** `-a400m`, `-A3B`, `_a1.5b`: the active-parameter tag MoE repos carry. */
const ACTIVE_SIZE = /(^|[-_.])a\d+(\.\d+)?[mb]($|[-_.])/i;

const squash = (text: string) => text.toLowerCase().replace(/[\s\-_.]+/g, '');

export function planSearch(query: string): SearchPlan {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const wantsMoe = words.some(w => MOE_WORDS.has(w));
  const terms = words.filter(w => !MOE_WORDS.has(w));

  if (terms.length <= 1 && !wantsMoe) {
    return {search: query.trim()};
  }
  // The longest word is the most selective one the API can search on.
  const search = [...terms].sort((a, b) => b.length - a.length)[0] ?? '';
  const parts = terms.map(squash).filter(Boolean);
  return {
    search,
    matches: id => {
      const flat = squash(id);
      return (
        parts.every(p => flat.includes(p)) &&
        (!wantsMoe || ACTIVE_SIZE.test(id))
      );
    },
  };
}
