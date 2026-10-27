<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { router, usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { ArrowDown, ArrowUp, FileText, Trash2 } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import { urlFor } from '~/client'
import { formatMoney, formatUnitPrice, t } from '~/i18n'
import { amountForInput, lineTotal, parseAmount, parseQuantity, sumAmounts } from '@shared/money'

type Kind = 'item' | 'labour' | 'call_out' | 'text'

type Line = {
  key: number
  kind: Kind
  itemId: number | null
  labourRateId: number | null
  description: string
  quantity: string
  unit: string | null
  unitPrice: string
}

const props = defineProps<{
  job: { id: number; number: string; title: string; kind: string; status: string; customer: string }
  quote: {
    status: string
    notes: string | null
    total: string
    lines: {
      kind: Kind
      itemId: number | null
      labourRateId: number | null
      description: string
      quantity: string | null
      unit: string | null
      unitPrice: string | null
      lineTotal: string | null
    }[]
  } | null
  editable: boolean
  labourRates: { id: number; name: string; hourlyPrice: string }[]
  callOutFee: string | null
}>()

const page = usePage()
const errors = computed(() => (page.props.errors ?? {}) as Record<string, string>)

let nextKey = 0
const trim = (value: string) => amountForInput(value).replace(/,?0+$/, '').replace(/,$/, '')

function linesFromProps() {
  return (props.quote?.lines ?? []).map((line) => ({
    key: nextKey++,
    kind: line.kind,
    itemId: line.itemId,
    labourRateId: line.labourRateId,
    description: line.description,
    quantity: line.quantity ? trim(line.quantity) : '',
    unit: line.unit,
    unitPrice: line.unitPrice ? amountForInput(line.unitPrice) : '',
  }))
}

const lines = reactive<Line[]>(linesFromProps())
const notes = ref(props.quote?.notes ?? '')

/**
 * What the server has, in the same shape as the editor's state, so unsaved
 * changes can be detected.
 */
const snapshot = () =>
  JSON.stringify({
    notes: notes.value,
    lines: lines.map(({ key: _key, ...line }) => line),
  })
const saved = ref(snapshot())
const dirty = computed(() => snapshot() !== saved.value)

/**
 * After a save, or when someone else decided the Quote, show what the
 * server has rather than stale local edits.
 */
watch(
  () => props.quote,
  () => {
    if (Object.keys(errors.value).length) return
    lines.splice(0, lines.length, ...linesFromProps())
    notes.value = props.quote?.notes ?? ''
    saved.value = snapshot()
  }
)
const processing = ref(false)
const labourRateId = ref<number | ''>('')

function totalOf(line: Line) {
  const quantity = parseQuantity(line.quantity)
  const price = parseAmount(line.unitPrice)
  if (line.kind === 'text' || !quantity || !price) return null
  return lineTotal(quantity.toFixed(), price.toFixed())
}

const total = computed(() =>
  sumAmounts(
    lines.flatMap((line) => {
      const amount = totalOf(line)
      return amount ? [amount] : []
    })
  )
)

function addItem(item: PickedItem & { resalePrice?: string }) {
  lines.push({
    key: nextKey++,
    kind: 'item',
    itemId: item.id,
    labourRateId: null,
    description: item.description,
    quantity: '1',
    unit: item.unit,
    unitPrice: item.resalePrice ? amountForInput(item.resalePrice) : '',
  })
}

function addLabour() {
  const rate = props.labourRates.find((r) => r.id === labourRateId.value)
  if (!rate) return
  lines.push({
    key: nextKey++,
    kind: 'labour',
    itemId: null,
    labourRateId: rate.id,
    description: rate.name,
    quantity: '1',
    unit: 'h',
    unitPrice: amountForInput(rate.hourlyPrice),
  })
  labourRateId.value = ''
}

function addCallOut() {
  lines.push({
    key: nextKey++,
    kind: 'call_out',
    itemId: null,
    labourRateId: null,
    description: t('ui.quotes.callOutDescription'),
    quantity: '1',
    unit: null,
    unitPrice: props.callOutFee ? amountForInput(props.callOutFee) : '',
  })
}

function addText() {
  lines.push({
    key: nextKey++,
    kind: 'text',
    itemId: null,
    labourRateId: null,
    description: '',
    quantity: '',
    unit: null,
    unitPrice: '',
  })
}

function move(index: number, offset: number) {
  const [line] = lines.splice(index, 1)
  lines.splice(index + offset, 0, line)
}

function save() {
  router.put(
    urlFor('quotes.update', { id: props.job.id }),
    {
      notes: notes.value,
      lines: lines.map((line) => ({
        kind: line.kind,
        ...(line.itemId && { itemId: line.itemId }),
        ...(line.labourRateId && { labourRateId: line.labourRateId }),
        description: line.description,
        ...(line.kind !== 'text' && { quantity: line.quantity, unitPrice: line.unitPrice }),
      })),
    },
    {
      preserveScroll: true,
      onStart: () => (processing.value = true),
      onFinish: () => (processing.value = false),
    }
  )
}

const lineError = (index: number, field: string) => errors.value[`lines.${index}.${field}`]

const confirmDecision = (message: string) => () => window.confirm(message)
</script>

<template>
  <AppLayout>
    <Page
      :title="t('ui.quotes.title', { number: job.number })"
      :description="`${job.title} · ${job.customer}`"
    >
      <template #actions>
        <Link route="jobs.show" :params="{ id: job.id }" class="btn btn--ghost btn--sm">
          {{ t('ui.quotes.backToJob') }}
        </Link>
        <a
          v-if="quote"
          :href="urlFor('quotes.pdf', { id: job.id })"
          target="_blank"
          rel="noopener"
          class="btn btn--secondary btn--sm"
        >
          <FileText :size="15" /> {{ t('ui.quotes.pdf') }}
        </a>
      </template>

      <Section>
        <p v-if="quote && quote.status !== 'draft'" class="tag">
          {{ t(`ui.quotes.statuses.${quote.status}`) }}
        </p>
        <p v-else-if="!editable" class="field__hint">{{ t('ui.quotes.notEditable') }}</p>

        <table class="table">
          <thead>
            <tr>
              <th>{{ t('ui.quotes.description') }}</th>
              <th :style="{ width: '110px' }">{{ t('ui.quotes.quantity') }}</th>
              <th :style="{ width: '140px' }">{{ t('ui.quotes.unitPrice') }}</th>
              <th :style="{ textAlign: 'right', width: '120px' }">{{ t('ui.quotes.amount') }}</th>
              <th v-if="editable" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, index) in lines" :key="line.key">
              <td>
                <span class="field__hint">{{ t(`ui.quotes.kinds.${line.kind}`) }}</span>
                <input
                  v-model="line.description"
                  class="field__input"
                  :disabled="!editable"
                  :aria-label="t('ui.quotes.descriptionOf', { position: index + 1 })"
                />
                <span v-if="lineError(index, 'description')" class="field__error">
                  {{ lineError(index, 'description') }}
                </span>
                <span
                  v-if="lineError(index, 'itemId') || lineError(index, 'labourRateId')"
                  class="field__error"
                >
                  {{ lineError(index, 'itemId') ?? lineError(index, 'labourRateId') }}
                </span>
              </td>
              <td>
                <template v-if="line.kind !== 'text'">
                  <input
                    v-model="line.quantity"
                    inputmode="decimal"
                    class="field__input"
                    :disabled="!editable"
                    :aria-label="t('ui.quotes.quantityOf', { position: index + 1 })"
                  />
                  <span class="field__hint">{{ line.unit }}</span>
                  <span v-if="lineError(index, 'quantity')" class="field__error">
                    {{ lineError(index, 'quantity') }}
                  </span>
                </template>
              </td>
              <td>
                <template v-if="line.kind !== 'text'">
                  <input
                    v-model="line.unitPrice"
                    inputmode="decimal"
                    class="field__input"
                    :disabled="!editable"
                    :aria-label="t('ui.quotes.unitPriceOf', { position: index + 1 })"
                  />
                  <span v-if="lineError(index, 'unitPrice')" class="field__error">
                    {{ lineError(index, 'unitPrice') }}
                  </span>
                </template>
              </td>
              <td :style="{ textAlign: 'right' }">
                {{ totalOf(line) ? formatMoney(totalOf(line)!) : '' }}
              </td>
              <td v-if="editable" class="table__actions">
                <button
                  type="button"
                  class="iconbtn"
                  :disabled="index === 0"
                  :aria-label="t('ui.quotes.moveUp')"
                  @click="move(index, -1)"
                >
                  <ArrowUp :size="14" />
                </button>
                <button
                  type="button"
                  class="iconbtn"
                  :disabled="index === lines.length - 1"
                  :aria-label="t('ui.quotes.moveDown')"
                  @click="move(index, 1)"
                >
                  <ArrowDown :size="14" />
                </button>
                <button
                  type="button"
                  class="iconbtn"
                  :aria-label="t('ui.quotes.removeLine')"
                  @click="lines.splice(index, 1)"
                >
                  <Trash2 :size="14" />
                </button>
              </td>
            </tr>
            <tr v-if="lines.length === 0">
              <td colspan="5" :style="{ color: 'var(--subtle)' }">{{ t('ui.quotes.noLines') }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" :style="{ textAlign: 'right' }">
                <strong>{{ t('ui.quotes.total') }}</strong>
                <span class="field__hint"> ({{ t('ui.quotes.vatExcluded') }})</span>
              </td>
              <td :style="{ textAlign: 'right' }">
                <strong>{{ formatMoney(total) }}</strong>
              </td>
              <td v-if="editable" />
            </tr>
          </tfoot>
        </table>
      </Section>

      <Section v-if="editable" :title="t('ui.quotes.addTitle')">
        <ItemPicker :label="t('ui.quotes.addItem')" @select="addItem" />
        <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }">
          <div class="field">
            <label class="field__label" for="labour-rate">{{ t('ui.quotes.addLabour') }}</label>
            <select id="labour-rate" v-model="labourRateId" class="field__input">
              <option value="" disabled>{{ t('ui.quotes.chooseRate') }}</option>
              <option v-for="rate in labourRates" :key="rate.id" :value="rate.id">
                {{ rate.name }} · {{ formatUnitPrice(rate.hourlyPrice) }}/h
              </option>
            </select>
          </div>
          <button
            type="button"
            class="btn btn--secondary btn--sm"
            :disabled="!labourRateId"
            @click="addLabour"
          >
            {{ t('ui.quotes.addLabourButton') }}
          </button>
          <button type="button" class="btn btn--secondary btn--sm" @click="addCallOut">
            {{ t('ui.quotes.addCallOut') }}
          </button>
          <button type="button" class="btn btn--secondary btn--sm" @click="addText">
            {{ t('ui.quotes.addText') }}
          </button>
        </div>
      </Section>

      <Section :title="t('ui.quotes.notes')">
        <textarea
          v-model="notes"
          class="field__input"
          rows="3"
          :disabled="!editable"
          :aria-label="t('ui.quotes.notes')"
        />
        <span v-if="errors.notes" class="field__error">{{ errors.notes }}</span>
      </Section>

      <Section v-if="editable">
        <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
          <button type="button" class="btn btn--primary" :disabled="processing" @click="save">
            {{ t('ui.quotes.save') }}
          </button>
          <span v-if="dirty" class="field__hint">{{ t('ui.quotes.unsaved') }}</span>
        </div>
        <span v-if="errors.lines" class="field__error">{{ errors.lines }}</span>
      </Section>

      <Section
        v-if="quote && quote.status === 'draft' && job.status === 'quoted'"
        :title="t('ui.quotes.decisionTitle')"
      >
        <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
          <Form
            route="quotes.accept"
            :params="{ id: job.id }"
            :on-before="
              confirmDecision(t('ui.quotes.acceptConfirm', { total: formatMoney(quote.total) }))
            "
          >
            <button type="submit" class="btn btn--primary btn--sm" :disabled="dirty">
              {{ t('ui.quotes.accept') }}
            </button>
          </Form>
          <Form
            route="quotes.decline"
            :params="{ id: job.id }"
            :on-before="confirmDecision(t('ui.quotes.declineConfirm', { number: job.number }))"
          >
            <button type="submit" class="btn btn--ghost btn--sm" :disabled="dirty">
              {{ t('ui.quotes.decline') }}
            </button>
          </Form>
        </div>
        <p v-if="dirty" class="field__hint">{{ t('ui.quotes.saveBeforeDeciding') }}</p>
      </Section>
    </Page>
  </AppLayout>
</template>
