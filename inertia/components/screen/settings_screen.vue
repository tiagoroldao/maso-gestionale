<script setup lang="ts">
/**
 * A page of the settings area (docs/ui.md "Settings"): a screen whose
 * header names the page under Impostazioni, then the area's tabs, then the
 * page's sections. The company's details are the area's home, so their
 * page has no parent; the others go back to it.
 */
import { computed } from 'vue'
import { t } from '~/i18n'
import { urlFor } from '~/client'
import type { ScreenAction } from '@shared/screen_actions'
import type { NavRoute } from '~/components/nav_link.vue'
import { SETTINGS_PAGES } from '~/components/settings_pages'
import EntityScreen from './entity_screen.vue'
import SettingsNav from './settings_nav.vue'

const props = withDefaults(
  defineProps<{
    /** The page's route, naming it and marking its tab */
    route: NavRoute
    actions?: ScreenAction[]
    /** The page's form is being submitted: Save waits */
    busy?: boolean
  }>(),
  { actions: () => [], busy: false }
)
const emit = defineEmits<{ dialog: [name: string] }>()

const home = SETTINGS_PAGES[0]
const isHome = computed(() => props.route === home.route)
const title = computed(() => SETTINGS_PAGES.find((page) => page.route === props.route)?.label ?? '')
const crumbs = computed(() =>
  isHome.value ? [] : [{ label: t('ui.settings.title'), href: urlFor(home.route) }]
)
</script>

<template>
  <EntityScreen
    :document-title="`${title} · ${t('ui.settings.title')}`"
    :crumbs="crumbs"
    :current="isHome ? t('ui.settings.title') : title"
    :title="title"
    :actions="actions"
    :busy="busy"
    @dialog="(name) => emit('dialog', name)"
  >
    <SettingsNav :current="route" />
    <slot />
  </EntityScreen>
</template>
