<script setup lang="ts">
import { t } from '~/i18n'
import AuthLayout from '~/layouts/auth.vue'
import AuthField from '~/components/auth_field.vue'
import { Button } from '~/components/ui/button'
import { Form } from '@adonisjs/inertia/vue'
</script>

<template>
  <AuthLayout>
    <h1 class="font-display text-[26px] font-bold tracking-[0.01em]">
      {{ t('ui.auth.loginTitle') }}
    </h1>
    <p class="mt-1 text-sm text-muted-foreground">{{ t('ui.auth.loginSubtitle') }}</p>

    <Form v-slot="{ processing, errors }" route="session.store" class="mt-7 flex flex-col gap-4">
      <AuthField
        name="email"
        type="email"
        autocomplete="username"
        :label="t('ui.auth.email')"
        :error="errors.email"
      />
      <AuthField
        name="password"
        type="password"
        autocomplete="current-password"
        :label="t('ui.auth.password')"
        :error="errors.password"
      />

      <Button type="submit" size="touch" class="mt-2 w-full" :disabled="processing">
        {{ processing ? t('ui.common.processing') : t('ui.auth.signIn') }}
      </Button>
    </Form>
  </AuthLayout>
</template>
