<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import { amountForInput } from '@shared/money'
import { t } from '~/i18n'

defineProps<{
  categories: { id: number; name: string; markupPercent: string; itemCount: number }[]
}>()

const percent = (value: string) => amountForInput(value).replace(/,00$/, '')
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Section :title="t('ui.categories.title')" :description="t('ui.categories.description')">
        <table v-if="categories.length" class="table">
          <thead>
            <tr>
              <th colspan="2">
                {{ t('ui.categories.name') }} · {{ t('ui.categories.markup') }} ·
                {{ t('ui.categories.items') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="category in categories" :key="category.id">
              <td>
                <Form
                  v-slot="{ processing, errors }"
                  route="categories.update"
                  :params="{ id: category.id }"
                  :style="{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }"
                >
                  <input
                    name="name"
                    class="field__input"
                    :value="category.name"
                    :aria-label="t('ui.categories.nameOf', { name: category.name })"
                    :style="{ maxWidth: '220px' }"
                  />
                  <input
                    name="markupPercent"
                    inputmode="decimal"
                    class="field__input"
                    :value="percent(category.markupPercent)"
                    :aria-label="t('ui.categories.markupFor', { name: category.name })"
                    :style="{ maxWidth: '90px' }"
                  />
                  <span :style="{ color: 'var(--subtle)' }">
                    {{ t('ui.categories.itemCount', { count: category.itemCount }) }}
                  </span>
                  <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
                    {{ t('ui.common.save') }}
                  </button>
                  <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
                  <span v-if="errors.markupPercent" class="field__error">
                    {{ errors.markupPercent }}
                  </span>
                </Form>
              </td>
              <td class="table__actions">
                <Form
                  v-if="category.itemCount === 0"
                  route="categories.destroy"
                  :params="{ id: category.id }"
                >
                  <button type="submit" class="btn btn--ghost btn--sm">
                    {{ t('ui.common.delete') }}
                  </button>
                </Form>
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section :title="t('ui.categories.addTitle')">
        <Form
          v-slot="{ processing, errors }"
          route="categories.store"
          reset-on-success
          :style="{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }"
        >
          <div class="field">
            <label class="field__label" for="new-category-name">
              {{ t('ui.categories.name') }}
            </label>
            <input id="new-category-name" name="name" class="field__input" />
            <span v-if="errors.name" class="field__error">{{ errors.name }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="new-category-markup">
              {{ t('ui.categories.markup') }}
            </label>
            <input
              id="new-category-markup"
              name="markupPercent"
              inputmode="decimal"
              class="field__input"
              value="30"
            />
            <span v-if="errors.markupPercent" class="field__error">{{ errors.markupPercent }}</span>
          </div>
          <button
            type="submit"
            class="btn btn--primary"
            :disabled="processing"
            :style="{ marginTop: '22px' }"
          >
            {{ t('ui.categories.add') }}
          </button>
        </Form>
      </Section>
    </SettingsLayout>
  </AppLayout>
</template>
