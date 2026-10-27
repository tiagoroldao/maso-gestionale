<script setup lang="ts">
import { usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import { Phone } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { urlFor } from '~/client'
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
}>()

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
          >
            <input type="hidden" name="status" :value="status" />
            <button
              type="submit"
              class="btn btn--sm"
              :class="status === visit.status ? 'btn--primary' : 'btn--secondary'"
              :aria-pressed="status === visit.status"
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
