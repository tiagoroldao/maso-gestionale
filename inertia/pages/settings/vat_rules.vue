<script setup lang="ts">
import { computed } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import SettingsLayout from '~/layouts/settings.vue'
import { LINE_KINDS, type LineKind } from '@shared/vat'
import { t } from '~/i18n'

type Rule = {
  id: number
  customerType: string
  workCategory: string
  residential: boolean
  lineKind: LineKind
  vatCodeId: number
}

const props = defineProps<{
  rules: Rule[]
  vatCodes: { id: number; name: string; archived: boolean }[]
}>()

/**
 * One row per Customer type, Work Category and kind of Site, with a code
 * per line kind; each rule keeps its position in the submitted list.
 */
const rows = computed(() => {
  const byKey = new Map<string, { label: Rule; cells: Map<LineKind, number> }>()
  props.rules.forEach((rule, index) => {
    const key = `${rule.customerType}/${rule.workCategory}/${rule.residential}`
    if (!byKey.has(key)) byKey.set(key, { label: rule, cells: new Map() })
    byKey.get(key)!.cells.set(rule.lineKind, index)
  })
  return [...byKey.entries()].map(([key, row]) => ({ key, ...row }))
})

const ruleError = (errors: Record<string, string>, index: number) =>
  errors[`rules.${index}.vatCodeId`]

// An archived code only stays on the rules that already use it
const optionsFor = (rule: Rule) =>
  props.vatCodes.filter((code) => !code.archived || code.id === rule.vatCodeId)

const describe = (rule: Rule) => ({
  customerType: t(`ui.customers.types.${rule.customerType}`),
  workCategory: t(`ui.jobs.workCategories.${rule.workCategory}`),
  residential: rule.residential ? t('ui.vatRules.residential') : t('ui.vatRules.notResidential'),
})
</script>

<template>
  <AppLayout>
    <SettingsLayout>
      <Section :title="t('ui.vatRules.title')" :description="t('ui.vatRules.description')">
        <Form v-slot="{ processing, errors }" route="vat_rules.update">
          <p v-if="Object.keys(errors).length" class="field__error" role="alert">
            {{ Object.values(errors)[0] }}
          </p>
          <table class="table">
            <thead>
              <tr>
                <th>{{ t('ui.customers.typeLabel') }}</th>
                <th>{{ t('ui.jobs.workCategory') }}</th>
                <th />
                <th v-for="kind in LINE_KINDS" :key="kind">
                  {{ t(`ui.vatRules.lineKinds.${kind}`) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.key">
                <td>{{ describe(row.label).customerType }}</td>
                <td>{{ describe(row.label).workCategory }}</td>
                <td>{{ describe(row.label).residential }}</td>
                <td v-for="kind in LINE_KINDS" :key="kind">
                  <template v-if="row.cells.has(kind)">
                    <input
                      type="hidden"
                      :name="`rules[${row.cells.get(kind)}][id]`"
                      :value="rules[row.cells.get(kind)!].id"
                    />
                    <select
                      :name="`rules[${row.cells.get(kind)}][vatCodeId]`"
                      class="field__input"
                      :aria-label="
                        t('ui.vatRules.codeFor', {
                          kind: t(`ui.vatRules.lineKinds.${kind}`),
                          ...describe(row.label),
                        })
                      "
                    >
                      <option
                        v-for="code in optionsFor(rules[row.cells.get(kind)!])"
                        :key="code.id"
                        :value="code.id"
                        :selected="code.id === rules[row.cells.get(kind)!].vatCodeId"
                      >
                        {{ code.name }}{{ code.archived ? ` ${t('ui.vatRules.archived')}` : '' }}
                      </option>
                    </select>
                    <span v-if="ruleError(errors, row.cells.get(kind)!)" class="field__error">
                      {{ ruleError(errors, row.cells.get(kind)!) }}
                    </span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.vatRules.save') }}
          </button>
        </Form>
      </Section>
    </SettingsLayout>
  </AppLayout>
</template>
