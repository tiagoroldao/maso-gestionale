<script setup lang="ts">
import Page from '~/components/page.vue'
import { Building2, CalendarClock } from 'lucide-vue-next'
import NavLink, { type NavItem } from '~/components/nav_link.vue'

/**
 * The pages of the settings area, listed in the sidebar. Each settings
 * page renders inside the app layout and this layout:
 *
 * `<AppLayout><SettingsLayout>…</SettingsLayout></AppLayout>`
 */
const items: NavItem[] = [
  { label: 'Company', route: 'company_settings.edit', icon: Building2 },
  { label: 'Payment Terms', route: 'payment_terms.index', icon: CalendarClock },
]
</script>

<template>
  <Page title="Settings" description="Company details and the options used across the app.">
    <div class="sidebar-layout">
      <nav class="sidebar-layout__nav" aria-label="Settings">
        <NavLink
          v-for="item in items"
          :key="item.label"
          :route="item.route"
          exact
          class="sidebar-layout__item"
        >
          <component :is="item.icon" v-if="item.icon" :size="16" />
          {{ item.label }}
        </NavLink>
      </nav>
      <div class="sidebar-layout__content panel">
        <slot />
      </div>
    </div>
  </Page>
</template>
