<script setup lang="ts">
import { Form } from '@adonisjs/inertia/vue'
import Page from '~/components/page.vue'
import Section from '~/components/section.vue'
import AppLayout from '~/layouts/app.vue'
import { SDI_ENVIRONMENTS, SDI_MODES, type LegalStorageStatus } from '@shared/instance'
import { isSdiFailureCode, type PollFailure } from '@shared/sdi_failures'
import { formatDateTime } from '@shared/dates'
import { t } from '~/i18n'

defineProps<{
  settings: {
    sdiMode: string
    sdiEnvironment: string
    legalStorage: LegalStorageStatus
    legalStorageReadAt: string | null
    hasToken: boolean
    tokenUnreadable: boolean
    pollingMinutes: number
    webhookEnabled: boolean
    hasWebhookSecret: boolean
    secretUnreadable: boolean
    publicUrl: string | null
    webhookUrl: string | null
    polledAt: string | null
    pollFailures: PollFailure[]
    receivedWaiting: number
    receivedNotArchived: number
  }
  backups: {
    endpoint: string | null
    bucket: string | null
    region: string | null
    accessKeyId: string | null
    hasSecret: boolean
    retention: number
    recipient: string | null
    startedAt: string | null
    succeededAt: string | null
    lastName: string | null
    failedAt: string | null
    failure: string | null
  }
  admins: { id: number; name: string | null; email: string; active: boolean }[]
}>()

/** A code the app names in Italian, or Openapi's own message as it is */
const sdiFailure = (detail: string) =>
  isSdiFailureCode(detail) ? t(`ui.sdiFailures.${detail}`) : detail

