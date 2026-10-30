/**
 * The app shell's controls (docs/ui.md "Menu"), shared by the shell and
 * the component gallery (`/dev/ui`), which shows them in each state.
 */
import { cn } from '~/lib/utils'

// The red cut marks the active item (aria-current, set by NavLink)
const ACTIVE = cn(
  "aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-semibold aria-[current=page]:text-sidebar-accent-foreground aria-[current=page]:after:absolute aria-[current=page]:after:top-1/2 aria-[current=page]:after:-mt-1.5 aria-[current=page]:after:h-3 aria-[current=page]:after:w-[7px] aria-[current=page]:after:-skew-y-[40deg] aria-[current=page]:after:bg-sidebar-brand aria-[current=page]:after:content-['']"
)

/** A menu item: compact in the sidebar (folded to an icon on a tablet), roomier in the drawer */
export function sidebarItemClass(drawer: boolean) {
  return cn(
    'relative flex items-center gap-2.5 rounded-sm text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-brand',
    ACTIVE,
    drawer
      ? 'min-h-11 px-3.5 text-base aria-[current=page]:after:right-3.5'
      : 'h-[34px] px-3 text-sm aria-[current=page]:after:right-3 md:max-lg:justify-center md:max-lg:px-0 md:max-lg:aria-[current=page]:after:right-1'
  )
}

/** The bordered square buttons by the user (theme, log out) */
export function sidebarIconButtonClass(drawer: boolean) {
  return cn(
    'grid place-items-center rounded-sm border border-sidebar-border text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-brand focus-visible:outline-none',
    drawer ? 'size-11' : 'size-9'
  )
}

/** "☰" and "×" on the phone's black bar and in the drawer: 44px touch targets */
export const BAR_BUTTON = cn(
  'grid size-11 place-items-center rounded-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-sidebar-brand'
)
