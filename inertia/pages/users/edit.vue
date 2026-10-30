<script setup lang="ts">
/**
 * A user's account, an Entity screen in edit mode (docs/ui.md "Kinds of
 * screen") under Utenti: the screen sits in its form, which the header's
 * Save submits.
 */
import { ref } from 'vue'
import { t } from '~/i18n'
import { Form } from '@adonisjs/inertia/vue'
import { urlFor } from '~/client'
import AppLayout from '~/layouts/app.vue'
import type { ScreenAction } from '@shared/screen_actions'
import EntityScreen from '~/components/screen/entity_screen.vue'
import UserFormFields from '~/components/user_form_fields.vue'
import { roleLabel } from '~/components/role_label'

const props = defineProps<{
  actions: ScreenAction[]
  // Not `user`: the signed-in user is the shared prop of that name
  account: { id: number; fullName: string | null; email: string; role: string }
}>()

const name = props.account.fullName ?? props.account.email
const busy = ref(false)
</script>

<template>
  <AppLayout>
    <Form
      v-slot="{ errors }"
      route="users.update"
      :params="{ id: account.id }"
      class="w-full min-w-0"
      @start="busy = true"
      @finish="busy = false"
    >
      <EntityScreen
        :document-title="t('ui.users.editTitle', { name })"
        :crumbs="[{ label: t('ui.users.title'), href: urlFor('users.index') }]"
        :current="name"
        :title="name"
        :facts="`${roleLabel(account.role)} · ${account.email}`"
        :actions="actions"
        :busy="busy"
      >
        <UserFormFields :errors="errors" :user="account" password-optional />
      </EntityScreen>
    </Form>
  </AppLayout>
</template>
