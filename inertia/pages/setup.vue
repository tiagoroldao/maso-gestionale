<script setup lang="ts">
import { t } from '~/i18n'
import AuthLayout from '~/layouts/auth.vue'
import AuthField from '~/components/auth_field.vue'
import { Form } from '@adonisjs/inertia/vue'

type FieldName =
  | 'superuserEmail'
  | 'superuserPassword'
  | 'superuserPasswordConfirmation'
  | 'adminFullName'
  | 'adminEmail'
  | 'adminPassword'
  | 'adminPasswordConfirmation'

type Field = { name: FieldName; label: string; type: string; autocomplete: string }

const superuserFields: Field[] = [
  { name: 'superuserEmail', label: t('ui.setup.email'), type: 'email', autocomplete: 'off' },
  {
    name: 'superuserPassword',
    label: t('ui.setup.password'),
    type: 'password',
    autocomplete: 'new-password',
  },
  {
    name: 'superuserPasswordConfirmation',
    label: t('ui.setup.confirmPassword'),
    type: 'password',
    autocomplete: 'new-password',
  },
]

const adminFields: Field[] = [
  { name: 'adminFullName', label: t('ui.setup.fullName'), type: 'text', autocomplete: 'off' },
  { name: 'adminEmail', label: t('ui.setup.email'), type: 'email', autocomplete: 'off' },
  {
    name: 'adminPassword',
    label: t('ui.setup.password'),
    type: 'password',
    autocomplete: 'new-password',
  },
  {
    name: 'adminPasswordConfirmation',
    label: t('ui.setup.confirmPassword'),
    type: 'password',
    autocomplete: 'new-password',
  },
]

const sections = [
  {
    id: 'superuser-section',
    title: t('ui.setup.superuserTitle'),
    help: t('ui.setup.superuserHelp'),
    fields: superuserFields,
  },
  {
    id: 'admin-section',
    title: t('ui.setup.adminTitle'),
    help: t('ui.setup.adminHelp'),
    fields: adminFields,
  },
]
</script>

<template>
  <AuthLayout>
    <h1 class="font-display text-[26px] font-bold tracking-[0.01em] text-balance">
      {{ t('ui.setup.title') }}
    </h1>
    <p class="mt-1 text-sm text-muted-foreground">{{ t('ui.setup.subtitle') }}</p>

    <Form v-slot="{ processing, errors }" route="setup.store" class="mt-7 flex flex-col gap-6">
      <section
        v-for="section in sections"
        :key="section.id"
        :aria-labelledby="section.id"
        class="flex flex-col gap-4 rounded-sm border border-border bg-card p-4 md:p-5"
      >
        <div>
          <h2
            :id="section.id"
            class="font-display text-[11px] font-semibold tracking-[0.16em] uppercase"
          >
            {{ section.title }}
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">{{ section.help }}</p>
        </div>

        <AuthField
          v-for="field in section.fields"
          :key="field.name"
          :name="field.name"
          :type="field.type"
          :autocomplete="field.autocomplete"
          :label="field.label"
          :error="errors[field.name]"
        />
      </section>

      <button
        type="submit"
        class="h-11 w-full rounded-sm bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default disabled:opacity-60"
        :disabled="processing"
      >
        {{ processing ? t('ui.common.processing') : t('ui.setup.submit') }}
      </button>
    </Form>
  </AuthLayout>
</template>
