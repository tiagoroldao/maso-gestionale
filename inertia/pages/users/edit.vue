<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import UserFormFields from '~/components/user_form_fields.vue'

defineProps<{ user: { id: number; fullName: string | null; email: string; role: string } }>()
</script>

<template>
  <AppLayout>
    <Page :title="`Edit ${user.fullName ?? user.email}`">
      <Form v-slot="{ processing, errors }" route="users.update" :params="{ id: user.id }">
        <Section>
          <UserFormFields :errors="errors" :user="user" password-optional />
          <button type="submit" class="btn btn--primary" :disabled="processing">
            Save changes
          </button>
        </Section>
      </Form>
    </Page>
  </AppLayout>
</template>
