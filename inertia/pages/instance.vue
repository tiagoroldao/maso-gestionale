<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { SDI_MODES } from '@shared/instance'
import { t } from '~/i18n'

defineProps<{
  settings: {
    sdiMode: string
    hasApiKey: boolean
    pollingMinutes: number
    webhookEnabled: boolean
    hasWebhookSecret: boolean
    publicUrl: string | null
  }
  admins: { id: number; name: string | null; email: string; active: boolean }[]
}>()
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.instance.title')" :description="t('ui.instance.text')">
      <Section :title="t('ui.instance.sdiSection')">
        <Form v-slot="{ processing, errors }" route="instance.update">
          <div class="field">
            <label class="field__label" for="sdi-mode">{{ t('ui.instance.sdiMode') }}</label>
            <select id="sdi-mode" name="sdiMode" class="field__input">
              <option
                v-for="mode in SDI_MODES"
                :key="mode"
                :value="mode"
                :selected="mode === settings.sdiMode"
              >
                {{ t(`ui.instance.sdiModes.${mode}`) }}
              </option>
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="api-key">{{ t('ui.instance.apiKey') }}</label>
            <input
              id="api-key"
              name="invoicetronicApiKey"
              type="password"
              autocomplete="off"
              class="field__input"
            />
            <template v-if="settings.hasApiKey">
              <span class="field__hint">{{ t('ui.instance.secretStored') }}</span>
              <label>
                <input type="checkbox" name="clearApiKey" value="true" />
                {{ t('ui.instance.clearApiKey') }}
              </label>
            </template>
          </div>
          <div class="field">
            <label class="field__label" for="polling">{{ t('ui.instance.pollingMinutes') }}</label>
            <input
              id="polling"
              name="pollingMinutes"
              inputmode="numeric"
              class="field__input"
              :value="settings.pollingMinutes"
              :style="{ maxWidth: '120px' }"
            />
            <span v-if="errors.pollingMinutes" class="field__error">{{
              errors.pollingMinutes
            }}</span>
          </div>
          <div class="field">
            <label>
              <input
                type="checkbox"
                name="webhookEnabled"
                value="true"
                :checked="settings.webhookEnabled"
              />
              {{ t('ui.instance.webhookEnabled') }}
            </label>
          </div>
          <div class="field">
            <label class="field__label" for="webhook-secret">{{
              t('ui.instance.webhookSecret')
            }}</label>
            <input
              id="webhook-secret"
              name="webhookSecret"
              type="password"
              autocomplete="off"
              class="field__input"
            />
            <template v-if="settings.hasWebhookSecret">
              <span class="field__hint">{{ t('ui.instance.secretStored') }}</span>
              <label>
                <input type="checkbox" name="clearWebhookSecret" value="true" />
                {{ t('ui.instance.clearWebhookSecret') }}
              </label>
            </template>
          </div>
          <div class="field">
            <label class="field__label" for="public-url">{{ t('ui.instance.publicUrl') }}</label>
            <input
              id="public-url"
              name="publicUrl"
              type="url"
              class="field__input"
              :value="settings.publicUrl ?? ''"
            />
            <span v-if="errors.publicUrl" class="field__error">{{ errors.publicUrl }}</span>
          </div>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.instance.save') }}
          </button>
        </Form>
      </Section>

      <Section
        :title="t('ui.instance.adminsSection')"
        :description="t('ui.instance.adminsDescription')"
      >
        <Form
          v-for="admin in admins"
          :key="admin.id"
          v-slot="{ processing, errors }"
          route="instance.admin_password"
          :params="{ id: admin.id }"
          :style="{ marginBottom: '12px' }"
        >
          <p :style="{ margin: '0 0 4px' }">
            <strong>{{ admin.name ?? admin.email }}</strong> · {{ admin.email }}
            <span v-if="!admin.active" class="field__hint">{{ t('ui.instance.inactive') }}</span>
          </p>
          <div :style="{ display: 'flex', gap: '8px', flexWrap: 'wrap' }">
            <input
              name="password"
              type="password"
              autocomplete="new-password"
              class="field__input"
              :aria-label="t('ui.instance.newPasswordFor', { email: admin.email })"
              :style="{ maxWidth: '220px' }"
            />
            <input
              name="passwordConfirmation"
              type="password"
              autocomplete="new-password"
              class="field__input"
              :aria-label="t('ui.instance.confirmPasswordFor', { email: admin.email })"
              :style="{ maxWidth: '220px' }"
            />
            <button type="submit" class="btn btn--secondary btn--sm" :disabled="processing">
              {{ t('ui.instance.setPassword') }}
            </button>
          </div>
          <span v-if="errors.password" class="field__error">{{ errors.password }}</span>
          <span v-if="errors.passwordConfirmation" class="field__error">{{
            errors.passwordConfirmation
          }}</span>
        </Form>
      </Section>
    </Page>
  </AppLayout>
</template>
