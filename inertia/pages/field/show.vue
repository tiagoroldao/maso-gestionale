<script setup lang="ts">
import { isClosedVisit } from '@shared/visits'
import { computed, ref } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { Phone } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import { amountForInput, parseAmount } from '@shared/money'
import { takesSerialNumber } from '@shared/items'
import { formatDate, t } from '~/i18n'

const props = defineProps<{
  visit: {
    id: number
    startsAt: string
    endsAt: string
    status: string
    survey: boolean
    officeNotes: string | null
    technicians: string[]
  }
  job: { number: string; title: string; description: string | null }
  customer: { name: string; phone: string | null }
  site: {
    summary: string
    accessNotes: string | null
    equipment: {
      id: number
      description: string
      serialNumber: string | null
      nextDueOn: string | null
      documents: { id: number; title: string }[]
    }[]
  } | null
  notes: { id: number; body: string; author: string | null; createdAt: string }[]
  photos: { id: number }[]
  issuedDocuments: { id: number; title: string; number: string; issuedOn: string }[]
  done: boolean
  servicedIds: number[]
  currentUserId: number
  team: { id: number; name: string }[]
  labourRates: { id: number; name: string }[]
  hours: {
    id: number
    technician: string
    labourRate: string
    hours: string
    notDone: boolean
  }[]
  items: {
    id: number
    code: string
    description: string
    unit: string
    quantity: string
    equipment: boolean
    notDone: boolean
  }[]
}>()

const picked = ref<PickedItem | null>(null)
// Hours by someone outside the app, named instead of picked
const someoneElse = ref(false)
// The picked Item's quantity: an Equipment Item takes a serial number
// for a single piece only (#176)
const itemQuantity = ref('1')
const singlePiece = computed(() => {
  const parsed = parseAmount(itemQuantity.value)
  return parsed !== null && takesSerialNumber(parsed.toFixed())
})
const quantity = (value: string) => amountForInput(value).replace(/,?0+$/, '').replace(/,$/, '')
const confirmDone = (status: string) => () =>
  !isClosedVisit(status) || window.confirm(t('ui.field.completeConfirm'))
const confirmRemove = () => window.confirm(t('ui.field.removeConfirm'))

const statuses = ['planned', 'in_progress', 'done', 'needs_return'] as const
const page = usePage()

// Closing reviews every hour and Item recorded, all ticked: unticked ones
// become not done (ADR 0016)
const reviewed = computed(() => [
  ...props.hours.map((hour) => ({
    id: hour.id,
    label: `${quantity(hour.hours)} h · ${hour.technician} · ${hour.labourRate}`,
  })),
  ...props.items.map((line) => ({
    id: line.id,
    label: `${quantity(line.quantity)} ${line.unit} · ${line.code} ${line.description}`,
  })),
])
const unticked = ref<number[]>([])
function toggle(id: number, ticked: boolean) {
  unticked.value = ticked ? unticked.value.filter((other) => other !== id) : [...unticked.value, id]
}
</script>

