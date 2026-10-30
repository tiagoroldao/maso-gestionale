<script setup lang="ts">
/**
 * Modelli di documento, a settings screen on the new UI (docs/ui.md
 * "Settings"): the templates in use, each opening its editor, and the
 * archived ones. A new one is the section's action, opening the editor.
 */
import { Link } from '@adonisjs/inertia/vue'
import AppLayout from '~/layouts/app.vue'
import { formatDate, t } from '~/i18n'
import { cn } from '~/lib/utils'
import { buttonVariants } from '~/components/ui/button'
import SettingsScreen from '~/components/screen/settings_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import { EMPTY, LINK, ROW, TOUCH } from '~/components/screen/screen'

defineProps<{
  templates: { id: number; name: string; version: number; savedAt: string }[]
  archived: { id: number; name: string }[]
}>()

// A name opening its template: 44px tall on touch screens
const TARGET = 'inline-flex min-h-11 items-center md:min-h-0'
</script>

<template>
  <AppLayout>
    <SettingsScreen route="document_templates.index">
      <ScreenSection
        :title="t('ui.documentTemplates.title')"
        :description="t('ui.documentTemplates.description')"
        flush
      >
        <template #actions>
          <Link
            route="document_templates.create"
            :class="cn(buttonVariants({ variant: 'outline' }), TOUCH)"
          >
            {{ t('ui.documentTemplates.new') }}
          </Link>
        </template>
        <p v-if="templates.length === 0" :class="EMPTY">
          {{ t('ui.documentTemplates.empty') }}
        </p>
        <ul v-else class="m-0 list-none p-0">
          <li
            v-for="template in templates"
            :key="template.id"
            :class="cn(ROW, 'flex-wrap items-center justify-between md:px-4')"
          >
            <Link
              route="document_templates.edit"
              :params="{ id: template.id }"
              :class="cn(LINK, TARGET, 'min-w-0')"
            >
              {{ template.name }}
            </Link>
            <span class="text-sm text-muted-foreground">
              {{ t('ui.documentTemplates.version', { version: template.version }) }} ·
              {{ formatDate(template.savedAt) }}
            </span>
          </li>
        </ul>
      </ScreenSection>

      <ScreenSection v-if="archived.length" :title="t('ui.documentTemplates.archivedTitle')" flush>
        <ul class="m-0 list-none p-0">
          <li v-for="template in archived" :key="template.id" :class="cn(ROW, 'md:px-4')">
            <Link
              route="document_templates.edit"
              :params="{ id: template.id }"
              :class="cn(LINK, TARGET)"
            >
              {{ template.name }}
            </Link>
          </li>
        </ul>
      </ScreenSection>
    </SettingsScreen>
  </AppLayout>
</template>
