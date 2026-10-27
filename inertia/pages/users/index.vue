<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import { UserPlus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import { roleLabels } from '~/components/role_label'

defineProps<{
  users: {
    id: number
    fullName: string | null
    email: string
    role: string
    isActive: boolean
    canEdit: boolean
  }[]
}>()
</script>

<template>
  <AppLayout>
    <Page title="Users" description="Office and Technician accounts.">
      <template #actions>
        <Link route="users.create" class="btn btn--primary btn--sm">
          <UserPlus :size="15" /> New user
        </Link>
      </template>

      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id" :class="{ 'table__row--muted': !user.isActive }">
            <td>{{ user.fullName }}</td>
            <td>{{ user.email }}</td>
            <td>{{ roleLabels[user.role] }}</td>
            <td>{{ user.isActive ? 'Active' : 'Deactivated' }}</td>
            <td class="table__actions">
              <template v-if="user.canEdit">
                <Link route="users.edit" :params="{ id: user.id }" class="btn btn--ghost btn--sm">
                  Edit
                </Link>
                <Form
                  :route="user.isActive ? 'users.deactivate' : 'users.reactivate'"
                  :params="{ id: user.id }"
                >
                  <button type="submit" class="btn btn--secondary btn--sm">
                    {{ user.isActive ? 'Deactivate' : 'Reactivate' }}
                  </button>
                </Form>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </Page>
  </AppLayout>
</template>
