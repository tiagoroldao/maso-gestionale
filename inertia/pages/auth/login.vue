<script setup lang="ts">
import { t } from '~/i18n'
import AuthLayout from '~/layouts/auth.vue'
import { Form } from '@adonisjs/inertia/vue'
</script>

<template>
  <AuthLayout>
    <h1 class="auth__title">{{ t('ui.auth.loginTitle') }}</h1>
    <p class="auth__sub">{{ t('ui.auth.loginSubtitle') }}</p>

    <Form v-slot="{ processing, errors }" route="session.store">
      <div class="auth__form">
        <div class="field">
          <label class="field__label" for="email">{{ t('ui.auth.email') }}</label>
          <input
            id="email"
            name="email"
            type="email"
            class="field__input"
            autocomplete="username"
            :aria-invalid="errors.email ? 'true' : 'false'"
          />
          <span v-if="errors.email" class="field__error">{{ errors.email }}</span>
        </div>

        <div class="field">
          <label class="field__label" for="password">{{ t('ui.auth.password') }}</label>
          <input
            id="password"
            name="password"
            type="password"
            class="field__input"
            autocomplete="current-password"
            :aria-invalid="errors.password ? 'true' : 'false'"
          />
          <span v-if="errors.password" class="field__error">{{ errors.password }}</span>
        </div>

        <button
          type="submit"
          class="btn btn--primary btn--block"
          :disabled="processing"
          :style="{ marginTop: '4px' }"
        >
          {{ processing ? t('ui.common.processing') : t('ui.auth.signIn') }}
        </button>
      </div>
    </Form>
  </AuthLayout>
</template>
