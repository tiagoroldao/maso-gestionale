<script setup lang="ts">
import { isClosedVisit } from '@shared/visits'
import { ref } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { Phone } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
import ItemPicker, { type PickedItem } from '~/components/item_picker.vue'
import { amountForInput } from '@shared/money'
import { formatDate, t } from '~/i18n'

defineProps<{
  visit: {
    id: number
    startsAt: string
    endsAt: string
    status: string
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
  done: boolean
  servicedIds: number[]
  currentUserId: number
  team: { id: number; name: string }[]
  labourRates: { id: number; name: string }[]
  hours: { id: number; technician: string; labourRate: string; hours: string }[]
  items: {
    id: number
    code: string
    description: string
    unit: string
    quantity: string
    installed: boolean
  }[]
}>()

const picked = ref<PickedItem | null>(null)
const installed = ref(false)
// Installing onto equipment already at the Site, or ('') new equipment
const equipmentId = ref<number | ''>('')
const quantity = (value: string) => amountForInput(value).replace(/,?0+$/, '').replace(/,$/, '')
const confirmDone = (status: string) => () =>
  !isClosedVisit(status) || window.confirm(t('ui.field.completeConfirm'))
const confirmRemove = () => window.confirm(t('ui.field.removeConfirm'))

const statuses = ['planned', 'in_progress', 'done', 'needs_return'] as const
const page = usePage()
</script>

<template>
  <AppLayout>
    <Page
      :title="customer.name"
      :description="`${formatDate(visit.startsAt)} ${visit.startsAt.slice(11, 16)}–${visit.endsAt.slice(11, 16)}`"
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
        <div class="field-status">
          <Form
            v-for="status in statuses"
            :key="status"
            route="my_visits.update_status"
            :params="{ id: visit.id }"
            :on-before="confirmDone(status)"
          >
            <input type="hidden" name="status" :value="status" />
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
            :href="urlFor('item_documents.show', { id: document.id })"
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

      <p v-if="done" class="field__hint">{{ t('ui.field.doneNotice') }}</p>

      <Section :title="t('ui.field.hoursTitle')">
        <div v-for="hour in hours" :key="hour.id" class="field-note">
          <span>
            <strong>{{ quantity(hour.hours) }} h</strong> · {{ hour.technician }} ·
            {{ hour.labourRate }}
          </span>
          <Form
            v-if="!done"
            route="my_visits.remove_hours"
            :params="{ hourId: hour.id }"
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
              name="technicianId"
              class="field__input"
              :value="
                team.some((member) => member.id === currentUserId) ? currentUserId : team[0]?.id
              "
            >
              <option v-for="member in team" :key="member.id" :value="member.id">
                {{ member.name }}
              </option>
            </select>
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
            <span v-if="line.installed" class="tag">{{ t('ui.field.installedTag') }}</span>
          </span>
          <Form
            v-if="!done"
            route="my_visits.remove_item"
            :params="{ itemId: line.id }"
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
            @success="((picked = null), (installed = false), (equipmentId = ''))"
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
                name="quantity"
                inputmode="decimal"
                class="field__input"
                value="1"
              />
              <span v-if="errors.quantity" class="field__error">{{ errors.quantity }}</span>
            </div>
            <label :style="{ display: 'flex', gap: '8px', alignItems: 'center' }">
              <input v-model="installed" type="checkbox" name="installed" value="true" />
              {{ t('ui.field.installed') }}
            </label>
            <div v-if="installed && site?.equipment.length" class="field">
              <label class="field__label" for="item-equipment">{{
                t('ui.field.installedOnto')
              }}</label>
              <select
                id="item-equipment"
                v-model="equipmentId"
                name="equipmentId"
                class="field__input"
              >
                <option value="">{{ t('ui.field.newEquipment') }}</option>
                <option
                  v-for="equipment in site.equipment"
                  :key="equipment.id"
                  :value="equipment.id"
                >
                  {{ equipment.description }}
                </option>
              </select>
            </div>
            <template v-if="installed && equipmentId === ''">
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
            </template>
            <div v-if="installed" class="field">
              <label class="field__label" for="item-serial">{{ t('ui.field.serialNumber') }}</label>
              <input id="item-serial" name="serialNumber" class="field__input" />
              <span v-if="errors.serialNumber" class="field__error">{{ errors.serialNumber }}</span>
            </div>
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
