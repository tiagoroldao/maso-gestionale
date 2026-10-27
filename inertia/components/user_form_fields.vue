<script setup lang="ts">
/**
 * Fields shared by the create and edit user forms. On edit, leaving the
 * password empty keeps the current one.
 */
defineProps<{
  errors: Partial<Record<string, string>>
  user?: { fullName: string | null; email: string; role: string }
  passwordOptional?: boolean
}>()
</script>

<template>
  <div class="field">
    <label class="field__label" for="fullName">Full name</label>
    <input
      id="fullName"
      name="fullName"
      type="text"
      class="field__input"
      :value="user?.fullName ?? ''"
      :aria-invalid="errors.fullName ? 'true' : 'false'"
    />
    <span v-if="errors.fullName" class="field__error">{{ errors.fullName }}</span>
  </div>

  <div class="field">
    <label class="field__label" for="email">Email</label>
    <input
      id="email"
      name="email"
      type="email"
      class="field__input"
      autocomplete="off"
      :value="user?.email ?? ''"
      :aria-invalid="errors.email ? 'true' : 'false'"
    />
    <span v-if="errors.email" class="field__error">{{ errors.email }}</span>
  </div>

  <div class="field">
    <label class="field__label" for="role">Role</label>
    <select id="role" name="role" class="field__input" :value="user?.role ?? 'technician'">
      <option value="technician">Technician</option>
      <option value="office">Office</option>
    </select>
    <span v-if="errors.role" class="field__error">{{ errors.role }}</span>
  </div>

  <div class="field">
    <label class="field__label" for="password">
      {{ passwordOptional ? 'New password' : 'Password' }}
    </label>
    <input
      id="password"
      name="password"
      type="password"
      class="field__input"
      autocomplete="new-password"
      :aria-invalid="errors.password ? 'true' : 'false'"
    />
    <span v-if="passwordOptional" class="field__hint"
      >Leave empty to keep the current password.</span
    >
    <span v-if="errors.password" class="field__error">{{ errors.password }}</span>
  </div>

  <div class="field">
    <label class="field__label" for="passwordConfirmation">Confirm password</label>
    <input
      id="passwordConfirmation"
      name="passwordConfirmation"
      type="password"
      class="field__input"
      autocomplete="new-password"
      :aria-invalid="errors.passwordConfirmation ? 'true' : 'false'"
    />
    <span v-if="errors.passwordConfirmation" class="field__error">
      {{ errors.passwordConfirmation }}
    </span>
  </div>
</template>
