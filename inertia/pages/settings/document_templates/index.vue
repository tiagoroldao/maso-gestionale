<script setup lang="ts">
import { Link } from '@adonisjs/inertia/vue'
import { Plus } from 'lucide-vue-next'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import { formatDate, t } from '~/i18n'

defineProps<{
  templates: { id: number; name: string; version: number; savedAt: string }[]
}>()
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Section
        :title="t('ui.documentTemplates.title')"
        :description="t('ui.documentTemplates.description')"
      >
        <p>
          <Link route="document_templates.create" class="btn btn--primary btn--sm">
            <Plus :size="15" /> {{ t('ui.documentTemplates.new') }}
          </Link>
        </p>
        <p v-if="templates.length === 0" class="field__hint">
          {{ t('ui.documentTemplates.empty') }}
        </p>
        <table v-else class="table">
          <tbody>
            <tr v-for="template in templates" :key="template.id">
              <td>
                <Link route="document_templates.edit" :params="{ id: template.id }" class="il">
                  {{ template.name }}
                </Link>
              </td>
              <td>{{ t('ui.documentTemplates.version', { version: template.version }) }}</td>
              <td>{{ formatDate(template.savedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </Section>
    </SettingsLayout>
  </AppLayout>
</template>
