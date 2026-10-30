<script setup lang="ts">
import { t } from '~/i18n'
import Page from '~/components/page.vue'
import NavLink from '~/components/nav_link.vue'
import { SETTINGS_PAGES as items } from '~/components/settings_pages'

/**
 * The settings area's old layout, kept for the pages not yet on the new UI
 * (the Document Templates): each renders inside the app layout and this one,
 * `<AppLayout><SettingsLayout>…</SettingsLayout></AppLayout>`. The pages on
 * the new UI use `SettingsScreen` instead.
 */
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
