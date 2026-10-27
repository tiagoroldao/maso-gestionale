<script setup lang="ts">
import { Form, Link } from '@adonisjs/inertia/vue'
import { UserPlus } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import { roleLabel } from '~/components/role_label'
import { t } from '~/i18n'

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
    <Page :title="t('ui.users.title')" :description="t('ui.users.description')">
      <template #actions>
        <Link route="users.create" class="btn btn--primary btn--sm">
          <UserPlus :size="15" /> {{ t('ui.users.new') }}
        </Link>
      </template>

      <table class="table">
        <thead>
          <tr>
            <th>{{ t('ui.users.name') }}</th>
            <th>{{ t('ui.users.email') }}</th>
            <th>{{ t('ui.users.role') }}</th>
            <th>{{ t('ui.users.status') }}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in users" :key="user.id" :class="{ 'table__row--muted': !user.isActive }">
            <td>{{ user.fullName }}</td>
            <td>{{ user.email }}</td>
            <td>{{ roleLabel(user.role) }}</td>
            <td>{{ user.isActive ? t('ui.users.active') : t('ui.users.deactivated') }}</td>
            <td class="table__actions">
              <template v-if="user.canEdit">
                <Link route="users.edit" :params="{ id: user.id }" class="btn btn--ghost btn--sm">
                  {{ t('ui.common.edit') }}
                </Link>
                <Form
                  :route="user.isActive ? 'users.deactivate' : 'users.reactivate'"
                  :params="{ id: user.id }"
                >
                  <button type="submit" class="btn btn--secondary btn--sm">
                    {{ user.isActive ? t('ui.users.deactivate') : t('ui.users.reactivate') }}
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
