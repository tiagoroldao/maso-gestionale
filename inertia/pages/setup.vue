<script setup lang="ts">
import AuthLayout from '~/layouts/auth.vue'
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
  { name: 'superuserEmail', label: 'Email', type: 'email', autocomplete: 'off' },
  { name: 'superuserPassword', label: 'Password', type: 'password', autocomplete: 'new-password' },
  {
    name: 'superuserPasswordConfirmation',
    label: 'Confirm password',
    type: 'password',
    autocomplete: 'new-password',
  },
]

const adminFields: Field[] = [
  { name: 'adminFullName', label: 'Full name', type: 'text', autocomplete: 'off' },
  { name: 'adminEmail', label: 'Email', type: 'email', autocomplete: 'off' },
  { name: 'adminPassword', label: 'Password', type: 'password', autocomplete: 'new-password' },
  {
    name: 'adminPasswordConfirmation',
    label: 'Confirm password',
    type: 'password',
    autocomplete: 'new-password',
  },
]

const sections = [
  {
    title: 'Superuser',
    help: 'Whoever installs and maintains this system. Manages Instance settings only.',
    fields: superuserFields,
  },
  {
    title: 'Admin',
    help: 'The business owner. Manages company settings, users and all business data.',
    fields: adminFields,
  },
]
</script>

<template>
  <AuthLayout>
    <h1 class="auth__title">Set up this Instance</h1>
    <p class="auth__sub">Create the Superuser and the first Admin. This can only be done once.</p>

    <Form v-slot="{ processing, errors }" route="setup.store">
      <div class="auth__form">
        <template v-for="section in sections" :key="section.title">
          <h2 :style="{ fontSize: '15px', margin: '12px 0 0' }">{{ section.title }}</h2>
          <p class="auth__sub" :style="{ margin: 0 }">{{ section.help }}</p>

          <div v-for="field in section.fields" :key="field.name" class="field">
            <label class="field__label" :for="field.name">{{ field.label }}</label>
            <input
              :id="field.name"
              :name="field.name"
              :type="field.type"
              class="field__input"
              :autocomplete="field.autocomplete"
              :aria-invalid="errors[field.name] ? 'true' : 'false'"
            />
            <span v-if="errors[field.name]" class="field__error">{{ errors[field.name] }}</span>
          </div>
        </template>

        <button
          type="submit"
          class="btn btn--primary btn--block"
          :disabled="processing"
          :style="{ marginTop: '4px' }"
        >
          {{ processing ? 'One moment…' : 'Complete setup' }}
        </button>
      </div>
    </Form>
  </AuthLayout>
</template>
