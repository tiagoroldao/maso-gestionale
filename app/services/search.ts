/**
 * A LIKE pattern matching `term` anywhere, with LIKE wildcards escaped so
 * a search for "50%" matches literally.
 */
export function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}
