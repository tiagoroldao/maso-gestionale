<script setup lang="ts">
import AuthLayout from '~/layouts/auth.vue'
import { Form } from '@adonisjs/inertia/vue'
</script>

<template>
  <AuthLayout>
    <h1 class="auth__title">Sign in</h1>
    <p class="auth__sub">Use the account your administrator created for you.</p>

    <Form v-slot="{ processing, errors }" route="session.store">
      <div class="auth__form">
        <div class="field">
          <label class="field__label" for="email">Email</label>
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
          <label class="field__label" for="password">Password</label>
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
          {{ processing ? 'One moment…' : 'Sign in' }}
        </button>
      </div>
    </Form>
  </AuthLayout>
</template>
