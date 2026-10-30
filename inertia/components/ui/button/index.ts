import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Button } from './Button.vue'

/**
 * shadcn-vue's button, on the Carbonio tokens (docs/ui.md "Look"): primary
 * is black (white in dark), secondary bordered; flat, 3px corners, brand-red
 * focus ring. `touch` is the 44px size for phones and forms used on them.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-card text-foreground hover:bg-background',
        ghost: 'text-foreground hover:bg-background',
      },
      size: {
        'default': 'h-9 px-4 has-[>svg]:px-3',
        'sm': 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        'touch': 'h-11 px-5 has-[>svg]:px-4',
        'icon': 'size-9',
        'icon-touch': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)
export type ButtonVariants = VariantProps<typeof buttonVariants>
