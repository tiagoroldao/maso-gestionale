<script setup lang="ts">
/**
 * The sections shared by the create and edit user screens: who the user
 * is, then the password. On edit, leaving the password empty keeps the
 * current one.
 */
import { ref } from 'vue'
import { t } from '~/i18n'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import FormField from '~/components/screen/form_field.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import { TOUCH } from '~/components/screen/screen'

const props = defineProps<{
  errors: Partial<Record<string, string>>
  user?: { fullName: string | null; email: string; role: string }
  passwordOptional?: boolean
}>()

const role = ref(props.user?.role ?? 'technician')
</script>

<template>
  <ScreenSection :title="t('ui.users.detailsSection')">
    <div class="grid gap-4 md:grid-cols-2">
      <FormField
        id="fullName"
        v-slot="field"
        :label="t('ui.users.fullName')"
        :error="errors.fullName"
      >
        <Input
          :id="field.id"
          name="fullName"
          :default-value="user?.fullName ?? ''"
          :aria-invalid="field.invalid"
          :aria-describedby="field.describedBy"
          :class="TOUCH"
        />
      </FormField>

      <FormField id="email" v-slot="field" :label="t('ui.users.email')" :error="errors.email">
        <Input
          :id="field.id"
          name="email"
          type="email"
          autocomplete="off"
          :default-value="user?.email ?? ''"
          :aria-invalid="field.invalid"
          :aria-describedby="field.describedBy"
          :class="TOUCH"
        />
      </FormField>

      <FormField id="role" v-slot="field" :label="t('ui.users.role')" :error="errors.role">
        <NativeSelect
          :id="field.id"
          v-model="role"
          name="role"
          :aria-invalid="field.invalid"
          :aria-describedby="field.describedBy"
        >
          <option value="technician">{{ t('ui.roles.technician') }}</option>
          <option value="office">{{ t('ui.roles.office') }}</option>
        </NativeSelect>
      </FormField>
    </div>
  </ScreenSection>

  <ScreenSection :title="t('ui.users.passwordSection')">
    <div class="grid gap-4 md:grid-cols-2">
      <FormField
        id="password"
        v-slot="field"
        :label="passwordOptional ? t('ui.users.newPassword') : t('ui.users.password')"
        :hint="passwordOptional ? t('ui.users.keepPasswordHint') : undefined"
        :error="errors.password"
      >
        <Input
          :id="field.id"
          name="password"
          type="password"
          autocomplete="new-password"
          :aria-invalid="field.invalid"
          :aria-describedby="field.describedBy"
          :class="TOUCH"
        />
      </FormField>

      <FormField
        id="passwordConfirmation"
        v-slot="field"
        :label="t('ui.users.confirmPassword')"
        :error="errors.passwordConfirmation"
      >
        <Input
          :id="field.id"
          name="passwordConfirmation"
          type="password"
          autocomplete="new-password"
          :aria-invalid="field.invalid"
          :aria-describedby="field.describedBy"
          :class="TOUCH"
        />
      </FormField>
    </div>
  </ScreenSection>
</template>
