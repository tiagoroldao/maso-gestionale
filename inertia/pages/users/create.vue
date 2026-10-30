<script setup lang="ts">
/**
 * A new user, an Entity screen in edit mode (docs/ui.md "Kinds of
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

defineProps<{ actions: ScreenAction[] }>()

const busy = ref(false)
</script>

<template>
  <AppLayout>
    <Form
      v-slot="{ errors }"
      route="users.store"
      class="w-full min-w-0"
      @start="busy = true"
      @finish="busy = false"
    >
      <EntityScreen
        :document-title="t('ui.users.newTitle')"
        :crumbs="[{ label: t('ui.users.title'), href: urlFor('users.index') }]"
        :current="t('ui.users.newTitle')"
        :title="t('ui.users.newTitle')"
        :actions="actions"
        :busy="busy"
      >
        <UserFormFields :errors="errors" />
      </EntityScreen>
    </Form>
  </AppLayout>
</template>
