<script setup lang="ts">
import { t } from '~/i18n'
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import UserFormFields from '~/components/user_form_fields.vue'
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.users.newTitle')">
      <Form v-slot="{ processing, errors }" route="users.store">
        <Section>
          <UserFormFields :errors="errors" />
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.users.create') }}
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
