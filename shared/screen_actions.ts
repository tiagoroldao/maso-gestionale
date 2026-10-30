/**
 * A screen's actions (docs/ui.md "Actions", ADR 0020): the server declares
 * them once, already filtered by the user's role and the record's state,
 * each ranked primary (at most one), secondary or overflow. The page
 * renders the same list as header buttons on desktop, and as the header's
 * action row, its "⋯" and the bottom bar on the phone.
 */

export const ACTION_RANKS = ['primary', 'secondary', 'overflow'] as const
export type ActionRank = (typeof ACTION_RANKS)[number]

/**
 * What an action does: open a page (`link`: an app path, or a contact's
 * `tel:` or map URL), post to the server (`post`),
 * open the screen's own dialog (`dialog`: a short form, such as the
 * options of a draft Invoice), which the page renders by the action's name,
 * or submit the form the screen sits in (`submit`: Save, on a screen in
 * edit mode), or the page's form its `form` names when that form doesn't
 * wrap the header.
 */
export const ACTION_KINDS = ['link', 'post', 'dialog', 'submit'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

export type ScreenAction = {
  /** Unique on the screen: names the page's dialog, and the action in tests */
  name: string
  /** Shown as is: the server translates it */
  label: string
  rank: ActionRank
  kind: ActionKind
  /** The page a `link` opens, or the route a `post` posts to; null for a `dialog` or `submit` */
  href: string | null
  /**
   * The id of the page's form a `submit` submits, when the form doesn't wrap
   * the header; null for a screen sitting in its form, and the other kinds
   */
  form: string | null
  /** Delete, cancel, set back to bill: always overflow, always confirmed */
  destructive: boolean
  /** The question asked first, for a destructive or irreversible action */
  confirm: string | null
  /** Blocked by the record's state but expected here: shown disabled, with this reason */
  disabledReason: string | null
}

export type ScreenActionInput = Pick<ScreenAction, 'name' | 'label' | 'rank' | 'kind'> &
  Partial<Pick<ScreenAction, 'href' | 'form' | 'destructive' | 'confirm' | 'disabledReason'>>

/** A mistake in a screen's declaration: a developer's, so it fails loudly */
export class ScreenActionsError extends Error {}

/**
 * The actions of a screen, checked against docs/ui.md "Actions": one
 * primary at most, unique names, a destination for links and posts, and
 * destructive ones in the overflow and confirmed.
 */
export function declareActions(actions: ScreenActionInput[]): ScreenAction[] {
  const names = new Set<string>()
  const declared = actions.map((action) => {
    if (names.has(action.name)) throw new ScreenActionsError(`Two actions named ${action.name}`)
    names.add(action.name)
    const full: ScreenAction = {
      href: null,
      form: null,
      destructive: false,
      confirm: null,
      disabledReason: null,
      ...action,
    }
    if ((full.kind === 'link' || full.kind === 'post') && !full.href) {
      throw new ScreenActionsError(`Action ${full.name} needs an href`)
    }
    if (full.destructive && (full.rank !== 'overflow' || !full.confirm)) {
      throw new ScreenActionsError(`Destructive action ${full.name} must be overflow and confirmed`)
    }
    return full
  })
  if (declared.filter((action) => action.rank === 'primary').length > 1) {
    throw new ScreenActionsError('A screen has one primary action at most')
  }
  return declared
}

/**
 * A screen in edit mode (a form to create or edit a record): Save, its
 * primary, submits the form the screen sits in, or the page's form with
 * the id `form` when that form doesn't wrap the header.
 */
export function saveActions(label: string, form?: string) {
  return declareActions([
    { name: 'save', label, rank: 'primary', kind: 'submit', form: form ?? null },
  ])
}

/** Secondary actions shown as buttons; the rest go in "⋯" */
export const MAX_SECONDARY = 2

/**
 * Where each action goes: the primary, up to two secondary buttons, and
 * "⋯" holding the overflow and any secondary beyond two (in that order,
 * the extra secondary first), each group in the declared order.
 */
export function arrangeActions(actions: ScreenAction[]) {
  const secondary = actions.filter((action) => action.rank === 'secondary')
  return {
    primary: actions.find((action) => action.rank === 'primary') ?? null,
    secondary: secondary.slice(0, MAX_SECONDARY),
    overflow: [
      ...secondary.slice(MAX_SECONDARY),
      ...actions.filter((action) => action.rank === 'overflow'),
    ],
  }
}