<template>
  <AppLayout>
    <Page
      :title="customer.name"
      :description="`${visit.survey ? `${t('ui.visits.survey')} · ` : ''}${formatDate(visit.startsAt)} ${visit.startsAt.slice(11, 16)}–${visit.endsAt.slice(11, 16)}`"
    >
      <template #actions>
        <Link
          v-if="page.props.user?.role === 'technician'"
          route="my_visits.index"
          class="btn btn--ghost btn--sm"
        >
          {{ t('ui.field.back') }}
        </Link>
        <Link v-else route="visits.schedule" class="btn btn--ghost btn--sm">
          {{ t('ui.nav.schedule') }}
        </Link>
      </template>

      <Section :title="t('ui.field.status')">
        <div v-if="!done" data-testid="close-review">
          <p class="field__hint" :style="{ margin: 0 }">
            <strong>{{ t('ui.field.closeTitle') }}</strong> · {{ t('ui.field.closeHint') }}
          </p>
          <label
            v-for="line in reviewed"
            :key="line.id"
            :style="{ display: 'flex', gap: '8px', alignItems: 'center' }"
          >
            <input
              type="checkbox"
              :checked="!unticked.includes(line.id)"
              @change="toggle(line.id, ($event.target as HTMLInputElement).checked)"
            />
            {{ line.label }}
          </label>
          <p v-if="reviewed.length === 0" class="field__hint">
            {{ t('ui.field.nothingToReview') }}
          </p>
        </div>
        <div class="field-status">
          <Form
            v-for="status in statuses"
            :key="status"
            route="my_visits.update_status"
            :params="{ id: visit.id }"
            :on-before="confirmDone(status)"
          >
            <input type="hidden" name="status" :value="status" />
            <template v-if="isClosedVisit(status)">
              <input
                v-for="line in reviewed"
                :key="line.id"
                type="hidden"
                name="reviewed[]"
                :value="line.id"
              />
              <template v-for="line in reviewed" :key="line.id">
                <input
                  v-if="!unticked.includes(line.id)"
                  type="hidden"
                  name="done[]"
                  :value="line.id"
                />
              </template>
            </template>
            <button
              type="submit"
              class="btn btn--sm"
              :class="status === visit.status ? 'btn--primary' : 'btn--secondary'"
              :aria-pressed="status === visit.status"
              :disabled="done"
            >
              {{ t(`ui.visits.statuses.${status}`) }}
            </button>
          </Form>
        </div>
      </Section>

      <Section :title="t('ui.field.where')">
        <p v-if="site" :style="{ margin: 0 }">
          <strong>{{ site.summary }}</strong>
        </p>
        <p v-if="site?.accessNotes" :style="{ whiteSpace: 'pre-line' }">{{ site.accessNotes }}</p>
        <a v-if="customer.phone" :href="`tel:${customer.phone}`" class="btn btn--secondary btn--sm">
          <Phone :size="15" /> {{ customer.phone }}
        </a>
      </Section>

      <Section :title="t('ui.field.job', { number: job.number })">
        <p :style="{ margin: 0 }">
          <strong>{{ job.title }}</strong>
        </p>
        <p v-if="job.description" :style="{ whiteSpace: 'pre-line' }">{{ job.description }}</p>
        <template v-if="visit.officeNotes">
          <h3 class="field-subtitle">{{ t('ui.field.officeNotes') }}</h3>
          <p :style="{ whiteSpace: 'pre-line' }">{{ visit.officeNotes }}</p>
        </template>
        <p class="field__hint">{{ t('ui.field.team', { names: visit.technicians.join(', ') }) }}</p>
      </Section>

      <Section v-if="site?.equipment.length" :title="t('ui.equipment.sectionTitle')">
        <div v-for="equipment in site.equipment" :key="equipment.id" class="field-equipment">
          <strong>{{ equipment.description }}</strong>
          <span v-if="equipment.serialNumber" class="mono">{{ equipment.serialNumber }}</span>
          <span v-if="equipment.nextDueOn" class="field__hint">
            {{ t('ui.equipment.nextDue') }}: {{ formatDate(equipment.nextDueOn) }}
          </span>
          <a
            v-for="document in equipment.documents"
            :key="document.id"
            :href="
              urlFor('item_documents.show_from_visit', { id: visit.id, documentId: document.id })
            "
            target="_blank"
            rel="noopener"
            class="il"
          >
            {{ document.title }}
          </a>
        </div>
        <Form
          v-if="!done"
          route="my_visits.set_serviced"
          :params="{ id: visit.id }"
          :style="{ marginTop: '12px' }"
        >
          <p class="field__hint">{{ t('ui.field.servicedHint') }}</p>
          <label
            v-for="equipment in site.equipment"
            :key="equipment.id"
            :style="{ display: 'flex', gap: '8px', alignItems: 'center' }"
          >
            <input
              type="checkbox"
              name="equipmentIds[]"
              :value="equipment.id"
              :checked="servicedIds.includes(equipment.id)"
            />
            {{ equipment.description }}
          </label>
          <button type="submit" class="btn btn--secondary btn--sm">
            {{ t('ui.field.saveServiced') }}
          </button>
        </Form>
      </Section>

      <Section v-if="issuedDocuments.length" :title="t('ui.issuedDocuments.title')">
        <ul>
          <li v-for="document in issuedDocuments" :key="document.id">
            <a
              :href="
                urlFor('issued_documents.pdf_from_visit', {
                  id: visit.id,
                  documentId: document.id,
                })
              "
              target="_blank"
              rel="noopener"
              class="il"
            >
              {{ document.title }} {{ document.number }}
            </a>
            <span class="field__hint">{{ formatDate(document.issuedOn) }}</span>
          </li>
        </ul>
      </Section>

      <p v-if="visit.status === 'cancelled'" class="field__hint">
        {{ t('ui.visits.cancelledHint') }}
      </p>
      <p v-else-if="done" class="field__hint">{{ t('ui.field.doneNotice') }}</p>

      <Section :title="t('ui.field.hoursTitle')">
        <div v-for="hour in hours" :key="hour.id" class="field-note">
          <span>
            <strong>{{ quantity(hour.hours) }} h</strong> · {{ hour.technician }} ·
            {{ hour.labourRate }}
            <span v-if="hour.notDone" class="tag">{{ t('ui.charges.workStates.not_done') }}</span>
          </span>
          <Form
            v-if="!done"
            route="my_visits.remove_charge"
            :params="{ id: hour.id }"
            :on-before="confirmRemove"
          >
            <button type="submit" class="btn btn--ghost btn--sm">{{ t('ui.field.remove') }}</button>
          </Form>
        </div>
        <p v-if="hours.length === 0" class="field__hint">{{ t('ui.field.noHours') }}</p>
        <Form
          v-if="!done"
          v-slot="{ processing, errors }"
          route="my_visits.add_hours"
          :params="{ id: visit.id }"
          reset-on-success
          class="field-form"
        >
          <div class="field">
            <label class="field__label" for="hours-technician">{{
              t('ui.field.technician')
            }}</label>
            <select
              id="hours-technician"
              :name="someoneElse ? undefined : 'technicianId'"
              class="field__input"
              :value="
                team.some((member) => member.id === currentUserId) ? currentUserId : team[0]?.id
              "
              @change="someoneElse = ($event.target as HTMLSelectElement).value === ''"
            >
              <option v-for="member in team" :key="member.id" :value="member.id">
                {{ member.name }}
              </option>
              <option value="">{{ t('ui.field.someoneElse') }}</option>
            </select>
          </div>
          <div v-if="someoneElse" class="field">
            <label class="field__label" for="hours-worker">{{ t('ui.field.workerName') }}</label>
            <input id="hours-worker" name="workerName" class="field__input" />
            <span v-if="errors.workerName" class="field__error">{{ errors.workerName }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="hours-rate">{{ t('ui.field.labourRate') }}</label>
            <select id="hours-rate" name="labourRateId" class="field__input">
              <option v-for="rate in labourRates" :key="rate.id" :value="rate.id">
                {{ rate.name }}
              </option>
            </select>
            <span v-if="errors.labourRateId" class="field__error">{{ errors.labourRateId }}</span>
            <span v-if="errors.technicianId" class="field__error">{{ errors.technicianId }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="hours-amount">{{ t('ui.field.hours') }}</label>
            <input id="hours-amount" name="hours" inputmode="decimal" class="field__input" />
            <span v-if="errors.hours" class="field__error">{{ errors.hours }}</span>
          </div>
          <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
            {{ t('ui.field.addHours') }}
          </button>
        </Form>
      </Section>

      <Section :title="t('ui.field.itemsTitle')">
        <div v-for="line in items" :key="line.id" class="field-note">
          <span>
            <strong>{{ quantity(line.quantity) }} {{ line.unit }}</strong> ·
            <span class="mono">{{ line.code }}</span> {{ line.description }}
            <span v-if="line.equipment" class="tag">{{ t('ui.field.equipmentTag') }}</span>
            <span v-if="line.notDone" class="tag">{{ t('ui.charges.workStates.not_done') }}</span>
          </span>
          <Form
            v-if="!done"
            route="my_visits.remove_charge"
            :params="{ id: line.id }"
            :on-before="confirmRemove"
          >
            <button type="submit" class="btn btn--ghost btn--sm">{{ t('ui.field.remove') }}</button>
          </Form>
        </div>
        <p v-if="items.length === 0" class="field__hint">{{ t('ui.field.noItems') }}</p>
        <template v-if="!done">
          <ItemPicker v-if="!picked" :label="t('ui.field.addItem')" @select="picked = $event" />
          <Form
            v-else
            v-slot="{ processing, errors }"
            route="my_visits.add_item"
            :params="{ id: visit.id }"
            class="field-form"
            @success="((picked = null), (itemQuantity = '1'))"
          >
            <input type="hidden" name="itemId" :value="picked.id" />
            <p :style="{ margin: 0 }">
              <span class="mono">{{ picked.code }}</span> · {{ picked.description }}
            </p>
            <div class="field">
              <label class="field__label" for="item-quantity">
                {{ t('ui.field.quantity') }} ({{ picked.unit }})
              </label>
              <input
                id="item-quantity"
                v-model="itemQuantity"
                name="quantity"
                inputmode="decimal"
                class="field__input"
              />
              <span v-if="errors.quantity" class="field__error">{{ errors.quantity }}</span>
            </div>
            <template v-if="picked.equipment">
              <p class="field__hint" :style="{ margin: 0 }">{{ t('ui.field.equipmentDetails') }}</p>
              <div class="field">
                <label class="field__label" for="item-type">{{
                  t('ui.field.equipmentType')
                }}</label>
                <input id="item-type" name="equipmentType" class="field__input" />
                <span class="field__hint">{{ t('ui.field.equipmentTypeHint') }}</span>
              </div>
              <div class="field">
                <label class="field__label" for="item-make">{{ t('ui.field.make') }}</label>
                <input id="item-make" name="make" class="field__input" />
              </div>
              <div class="field">
                <label class="field__label" for="item-model">{{ t('ui.field.model') }}</label>
                <input id="item-model" name="model" class="field__input" />
              </div>
              <div v-if="singlePiece" class="field">
                <label class="field__label" for="item-serial">{{
                  t('ui.field.serialNumber')
                }}</label>
                <input id="item-serial" name="serialNumber" class="field__input" />
                <span v-if="errors.serialNumber" class="field__error">{{
                  errors.serialNumber
                }}</span>
              </div>
              <span v-else class="field__hint">{{ t('ui.field.serialNumberHint') }}</span>
            </template>
            <span v-if="errors.itemId" class="field__error">{{ errors.itemId }}</span>
            <div :style="{ display: 'flex', gap: '8px' }">
              <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
                {{ t('ui.field.addItem') }}
              </button>
              <button type="button" class="btn btn--ghost btn--sm" @click="picked = null">
                {{ t('ui.field.remove') }}
              </button>
            </div>
          </Form>
        </template>
      </Section>

      <Section :title="t('ui.field.notes')">
        <div v-for="note in notes" :key="note.id" class="field-note">
          <p :style="{ whiteSpace: 'pre-line', margin: 0 }">{{ note.body }}</p>
          <span class="field__hint">
            {{ note.author }} · {{ formatDate(note.createdAt) }} {{ note.createdAt.slice(11, 16) }}
          </span>
        </div>
        <Form
          v-slot="{ processing, errors }"
          route="my_visits.add_note"
          :params="{ id: visit.id }"
          reset-on-success
        >
          <div class="field">
            <label class="field__label" for="note-body">{{ t('ui.field.addNote') }}</label>
            <textarea id="note-body" name="body" class="field__input" rows="3" />
            <span v-if="errors.body" class="field__error">{{ errors.body }}</span>
          </div>
          <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
            {{ t('ui.field.saveNote') }}
          </button>
        </Form>
      </Section>

      <Section :title="t('ui.field.photos')">
        <div class="field-photos">
          <a
            v-for="photo in photos"
            :key="photo.id"
            :href="urlFor('visit_photos.show', { id: photo.id })"
            target="_blank"
            rel="noopener"
          >
            <img
              :src="urlFor('visit_photos.show', { id: photo.id })"
              :alt="t('ui.field.photo')"
              loading="lazy"
            />
          </a>
        </div>
        <Form
          v-slot="{ processing, errors }"
          route="my_visits.add_photo"
          :params="{ id: visit.id }"
          reset-on-success
        >
          <div class="field">
            <label class="field__label" for="photo">{{ t('ui.field.addPhoto') }}</label>
            <input
              id="photo"
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
            />
            <span v-if="errors.photo" class="field__error">{{ errors.photo }}</span>
          </div>
          <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
            {{ t('ui.field.upload') }}
          </button>
        </Form>
      </Section>
    </Page>
  </AppLayout>
</template>
