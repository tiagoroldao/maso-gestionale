import { sumAmounts } from './money.js'

/**
 * How a draft from a Job organises its lines into sections (#184, ADR
 * 0018): by kind (the default), by Visit, by Item category, or not at all.
 */
export const ORGANISE_BY = ['kind', 'visit', 'category', 'none'] as const
export type OrganiseBy = (typeof ORGANISE_BY)[number]
export const DEFAULT_ORGANISE_BY: OrganiseBy = 'kind'

/**
 * The sections of a draft organised by kind, in order: hours (Manodopera),
 * Items (Materiali), Equipment Items (Apparecchi), and the rest (Altro),
 * where lines Office added by hand also go.
 */
export const SECTION_KINDS = ['labour', 'materials', 'equipment', 'other'] as const
export type SectionKind = (typeof SECTION_KINDS)[number]

/**
 * A Charge as organising reads it.
 */
export type OrganisableCharge = {
  kind: 'labour' | 'item' | 'other'
  // An Item marked Equipment (#176)
  equipment: boolean
  // The Item's category, if any
  category: { id: number; name: string } | null
  // Its Visit, the Visit's work day (ISO) and start time (HH:mm), or none
  // for the Job's own
  visitId: number | null
  day: string | null
  time: string | null
}

/**
 * What a section made by organising is about; the caller words its title.
 */
export type Heading =
  | { type: 'kind'; kind: SectionKind }
  | { type: 'category'; name: string }
  | { type: 'visit'; visitId: number; day: string; time: string }
  | { type: 'job' }

/**
 * Where lines Office added by hand go when organising: "Altro", or
 * outside any section when not organised.
 */
export const handLinesHeading = (by: OrganiseBy): Heading | null =>
  by === 'none' ? null : { type: 'kind', kind: 'other' }

export const sameHeading = (a: Heading | null, b: Heading | null) =>
  JSON.stringify(a) === JSON.stringify(b)

/**
 * The Charges (in the order their work happened) split into sections,
 * in order (ADR 0018); each keeps its Charges in their order, and empty
 * ones are left out. Combining then applies within each (ADR 0017).
 * - `kind`: Manodopera, Materiali, Apparecchi (Equipment Items), Altro.
 * - `category`: Manodopera, then each Item category by name, then Altro
 *   (Items without a category, and other costs).
 * - `visit`: one per Visit, in the order of their work, then the Job's
 *   own Charges ("Commessa").
 * - `none`: one group without a heading.
 */
export function organiseCharges<T extends OrganisableCharge>(
  charges: T[],
  by: OrganiseBy
): { heading: Heading | null; charges: T[] }[] {
  if (!charges.length) return []
  if (by === 'none') return [{ heading: null, charges }]

  const groups = new Map<string, { heading: Heading; rank: [number, string]; charges: T[] }>()
  const add = (key: string, heading: Heading, rank: [number, string], charge: T) => {
    if (!groups.has(key)) groups.set(key, { heading, rank, charges: [] })
    groups.get(key)!.charges.push(charge)
  }
  const ofKind = (kind: SectionKind) => ({ type: 'kind' as const, kind })
  charges.forEach((charge) => {
    if (by === 'kind') {
      const kind: SectionKind =
        charge.kind === 'labour'
          ? 'labour'
          : charge.kind === 'item'
            ? charge.equipment
              ? 'equipment'
              : 'materials'
            : 'other'
      add(kind, ofKind(kind), [SECTION_KINDS.indexOf(kind), ''], charge)
    } else if (by === 'category') {
      if (charge.kind === 'labour') add('labour', ofKind('labour'), [0, ''], charge)
      else if (charge.kind === 'item' && charge.category) {
        const { id, name } = charge.category
        add(`category:${id}`, { type: 'category', name }, [1, name], charge)
      } else add('other', ofKind('other'), [2, ''], charge)
    } else if (charge.visitId) {
      // Visits in the order their work first appears
      const heading = {
        type: 'visit' as const,
        visitId: charge.visitId,
        day: charge.day!,
        time: charge.time!,
      }
      add(`visit:${charge.visitId}`, heading, [0, ''], charge)
    } else add('job', { type: 'job' }, [1, ''], charge)
  })
  return [...groups.values()]
    .map((group, index) => ({ group, index }))
    .sort(
      (a, b) =>
        a.group.rank[0] - b.group.rank[0] ||
        a.group.rank[1].localeCompare(b.group.rank[1], 'it') ||
        a.index - b.index
    )
    .map(({ group }) => ({ heading: group.heading, charges: group.charges }))
}

/**
 * Lines in the order they are numbered, printed and sent (ADR 0018):
 * lines outside any section first, then each section's in section order,
 * each keeping its own order; lines `last` (deductions) after them all.
 * `sectionRank` gives a line's section position, or null outside any.
 */
export function inSectionOrder<T>(
  lines: T[],
  sectionRank: (line: T) => number | null,
  last: (line: T) => boolean = () => false
): T[] {
  const rank = (line: T) => (last(line) ? Infinity : (sectionRank(line) ?? -1))
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => rank(a.line) - rank(b.line) || a.index - b.index)
    .map(({ line }) => line)
}

/**
 * Lines grouped as the PDF prints them: runs of consecutive lines of the
 * same section (null outside any), with the section's subtotal, its
 * lines' amounts added up before VAT and the global discount.
 */
export function sectionRuns<L extends { sectionId: number | null; lineTotal: string }>(lines: L[]) {
  const runs: { sectionId: number | null; lines: L[]; subtotal: string }[] = []
  for (const line of lines) {
    const current = runs[runs.length - 1]
    if (current && current.sectionId === line.sectionId) current.lines.push(line)
    else runs.push({ sectionId: line.sectionId, lines: [line], subtotal: '0.00' })
  }
  for (const run of runs) run.subtotal = sumAmounts(run.lines.map((line) => line.lineTotal))
  return runs
}
