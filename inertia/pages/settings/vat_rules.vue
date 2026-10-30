<script setup lang="ts">
/**
 * Regole IVA, a settings screen on the new UI (docs/ui.md "Settings"): the
 * rules are one form, saved by the header's primary action. Each row is a
 * Customer type, Work Category and kind of Site, with a code per line kind.
 */
import { computed } from 'vue'
import { Form } from '@adonisjs/inertia/vue'
import { CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import { LINE_KINDS, type LineKind } from '@shared/vat'
import type { ScreenAction } from '@shared/screen_actions'
import { t } from '~/i18n'
import { NativeSelect } from '~/components/ui/native-select'
import SettingsScreen from '~/components/screen/settings_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import RowField from '~/components/screen/row_field.vue'
import RowHeads from '~/components/screen/row_heads.vue'

type Rule = {
  id: number
  customerType: string
  workCategory: string
  residential: boolean
  lineKind: LineKind
  vatCodeId: number
}

const props = defineProps<{
  actions: ScreenAction[]
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

/**
 * The first error, above the rules: a rule's code error names its rule,
 * since the field it sits under may be far down.
 */
const firstError = (errors: Record<string, string>) => {
  const [key, message] = Object.entries(errors)[0]
  const index = /^rules\.(\d+)\.vatCodeId$/.exec(key)?.[1]
  const rule = index === undefined ? undefined : props.rules[Number(index)]
  if (!rule) return message
  return t('ui.common.fieldError', {
    field: t('ui.vatRules.rule', {
      kind: t(`ui.vatRules.lineKinds.${rule.lineKind}`),
      ...describe(rule),
    }),
    message,
  })
}

const WHO = 'md:w-56'
const CODE = 'md:min-w-0 md:flex-1'
const ERROR = 'm-0 flex items-start gap-1.5 text-sm text-destructive'
</script>

<template>
  <AppLayout>
    <SettingsScreen route="vat_rules.index" :actions="actions">
      <ScreenSection
        :title="t('ui.vatRules.title')"
        :description="t('ui.vatRules.description')"
        flush
      >
        <Form id="vat-rules" v-slot="{ errors }" route="vat_rules.update">
          <p
            v-if="Object.keys(errors).length"
            :class="[ERROR, 'border-t border-border px-3.5 py-3 md:px-4']"
            role="alert"
          >
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
            {{ firstError(errors) }}
          </p>
          <RowHeads
            :heads="[
              {
                label: `${t('ui.customers.typeLabel')} · ${t('ui.jobs.workCategory')}`,
                class: WHO,
              },
              ...LINE_KINDS.map((kind) => ({
                label: t(`ui.vatRules.lineKinds.${kind}`),
                class: CODE,
              })),
            ]"
          />
          <ul class="m-0 list-none p-0">
            <li
              v-for="row in rows"
              :key="row.key"
              class="flex flex-col gap-2 border-t border-border px-3.5 py-3 md:flex-row md:items-start md:px-4"
            >
              <div :class="['flex shrink-0 flex-col text-sm md:min-h-9 md:justify-center', WHO]">
                <span class="font-semibold">
                  {{ describe(row.label).customerType }} · {{ describe(row.label).workCategory }}
                </span>
                <span class="text-muted-foreground">{{ describe(row.label).residential }}</span>
              </div>
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-3 md:flex md:min-w-0 md:flex-1">
                <template v-for="kind in LINE_KINDS" :key="kind">
                  <RowField
                    v-if="row.cells.has(kind)"
                    :label="t(`ui.vatRules.lineKinds.${kind}`)"
                    :class="CODE"
                  >
                    <input
                      type="hidden"
                      :name="`rules[${row.cells.get(kind)}][id]`"
                      :value="rules[row.cells.get(kind)!].id"
                    />
                    <NativeSelect
                      :name="`rules[${row.cells.get(kind)}][vatCodeId]`"
                      :model-value="String(rules[row.cells.get(kind)!].vatCodeId)"
                      :aria-label="
                        t('ui.vatRules.codeFor', {
                          kind: t(`ui.vatRules.lineKinds.${kind}`),
                          ...describe(row.label),
                        })
                      "
                      :aria-invalid="ruleError(errors, row.cells.get(kind)!) ? 'true' : undefined"
                    >
                      <option
                        v-for="code in optionsFor(rules[row.cells.get(kind)!])"
                        :key="code.id"
                        :value="String(code.id)"
                      >
                        {{ code.name }}{{ code.archived ? ` ${t('ui.vatRules.archived')}` : '' }}
                      </option>
                    </NativeSelect>
                    <p v-if="ruleError(errors, row.cells.get(kind)!)" :class="ERROR">
                      <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
                      {{ ruleError(errors, row.cells.get(kind)!) }}
                    </p>
                  </RowField>
                  <div v-else aria-hidden="true" :class="['hidden md:block', CODE]" />
                </template>
              </div>
            </li>
          </ul>
        </Form>
      </ScreenSection>
    </SettingsScreen>
  </AppLayout>
</template>
