<script setup lang="ts">
/**
 * The Item, an Entity screen on the new UI (docs/ui.md): its header
 * actions come from the server; recording a receipt or an adjustment is a
 * dialog. The Stock Movements are the main work, the Item's details and
 * documents beside them.
 */
import { computed, ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Form } from '@adonisjs/inertia/vue'
import { CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import { formatDate, formatUnitPrice, t, todayIso } from '~/i18n'
import { urlFor } from '~/client'
import { cn } from '~/lib/utils'
import { amountForInput } from '@shared/money'
import { formatQuantity as quantity } from '@shared/stock'
import type { ScreenAction } from '@shared/screen_actions'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import ConfirmDialog from '~/components/screen/confirm_dialog.vue'
import FormField from '~/components/screen/form_field.vue'
import type { KeyFact } from '~/components/screen/key_facts.vue'
import { LABEL, LINK, ROW, TD, TH } from '~/components/screen/screen'

const props = defineProps<{
  // The header's actions, for the user's role and the Item's state
  actions: ScreenAction[]
  item: {
    id: number
    code: string
    description: string
    unit: string
    category: string | null
    archived: boolean
    supplierName: string | null
    // Its page, when the user may open it
    supplierId: number | null
    supplierCode: string | null
    purchasePrice: string
    resalePrice: string
    reorderLevel: string | null
    belowMarkup: boolean
    markupPercent: string | null
  }
  stock: { inStock: string; committed: string; available: string }
  reorder: 'negative' | 'low' | null
  documents: { id: number; title: string; originalName: string; sizeBytes: number }[]
  movements: {
    id: number
    kind: string
    quantity: string
    unitCost: string | null
    occurredOn: string
    reference: string | null
    reason: string | null
    author: string | null
  }[]
}>()

const percent = (value: string) => amountForInput(value).replace(/,00$/, '')
const withUnit = (value: string) => `${quantity(value)} ${props.item.unit}`
const signed = (value: string) => `${value.startsWith('-') ? '' : '+'}${quantity(value)}`
const note = (movement: { reference: string | null; reason: string | null }) =>
  [movement.reference, movement.reason].filter(Boolean).join(' · ')

const today = todayIso()
// Recomputed after each recorded movement (the page is reused, not remounted)
const isNegative = computed(() => props.stock.inStock.startsWith('-'))
const isShort = computed(() => props.stock.available.startsWith('-'))

// The header: named as in the Item's preview, then the key facts under it
const facts = computed(() => [props.item.code, props.item.category].filter(Boolean).join(' · '))
const keyFacts = computed<KeyFact[]>(() => [
  {
    label: t('ui.items.stock'),
    value: withUnit(props.stock.inStock),
    amount: true,
    hint: t('ui.items.committedHint', { quantity: withUnit(props.stock.committed) }),
  },
  {
    label: t('ui.items.available'),
    value: withUnit(props.stock.available),
    amount: true,
    hint: props.item.reorderLevel
      ? t('ui.items.reorderLevelHintShort', { quantity: withUnit(props.item.reorderLevel) })
      : undefined,
  },
  {
    label: t('ui.items.resalePrice'),
    value: `${formatUnitPrice(props.item.resalePrice)}/${props.item.unit}`,
    amount: true,
    hint: t('ui.items.purchaseHint', {
      price: `${formatUnitPrice(props.item.purchasePrice)}/${props.item.unit}`,
    }),
  },
  {
    label: t('ui.items.supplierSection'),
    value: props.item.supplierName ?? '—',
    href: props.item.supplierId
      ? urlFor('suppliers.edit', { id: props.item.supplierId })
      : undefined,
    hint: props.item.supplierCode ?? undefined,
  },
])

// The header's dialogs, by action name: a receipt, an adjustment, deleting
const receiptOpen = ref(false)
const adjustmentOpen = ref(false)
const deleteOpen = ref(false)
const deleteQuestion = computed(
  () => props.actions.find((action) => action.name === 'delete')?.confirm ?? ''
)
function openDialog(name: string) {
  if (name === 'receive') receiptOpen.value = true
  if (name === 'adjust') adjustmentOpen.value = true
  if (name === 'delete') deleteOpen.value = true
}
function deleteItem() {
  router.delete(urlFor('items.destroy', { id: props.item.id }))
}

// The documents' section: uploading is a dialog, deleting asks first
const uploadOpen = ref(false)
const deletingDocument = ref<number | null>(null)
const deleteDocumentOpen = ref(false)
function askDeleteDocument(id: number) {
  deletingDocument.value = id
  deleteDocumentOpen.value = true
}
function deleteDocument() {
  if (deletingDocument.value === null) return
  router.delete(urlFor('item_documents.destroy', { id: deletingDocument.value }), {
    preserveScroll: true,
  })
}

const BUTTON = 'h-11 md:h-9'
const DT = cn(LABEL, 'text-[10px]')
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="`${item.code} · ${item.description}`"
      :crumbs="[{ label: t('ui.items.title'), href: urlFor('items.index') }]"
      :current="item.code"
      :title="item.description"
      :facts="facts"
      :actions="actions"
      :key-facts="keyFacts"
      @dialog="openDialog"
    >
      <template #tags>
        <StatusTag v-if="item.archived" tone="grey">{{ t('ui.items.archived') }}</StatusTag>
        <StatusTag v-if="isNegative" tone="orange">{{ t('ui.items.negativeStock') }}</StatusTag>
        <StatusTag v-if="isShort" tone="orange">{{ t('ui.items.negativeAvailable') }}</StatusTag>
        <StatusTag v-else-if="reorder === 'low'" tone="orange">
          {{ t('ui.stock.low') }}
        </StatusTag>
      </template>

      <template #main>
        <ScreenSection :title="t('ui.items.movementsTitle')" flush>
          <template v-if="movements.length">
            <div class="hidden overflow-x-auto md:block">
              <table class="w-full border-collapse" data-testid="movements">
                <thead>
                  <tr>
                    <th :class="TH">{{ t('ui.items.date') }}</th>
                    <th :class="TH">{{ t('ui.items.kind') }}</th>
                    <th :class="cn(TH, 'text-right')">{{ t('ui.items.quantity') }}</th>
                    <th :class="cn(TH, 'text-right')">{{ t('ui.items.unitCost') }}</th>
                    <th :class="TH">{{ t('ui.items.reference') }} / {{ t('ui.items.reason') }}</th>
                    <th :class="TH">{{ t('ui.items.author') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="movement in movements" :key="movement.id">
                    <td :class="cn(TD, 'whitespace-nowrap')">
                      {{ formatDate(movement.occurredOn) }}
                    </td>
                    <td :class="TD">{{ t(`ui.items.kinds.${movement.kind}`) }}</td>
                    <td :class="cn(TD, 'text-right font-semibold whitespace-nowrap')">
                      {{ signed(movement.quantity) }}
                    </td>
                    <td :class="cn(TD, 'text-right whitespace-nowrap')">
                      {{ movement.unitCost ? formatUnitPrice(movement.unitCost) : '' }}
                    </td>
                    <td :class="TD">{{ note(movement) }}</td>
                    <td :class="TD">{{ movement.author }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul class="m-0 list-none p-0 md:hidden">
              <li v-for="movement in movements" :key="movement.id" :class="ROW">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="text-[15px] font-semibold">
                    {{ t(`ui.items.kinds.${movement.kind}`) }}
                  </span>
                  <span class="text-[13px] text-muted-foreground">
                    {{
                      [formatDate(movement.occurredOn), note(movement), movement.author]
                        .filter(Boolean)
                        .join(' · ')
                    }}
                  </span>
                </div>
                <div class="flex shrink-0 flex-col items-end gap-0.5">
                  <span class="text-[15px] font-semibold">{{ signed(movement.quantity) }}</span>
                  <span v-if="movement.unitCost" class="text-[13px] text-muted-foreground">
                    {{ formatUnitPrice(movement.unitCost) }}
                  </span>
                </div>
              </li>
            </ul>
          </template>
          <p
            v-else
            class="m-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4"
          >
            {{ t('ui.items.noMovements') }}
          </p>
        </ScreenSection>
      </template>

      <template #side>
        <ScreenSection :title="t('ui.items.details')">
          <p v-if="item.archived" class="m-0 text-sm text-muted-foreground">
            {{ t('ui.items.archivedNotice') }}
          </p>
          <dl class="m-0 flex flex-col gap-3 text-sm">
            <div v-if="item.category" class="flex flex-col gap-0.5">
              <dt :class="DT">{{ t('ui.items.category') }}</dt>
              <dd class="m-0">{{ item.category }}</dd>
            </div>
            <div class="flex flex-col gap-0.5">
              <dt :class="DT">{{ t('ui.items.unit') }}</dt>
              <dd class="m-0">{{ item.unit }}</dd>
            </div>
            <div v-if="item.reorderLevel" class="flex flex-col gap-0.5">
              <dt :class="DT">{{ t('ui.items.reorderLevel') }}</dt>
              <dd class="m-0">{{ withUnit(item.reorderLevel) }}</dd>
            </div>
            <div class="flex flex-col gap-0.5">
              <dt :class="DT">{{ t('ui.items.purchasePrice') }}</dt>
              <dd class="m-0">{{ formatUnitPrice(item.purchasePrice) }}/{{ item.unit }}</dd>
            </div>
          </dl>
          <p
            v-if="item.belowMarkup && item.markupPercent"
            role="alert"
            class="m-0 flex items-start gap-1.5 text-sm text-destructive"
          >
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
            {{ t('ui.items.belowMarkup', { markup: percent(item.markupPercent) }) }}
          </p>
        </ScreenSection>

        <ScreenSection :title="t('ui.items.documentsTitle')" flush>
          <template #actions>
            <Button variant="outline" :class="BUTTON" @click="uploadOpen = true">
              {{ t('ui.items.upload') }}
            </Button>
          </template>
          <ul v-if="documents.length" class="m-0 list-none p-0" data-testid="item-documents">
            <li v-for="document in documents" :key="document.id" :class="cn(ROW, 'items-center')">
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <a
                  :href="urlFor('item_documents.show', { id: document.id })"
                  target="_blank"
                  rel="noopener"
                  :class="cn(LINK, 'break-words')"
                >
                  {{ document.title }}
                </a>
                <span class="text-[13px] break-all text-muted-foreground">
                  {{ document.originalName }} · {{ Math.ceil(document.sizeBytes / 1024) }} KB
                </span>
              </div>
              <Button
                variant="ghost"
                :class="BUTTON"
                :aria-label="`${t('ui.common.delete')}: ${document.title}`"
                @click="askDeleteDocument(document.id)"
              >
                {{ t('ui.common.delete') }}
              </Button>
            </li>
          </ul>
          <p
            v-else
            class="m-0 border-t border-border px-3.5 py-3 text-sm text-muted-foreground md:px-4"
          >
            {{ t('ui.items.noDocuments') }}
          </p>
        </ScreenSection>
      </template>
    </EntityScreen>

    <!-- Goods received: the unit cost becomes the purchase price -->
    <Dialog v-model:open="receiptOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')">
        <DialogTitle>{{ t('ui.items.receiptTitle') }}</DialogTitle>
        <DialogDescription>{{ t('ui.items.receiptDescription') }}</DialogDescription>
        <Form
          v-slot="{ processing, errors }"
          route="stock_movements.receive"
          :params="{ id: item.id }"
          class="flex flex-col gap-4"
          @success="receiptOpen = false"
        >
          <div class="grid grid-cols-2 gap-3">
            <FormField
              id="receipt-quantity"
              v-slot="field"
              :label="t('ui.items.quantity')"
              :error="errors.quantity"
            >
              <Input
                :id="field.id"
                name="quantity"
                inputmode="decimal"
                :class="BUTTON"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
            <FormField
              id="receipt-unit-cost"
              v-slot="field"
              :label="t('ui.items.unitCost')"
              :error="errors.unitCost"
            >
              <Input
                :id="field.id"
                name="unitCost"
                inputmode="decimal"
                :class="BUTTON"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </div>
          <FormField
            id="receipt-date"
            v-slot="field"
            :label="t('ui.items.date')"
            :error="errors.occurredOn"
          >
            <Input
              :id="field.id"
              name="occurredOn"
              type="date"
              :max="today"
              :default-value="today"
              :class="BUTTON"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <FormField
            id="receipt-reference"
            v-slot="field"
            :label="t('ui.items.receiptReference')"
            :error="errors.reference"
          >
            <Input
              :id="field.id"
              name="reference"
              :class="BUTTON"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" :class="BUTTON" @click="receiptOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="BUTTON" :disabled="processing">
              {{ t('ui.items.receive') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <!-- Stocktaking, breakage or loss: a negative quantity takes goods out -->
    <Dialog v-model:open="adjustmentOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')">
        <DialogTitle>{{ t('ui.items.adjustmentTitle') }}</DialogTitle>
        <DialogDescription>{{ t('ui.items.adjustmentDescription') }}</DialogDescription>
        <Form
          v-slot="{ processing, errors }"
          route="stock_movements.adjust"
          :params="{ id: item.id }"
          class="flex flex-col gap-4"
          @success="adjustmentOpen = false"
        >
          <div class="grid grid-cols-2 gap-3">
            <FormField
              id="adjustment-quantity"
              v-slot="field"
              :label="t('ui.items.quantity')"
              :error="errors.quantity"
            >
              <Input
                :id="field.id"
                name="quantity"
                inputmode="decimal"
                :class="BUTTON"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
            <FormField
              id="adjustment-date"
              v-slot="field"
              :label="t('ui.items.date')"
              :error="errors.occurredOn"
            >
              <Input
                :id="field.id"
                name="occurredOn"
                type="date"
                :max="today"
                :default-value="today"
                :class="BUTTON"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
              />
            </FormField>
          </div>
          <FormField
            id="adjustment-reason"
            v-slot="field"
            :label="t('ui.items.reason')"
            :error="errors.reason"
          >
            <Input
              :id="field.id"
              name="reason"
              :class="BUTTON"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <FormField
            id="adjustment-reference"
            v-slot="field"
            :label="t('ui.items.reference')"
            :error="errors.reference"
          >
            <Input
              :id="field.id"
              name="reference"
              :class="BUTTON"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" :class="BUTTON" @click="adjustmentOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="BUTTON" :disabled="processing">
              {{ t('ui.items.adjust') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <!-- A manual, a datasheet, a certificate -->
    <Dialog v-model:open="uploadOpen">
      <DialogContent :close-label="t('ui.screen.closeDialog')">
        <DialogTitle>{{ t('ui.items.upload') }}</DialogTitle>
        <DialogDescription>{{ t('ui.items.documentsDescription') }}</DialogDescription>
        <Form
          v-slot="{ processing, errors }"
          route="item_documents.store"
          :params="{ id: item.id }"
          class="flex flex-col gap-4"
          @success="uploadOpen = false"
        >
          <FormField
            id="document-title"
            v-slot="field"
            :label="t('ui.items.documentTitle')"
            :error="errors.title"
          >
            <Input
              :id="field.id"
              name="title"
              :class="BUTTON"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <FormField
            id="document-file"
            v-slot="field"
            :label="t('ui.items.documentFile')"
            :error="errors.attachment"
          >
            <Input
              :id="field.id"
              name="attachment"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              :class="cn(BUTTON, 'py-2 md:py-1')"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" :class="BUTTON" @click="uploadOpen = false">
              {{ t('ui.screen.goBack') }}
            </Button>
            <Button type="submit" :class="BUTTON" :disabled="processing">
              {{ t('ui.items.upload') }}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      v-model:open="deleteOpen"
      :title="t('ui.items.delete')"
      :description="deleteQuestion"
      :confirm-label="t('ui.items.delete')"
      @confirm="deleteItem"
    />
    <ConfirmDialog
      v-model:open="deleteDocumentOpen"
      :title="t('ui.items.deleteDocument')"
      :description="t('ui.items.deleteDocumentConfirm')"
      :confirm-label="t('ui.common.delete')"
      @confirm="deleteDocument"
    />
  </AppLayout>
</template>
