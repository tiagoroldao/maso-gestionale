<script setup lang="ts">
/**
 * The settings area's own menu (docs/ui.md "Settings"): its pages as a row
 * of tabs under the header, the current one underlined in brand red, as
 * the active menu item is marked. On a phone the row scrolls sideways
 * instead of wrapping.
 */
import { Link } from '@adonisjs/inertia/vue'
import { t } from '~/i18n'
import { urlFor } from '~/client'
import { SETTINGS_PAGES } from '~/components/settings_pages'
import type { NavRoute } from '~/components/nav_link.vue'

defineProps<{ current: NavRoute }>()
</script>

<template>
  <nav
    :aria-label="t('ui.settings.title')"
    class="-mx-3.5 overflow-x-auto border-b border-border md:mx-0"
  >
    <ul class="m-0 flex w-max list-none gap-1 px-3.5 md:w-auto md:flex-wrap md:px-0">
      <li v-for="item in SETTINGS_PAGES" :key="item.route">
        <Link
          :href="urlFor(item.route)"
          :aria-current="item.route === current ? 'page' : undefined"
          class="-mb-px flex min-h-11 items-center border-b-2 border-transparent px-2.5 font-sans text-sm whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:border-brand aria-[current=page]:font-semibold aria-[current=page]:text-foreground md:min-h-10"
        >
          {{ item.label }}
        </Link>
      </li>
    </ul>
  </nav>
</template>