// Each Supplier Invoice archived is paid for: asked first (#214)
const confirmArchiveExisting = () => window.confirm(t('ui.instance.archiveExistingConfirm'))
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
            <label class="field__label" for="sdi-environment">{{
              t('ui.instance.sdiEnvironment')
            }}</label>
            <select id="sdi-environment" name="sdiEnvironment" class="field__input">
              <option
                v-for="environment in SDI_ENVIRONMENTS"
                :key="environment"
                :value="environment"
                :selected="environment === settings.sdiEnvironment"
              >
                {{ t(`ui.instance.sdiEnvironments.${environment}`) }}
              </option>
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="openapi-token">{{ t('ui.instance.token') }}</label>
            <input
              id="openapi-token"
              name="openapiToken"
              type="password"
              autocomplete="off"
              class="field__input"
            />
            <span v-if="settings.tokenUnreadable" class="field__error">{{
              t('ui.instance.secretUnreadable')
            }}</span>
            <template v-if="settings.hasToken">
              <span class="field__hint">{{ t('ui.instance.secretStored') }}</span>
              <label>
                <input type="checkbox" name="clearToken" value="true" />
                {{ t('ui.instance.clearToken') }}
              </label>
            </template>
            <span v-if="errors.openapiToken" class="field__error">{{ errors.openapiToken }}</span>
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
            <span v-if="settings.secretUnreadable" class="field__error">{{
              t('ui.instance.secretUnreadable')
            }}</span>
            <template v-if="settings.hasWebhookSecret">
              <span class="field__hint">{{ t('ui.instance.secretStored') }}</span>
              <label>
                <input type="checkbox" name="clearWebhookSecret" value="true" />
                {{ t('ui.instance.clearWebhookSecret') }}
              </label>
            </template>
            <span v-if="errors.webhookSecret" class="field__error">{{ errors.webhookSecret }}</span>
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
            <span v-if="settings.webhookUrl" class="field__hint">{{
              t('ui.instance.webhookUrl', { url: settings.webhookUrl })
            }}</span>
          </div>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.instance.save') }}
          </button>
        </Form>
        <h3>{{ t('ui.instance.legalStorageTitle') }}</h3>
        <p>{{ t(`ui.instance.legalStorage.${settings.legalStorage}`) }}</p>
        <p
          v-if="settings.legalStorage !== 'manual' && settings.legalStorageReadAt"
          class="field__hint"
        >
          {{
            t('ui.instance.legalStorageReadAt', { at: formatDateTime(settings.legalStorageReadAt) })
          }}
        </p>
        <p v-if="settings.legalStorage === 'active'" class="field__hint">
          {{ t('ui.instance.legalStorageActiveHint') }}
        </p>
        <template v-else>
          <p v-if="settings.legalStorage === 'inactive'" class="field__hint">
            {{ t('ui.instance.legalStorageSetup') }}
          </p>
          <p class="field__hint">{{ t('ui.instance.legalArchivingElsewhere') }}</p>
        </template>
        <h3>{{ t('ui.instance.pollStatus') }}</h3>
        <p v-if="settings.polledAt">
          {{ t('ui.instance.lastPoll', { at: formatDateTime(settings.polledAt) }) }}
        </p>
        <p v-else>{{ t('ui.instance.noPoll') }}</p>
        <template v-if="settings.pollFailures.length">
          <p class="field__error">{{ t('ui.instance.pollFailure') }}</p>
          <ul>
            <li v-for="(failure, index) in settings.pollFailures" :key="index">
              {{ t(`ui.instance.pollSteps.${failure.step}`, { subject: failure.subject ?? '' }) }}:
              {{ sdiFailure(failure.detail) }}
            </li>
          </ul>
        </template>
        <p v-if="settings.receivedWaiting">
          {{ t('ui.instance.receivedWaiting', { count: settings.receivedWaiting }) }}
        </p>
        <Form
          v-if="settings.legalStorage === 'active' && settings.receivedNotArchived"
          v-slot="{ processing }"
          route="instance.archive_supplier_invoices"
          :on-before="confirmArchiveExisting"
        >
          <p>
            {{ t('ui.instance.archiveExistingHint', { count: settings.receivedNotArchived }) }}
          </p>
          <button type="submit" class="btn btn--secondary" :disabled="processing">
            {{ t('ui.instance.archiveExisting') }}
          </button>
        </Form>
      </Section>

      <Section
        :title="t('ui.instance.backups.section')"
        :description="t('ui.instance.backups.description')"
      >
        <h3>{{ t('ui.instance.backups.status') }}</h3>
        <p v-if="backups.startedAt">
          {{ t('ui.instance.backups.running', { at: formatDateTime(backups.startedAt) }) }}
        </p>
        <p v-if="backups.succeededAt">
          {{
            t('ui.instance.backups.lastSuccess', {
              at: formatDateTime(backups.succeededAt),
              name: backups.lastName,
            })
          }}
        </p>
        <p v-else>{{ t('ui.instance.backups.noSuccess') }}</p>
        <template v-if="backups.failedAt">
          <p class="field__error">
            {{ t('ui.instance.backups.lastFailure', { at: formatDateTime(backups.failedAt) }) }}
          </p>
          <pre :style="{ whiteSpace: 'pre-wrap' }">{{ backups.failure }}</pre>
        </template>
        <Form
          v-slot="{ processing }"
          route="instance.backups.run"
          :style="{ marginBottom: '16px' }"
        >
          <button type="submit" class="btn btn--secondary" :disabled="processing">
            {{ t('ui.instance.backups.runNow') }}
          </button>
        </Form>

        <Form v-slot="{ processing, errors }" route="instance.backups">
          <div class="field">
            <label class="field__label" for="backup-endpoint">{{
              t('ui.instance.backups.endpoint')
            }}</label>
            <input
              id="backup-endpoint"
              name="backupEndpoint"
              type="url"
              class="field__input"
              :value="backups.endpoint ?? ''"
            />
            <span v-if="errors.backupEndpoint" class="field__error">{{
              errors.backupEndpoint
            }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="backup-bucket">{{
              t('ui.instance.backups.bucket')
            }}</label>
            <input
              id="backup-bucket"
              name="backupBucket"
              class="field__input"
              :value="backups.bucket ?? ''"
            />
            <span v-if="errors.backupBucket" class="field__error">{{ errors.backupBucket }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="backup-region">{{
              t('ui.instance.backups.region')
            }}</label>
            <input
              id="backup-region"
              name="backupRegion"
              class="field__input"
              :value="backups.region ?? ''"
            />
            <span v-if="errors.backupRegion" class="field__error">{{ errors.backupRegion }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="backup-access-key">{{
              t('ui.instance.backups.accessKeyId')
            }}</label>
            <input
              id="backup-access-key"
              name="backupAccessKeyId"
              autocomplete="off"
              class="field__input"
              :value="backups.accessKeyId ?? ''"
            />
            <span v-if="errors.backupAccessKeyId" class="field__error">{{
              errors.backupAccessKeyId
            }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="backup-secret">{{
              t('ui.instance.backups.secretAccessKey')
            }}</label>
            <input
              id="backup-secret"
              name="backupSecretAccessKey"
              type="password"
              autocomplete="off"
              class="field__input"
            />
            <span v-if="backups.hasSecret" class="field__hint">{{
              t('ui.instance.secretStored')
            }}</span>
            <span v-if="errors.backupSecretAccessKey" class="field__error">{{
              errors.backupSecretAccessKey
            }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="backup-retention">{{
              t('ui.instance.backups.retention')
            }}</label>
            <input
              id="backup-retention"
              name="backupRetention"
              inputmode="numeric"
              class="field__input"
              :value="backups.retention"
              :style="{ maxWidth: '120px' }"
            />
            <span class="field__hint">{{ t('ui.instance.backups.retentionHint') }}</span>
            <span v-if="errors.backupRetention" class="field__error">{{
              errors.backupRetention
            }}</span>
          </div>
          <p>
            <strong>{{ t('ui.instance.backups.passphraseWarning') }}</strong>
          </p>
          <p>{{ t('ui.instance.backups.appKeyWarning') }}</p>
          <p v-if="backups.recipient" class="field__hint">
            {{ t('ui.instance.backups.passphraseChange') }}
          </p>
          <div class="field">
            <label class="field__label" for="backup-passphrase">{{
              t('ui.instance.backups.passphrase')
            }}</label>
            <input
              id="backup-passphrase"
              name="backupPassphrase"
              type="password"
              autocomplete="new-password"
              class="field__input"
            />
            <span v-if="backups.recipient" class="field__hint">{{
              t('ui.instance.backups.passphraseSet')
            }}</span>
            <span v-if="errors.backupPassphrase" class="field__error">{{
              errors.backupPassphrase
            }}</span>
          </div>
          <div class="field">
            <label class="field__label" for="backup-passphrase-confirmation">{{
              t('ui.instance.backups.passphraseConfirmation')
            }}</label>
            <input
              id="backup-passphrase-confirmation"
              name="backupPassphraseConfirmation"
              type="password"
              autocomplete="new-password"
              class="field__input"
            />
            <span v-if="errors.backupPassphraseConfirmation" class="field__error">{{
              errors.backupPassphraseConfirmation
            }}</span>
          </div>
          <p v-if="backups.recipient" class="field__hint">
            {{ t('ui.instance.backups.publicKey', { key: backups.recipient }) }}
          </p>
          <button type="submit" class="btn btn--primary" :disabled="processing">
            {{ t('ui.instance.backups.save') }}
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
          <!-- Under both inputs, so naming the one each error is about -->
          <span v-if="errors.password" class="field__error">
            {{
              t('ui.common.fieldError', {
                field: t('ui.instance.newPasswordFor', { email: admin.email }),
                message: errors.password,
              })
            }}
          </span>
          <span v-if="errors.passwordConfirmation" class="field__error">
            {{
              t('ui.common.fieldError', {
                field: t('ui.instance.confirmPasswordFor', { email: admin.email }),
                message: errors.passwordConfirmation,
              })
            }}
          </span>
        </Form>
      </Section>
    </Page>
  </AppLayout>
</template>
