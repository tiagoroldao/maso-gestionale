<script setup lang="ts">
import { t } from '~/i18n'
import Page from '~/components/page.vue'
import { Building2, CalendarClock, Percent, Tags, Wrench } from 'lucide-vue-next'
import NavLink, { type NavItem } from '~/components/nav_link.vue'

/**
 * The pages of the settings area, listed in the sidebar. Each settings
 * page renders inside the app layout and this layout:
 *
 * `<AppLayout><SettingsLayout>…</SettingsLayout></AppLayout>`
 */
const items: NavItem[] = [
  { label: t('ui.settings.company'), route: 'company_settings.edit', icon: Building2 },
  { label: t('ui.settings.paymentTerms'), route: 'payment_terms.index', icon: CalendarClock },
  { label: t('ui.settings.categories'), route: 'categories.index', icon: Tags },
  { label: t('ui.settings.rates'), route: 'rates.index', icon: Wrench },
  { label: t('ui.settings.vatCodes'), route: 'vat_codes.index', icon: Percent },
]
</script>

<template>
  <Page :title="t('ui.settings.title')" :description="t('ui.settings.description')">
    <div class="sidebar-layout">
      <nav class="sidebar-layout__nav" :aria-label="t('ui.settings.title')">
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
