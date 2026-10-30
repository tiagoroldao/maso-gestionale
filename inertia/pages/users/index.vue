<script setup lang="ts">
/**
 * Utenti, on the new UI (docs/ui.md): the Office and Technician accounts
 * an Admin manages, and the other Admins for reference. A new user is the
 * header's primary action; editing, deactivating and reactivating are each
 * row's own, shown only for the users the Admin may change. Deactivating
 * and reactivating ask first: one locks the person out, the other lets
 * them back in.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { urlFor } from '~/client'
import AppLayout from '~/layouts/app.vue'
import type { ScreenAction } from '@shared/screen_actions'
import { roleLabel } from '~/components/role_label'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import { Button, buttonVariants } from '~/components/ui/button'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import RowHeads from '~/components/screen/row_heads.vue'
import ConfirmDialog from '~/components/screen/confirm_dialog.vue'
import { EDIT_ROW, TOUCH } from '~/components/screen/screen'

type User = {
  id: number
  fullName: string | null
  email: string
  role: string
  isActive: boolean
  canEdit: boolean
}

defineProps<{
  // New user
  actions: ScreenAction[]
  users: User[]
}>()

const nameOf = (user: User) => user.fullName ?? user.email

// The account asked about, kept while the dialog fades out
const switching = ref<User | null>(null)
const confirmOpen = ref(false)
const sending = ref(false)
function ask(user: User) {
  switching.value = user
  confirmOpen.value = true
}
function confirmed() {
  confirmOpen.value = false
  const user = switching.value
  if (!user || sending.value) return
  router.post(
    urlFor(user.isActive ? 'users.deactivate' : 'users.reactivate', { id: user.id }),
    {},
    { onStart: () => (sending.value = true), onFinish: () => (sending.value = false) }
  )
}

const NAME = 'md:w-72'
const ROLE = 'md:w-32'
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="t('ui.users.title')"
      :crumbs="[]"
      :current="t('ui.users.title')"
      :title="t('ui.users.title')"
      :actions="actions"
    >
      <ScreenSection
        :title="t('ui.users.accountsSection')"
        :description="t('ui.users.description')"
        flush
      >
        <RowHeads
          :heads="[
            { label: t('ui.users.name'), class: NAME },
            { label: t('ui.users.role'), class: ROLE },
            { label: t('ui.users.status'), class: '' },
          ]"
        />
        <ul class="m-0 list-none p-0">
          <li
            v-for="user in users"
            :key="user.id"
            :aria-label="nameOf(user)"
            :class="cn(EDIT_ROW, 'md:items-center')"
          >
            <div :class="cn('flex min-w-0 shrink-0 flex-col', NAME)">
              <span :class="cn('font-medium', !user.isActive && 'text-muted-foreground')">
                {{ user.fullName }}
              </span>
              <span class="truncate text-sm text-muted-foreground">{{ user.email }}</span>
            </div>
            <div class="flex flex-1 flex-wrap items-center gap-2">
              <span :class="cn('shrink-0 text-sm', ROLE)">{{ roleLabel(user.role) }}</span>
              <StatusTag :tone="user.isActive ? 'green' : 'grey'">
                {{ user.isActive ? t('ui.users.active') : t('ui.users.deactivated') }}
              </StatusTag>
            </div>
            <div v-if="user.canEdit" class="flex gap-2">
              <Link
                route="users.edit"
                :params="{ id: user.id }"
                :class="cn(buttonVariants({ variant: 'outline' }), TOUCH)"
              >
                {{ t('ui.common.edit') }}
              </Link>
              <Button
                type="button"
                variant="ghost"
                :class="TOUCH"
                :disabled="sending"
                @click="ask(user)"
              >
                {{ user.isActive ? t('ui.users.deactivate') : t('ui.users.reactivate') }}
              </Button>
            </div>
          </li>
        </ul>
      </ScreenSection>
    </EntityScreen>

    <ConfirmDialog
      v-model:open="confirmOpen"
      :title="switching?.isActive ? t('ui.users.deactivate') : t('ui.users.reactivate')"
      :description="
        switching
          ? t(switching.isActive ? 'ui.users.deactivateConfirm' : 'ui.users.reactivateConfirm', {
              name: nameOf(switching),
            })
          : ''
      "
      :confirm-label="switching?.isActive ? t('ui.users.deactivate') : t('ui.users.reactivate')"
      @confirm="confirmed"
    />
  </AppLayout>
</template>
