<script setup lang="ts">
/**
 * Istanza, the Superuser's screen on the new UI (docs/ui.md "Settings",
 * several short forms): sending to SDI, the legal storage it implies, the
 * last poll, the backups and recovering an Admin's account, each form in
 * its section with its own Save. The header has no actions.
 */
import { ref } from 'vue'
import { router } from '@inertiajs/vue3'
import { Form } from '@adonisjs/inertia/vue'
import { CircleAlert } from 'lucide-vue-next'
import AppLayout from '~/layouts/app.vue'
import { SDI_ENVIRONMENTS, SDI_MODES, type LegalStorageStatus } from '@shared/instance'
import { isSdiFailureCode, type PollFailure } from '@shared/sdi_failures'
import { formatDateTime } from '@shared/dates'
import { urlFor } from '~/client'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { NativeSelect } from '~/components/ui/native-select'
import EntityScreen from '~/components/screen/entity_screen.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import ConfirmDialog from '~/components/screen/confirm_dialog.vue'
import FormField from '~/components/screen/form_field.vue'
import RowErrors from '~/components/screen/row_errors.vue'
import { EDIT_ROW, EDIT_ROW_FORM, TOUCH } from '~/components/screen/screen'

const props = defineProps<{
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

const sdiMode = ref(props.settings.sdiMode)
const sdiEnvironment = ref(props.settings.sdiEnvironment)

// Each Supplier Invoice archived is paid for: asked first (#214)
const archiveOpen = ref(false)
// Held while it is sent, so a second click can't ask twice
const archiving = ref(false)
function archiveExisting() {
  archiveOpen.value = false
  if (archiving.value) return
  router.post(
    urlFor('instance.archive_supplier_invoices'),
    {},
    {
      onStart: () => (archiving.value = true),
      onFinish: () => (archiving.value = false),
    }
  )
}

const FORM = 'flex flex-col gap-4'
const GRID = 'grid gap-4 md:grid-cols-2'
const SAVE = [TOUCH, 'self-start']
const TEXT = 'm-0 text-sm'
const HINT = 'm-0 text-[13px] text-muted-foreground'
const ERROR = 'm-0 flex items-start gap-1.5 text-sm text-destructive'
const CHECK = 'flex min-h-11 items-center gap-2.5 text-sm md:min-h-0'
const SUBTITLE = 'm-0 text-sm font-semibold'
</script>

<template>
  <AppLayout>
    <EntityScreen
      :document-title="t('ui.instance.title')"
      :crumbs="[]"
      :current="t('ui.instance.title')"
      :title="t('ui.instance.title')"
    >
      <p :class="HINT">{{ t('ui.instance.text') }}</p>

      <ScreenSection :title="t('ui.instance.sdiSection')">
        <Form v-slot="{ processing, errors }" route="instance.update" :class="FORM">
          <div :class="GRID">
            <FormField id="sdi-mode" v-slot="field" :label="t('ui.instance.sdiMode')">
              <NativeSelect :id="field.id" v-model="sdiMode" name="sdiMode">
                <option v-for="mode in SDI_MODES" :key="mode" :value="mode">
                  {{ t(`ui.instance.sdiModes.${mode}`) }}
                </option>
              </NativeSelect>
            </FormField>
            <FormField id="sdi-environment" v-slot="field" :label="t('ui.instance.sdiEnvironment')">
              <NativeSelect :id="field.id" v-model="sdiEnvironment" name="sdiEnvironment">
                <option
                  v-for="environment in SDI_ENVIRONMENTS"
                  :key="environment"
                  :value="environment"
                >
                  {{ t(`ui.instance.sdiEnvironments.${environment}`) }}
                </option>
              </NativeSelect>
            </FormField>
            <div class="flex flex-col gap-2">
              <FormField
                id="openapi-token"
                v-slot="field"
                :label="t('ui.instance.token')"
                :hint="settings.hasToken ? t('ui.instance.secretStored') : undefined"
                :error="
                  errors.openapiToken ??
                  (settings.tokenUnreadable ? t('ui.instance.secretUnreadable') : undefined)
                "
              >
                <Input
                  :id="field.id"
                  name="openapiToken"
                  type="password"
                  autocomplete="off"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                  :class="TOUCH"
                />
              </FormField>
              <label v-if="settings.hasToken" :class="CHECK">
                <input type="checkbox" name="clearToken" value="true" class="size-4" />
                {{ t('ui.instance.clearToken') }}
              </label>
            </div>
            <FormField
              id="polling"
              v-slot="field"
              :label="t('ui.instance.pollingMinutes')"
              :error="errors.pollingMinutes"
            >
              <Input
                :id="field.id"
                name="pollingMinutes"
                inputmode="numeric"
                :default-value="settings.pollingMinutes"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="[TOUCH, 'md:w-32']"
              />
            </FormField>
            <div class="flex flex-col gap-2">
              <FormField
                id="webhook-secret"
                v-slot="field"
                :label="t('ui.instance.webhookSecret')"
                :hint="settings.hasWebhookSecret ? t('ui.instance.secretStored') : undefined"
                :error="
                  errors.webhookSecret ??
                  (settings.secretUnreadable ? t('ui.instance.secretUnreadable') : undefined)
                "
              >
                <Input
                  :id="field.id"
                  name="webhookSecret"
                  type="password"
                  autocomplete="off"
                  :aria-invalid="field.invalid"
                  :aria-describedby="field.describedBy"
                  :class="TOUCH"
                />
              </FormField>
              <label v-if="settings.hasWebhookSecret" :class="CHECK">
                <input type="checkbox" name="clearWebhookSecret" value="true" class="size-4" />
                {{ t('ui.instance.clearWebhookSecret') }}
              </label>
              <label :class="CHECK">
                <input
                  type="checkbox"
                  name="webhookEnabled"
                  value="true"
                  :checked="settings.webhookEnabled"
                  class="size-4"
                />
                {{ t('ui.instance.webhookEnabled') }}
              </label>
            </div>
            <FormField
              id="public-url"
              v-slot="field"
              :label="t('ui.instance.publicUrl')"
              :hint="
                settings.webhookUrl
                  ? t('ui.instance.webhookUrl', { url: settings.webhookUrl })
                  : undefined
              "
              :error="errors.publicUrl"
            >
              <Input
                :id="field.id"
                name="publicUrl"
                type="url"
                :default-value="settings.publicUrl ?? ''"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="TOUCH"
              />
            </FormField>
          </div>
          <Button type="submit" variant="outline" :class="SAVE" :disabled="processing">
            {{ t('ui.instance.save') }}
          </Button>
        </Form>
      </ScreenSection>

      <ScreenSection :title="t('ui.instance.legalStorageTitle')">
        <template
          v-if="settings.legalStorage === 'active' && settings.receivedNotArchived"
          #actions
        >
          <Button
            variant="outline"
            :class="TOUCH"
            :disabled="archiving"
            @click="archiveOpen = true"
          >
            {{ t('ui.instance.archiveExisting') }}
          </Button>
        </template>
        <p :class="TEXT">{{ t(`ui.instance.legalStorage.${settings.legalStorage}`) }}</p>
        <p v-if="settings.legalStorage !== 'manual' && settings.legalStorageReadAt" :class="HINT">
          {{
            t('ui.instance.legalStorageReadAt', { at: formatDateTime(settings.legalStorageReadAt) })
          }}
        </p>
        <p v-if="settings.legalStorage === 'active'" :class="HINT">
          {{ t('ui.instance.legalStorageActiveHint') }}
        </p>
        <template v-else>
          <p v-if="settings.legalStorage === 'inactive'" :class="HINT">
            {{ t('ui.instance.legalStorageSetup') }}
          </p>
          <p :class="HINT">{{ t('ui.instance.legalArchivingElsewhere') }}</p>
        </template>
        <p v-if="settings.legalStorage === 'active' && settings.receivedNotArchived" :class="TEXT">
          {{ t('ui.instance.archiveExistingHint', { count: settings.receivedNotArchived }) }}
        </p>
      </ScreenSection>

      <ScreenSection :title="t('ui.instance.pollStatus')">
        <p v-if="settings.polledAt" :class="TEXT">
          {{ t('ui.instance.lastPoll', { at: formatDateTime(settings.polledAt) }) }}
        </p>
        <p v-else :class="TEXT">{{ t('ui.instance.noPoll') }}</p>
        <template v-if="settings.pollFailures.length">
          <p :class="ERROR">
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
            {{ t('ui.instance.pollFailure') }}
          </p>
          <ul class="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
            <li v-for="(failure, index) in settings.pollFailures" :key="index">
              {{ t(`ui.instance.pollSteps.${failure.step}`, { subject: failure.subject ?? '' }) }}:
              {{ sdiFailure(failure.detail) }}
            </li>
          </ul>
        </template>
        <p v-if="settings.receivedWaiting" :class="TEXT">
          {{ t('ui.instance.receivedWaiting', { count: settings.receivedWaiting }) }}
        </p>
      </ScreenSection>

      <ScreenSection
        :title="t('ui.instance.backups.section')"
        :description="t('ui.instance.backups.description')"
      >
        <template #actions>
          <Form v-slot="{ processing }" route="instance.backups.run">
            <Button type="submit" variant="outline" :class="TOUCH" :disabled="processing">
              {{ t('ui.instance.backups.runNow') }}
            </Button>
          </Form>
        </template>
        <h3 :class="SUBTITLE">{{ t('ui.instance.backups.status') }}</h3>
        <p v-if="backups.startedAt" :class="TEXT">
          {{ t('ui.instance.backups.running', { at: formatDateTime(backups.startedAt) }) }}
        </p>
        <p v-if="backups.succeededAt" :class="TEXT">
          {{
            t('ui.instance.backups.lastSuccess', {
              at: formatDateTime(backups.succeededAt),
              name: backups.lastName,
            })
          }}
        </p>
        <p v-else :class="TEXT">{{ t('ui.instance.backups.noSuccess') }}</p>
        <template v-if="backups.failedAt">
          <p :class="ERROR">
            <CircleAlert :size="16" aria-hidden="true" class="mt-0.5 shrink-0" />
            {{ t('ui.instance.backups.lastFailure', { at: formatDateTime(backups.failedAt) }) }}
          </p>
          <pre
            class="m-0 overflow-x-auto rounded-sm border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap"
            >{{ backups.failure }}</pre>
        </template>

        <Form v-slot="{ processing, errors }" route="instance.backups" :class="FORM">
          <div :class="GRID">
            <FormField
              id="backup-endpoint"
              v-slot="field"
              :label="t('ui.instance.backups.endpoint')"
              :error="errors.backupEndpoint"
            >
              <Input
                :id="field.id"
                name="backupEndpoint"
                type="url"
                :default-value="backups.endpoint ?? ''"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="TOUCH"
              />
            </FormField>
            <FormField
              id="backup-bucket"
              v-slot="field"
              :label="t('ui.instance.backups.bucket')"
              :error="errors.backupBucket"
            >
              <Input
                :id="field.id"
                name="backupBucket"
                :default-value="backups.bucket ?? ''"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="TOUCH"
              />
            </FormField>
            <FormField
              id="backup-region"
              v-slot="field"
              :label="t('ui.instance.backups.region')"
              :error="errors.backupRegion"
            >
              <Input
                :id="field.id"
                name="backupRegion"
                :default-value="backups.region ?? ''"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="TOUCH"
              />
            </FormField>
            <FormField
              id="backup-access-key"
              v-slot="field"
              :label="t('ui.instance.backups.accessKeyId')"
              :error="errors.backupAccessKeyId"
            >
              <Input
                :id="field.id"
                name="backupAccessKeyId"
                autocomplete="off"
                :default-value="backups.accessKeyId ?? ''"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="TOUCH"
              />
            </FormField>
            <FormField
              id="backup-secret"
              v-slot="field"
              :label="t('ui.instance.backups.secretAccessKey')"
              :hint="backups.hasSecret ? t('ui.instance.secretStored') : undefined"
              :error="errors.backupSecretAccessKey"
            >
              <Input
                :id="field.id"
                name="backupSecretAccessKey"
                type="password"
                autocomplete="off"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="TOUCH"
              />
            </FormField>
            <FormField
              id="backup-retention"
              v-slot="field"
              :label="t('ui.instance.backups.retention')"
              :hint="t('ui.instance.backups.retentionHint')"
              :error="errors.backupRetention"
            >
              <Input
                :id="field.id"
                name="backupRetention"
                inputmode="numeric"
                :default-value="backups.retention"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="[TOUCH, 'md:w-32']"
              />
            </FormField>
          </div>

          <p :class="cn(TEXT, 'font-semibold')">{{ t('ui.instance.backups.passphraseWarning') }}</p>
          <p :class="TEXT">{{ t('ui.instance.backups.appKeyWarning') }}</p>
          <p v-if="backups.recipient" :class="HINT">
            {{ t('ui.instance.backups.passphraseChange') }}
          </p>
          <div :class="GRID">
            <FormField
              id="backup-passphrase"
              v-slot="field"
              :label="t('ui.instance.backups.passphrase')"
              :hint="backups.recipient ? t('ui.instance.backups.passphraseSet') : undefined"
              :error="errors.backupPassphrase"
            >
              <Input
                :id="field.id"
                name="backupPassphrase"
                type="password"
                autocomplete="new-password"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="TOUCH"
              />
            </FormField>
            <FormField
              id="backup-passphrase-confirmation"
              v-slot="field"
              :label="t('ui.instance.backups.passphraseConfirmation')"
              :error="errors.backupPassphraseConfirmation"
            >
              <Input
                :id="field.id"
                name="backupPassphraseConfirmation"
                type="password"
                autocomplete="new-password"
                :aria-invalid="field.invalid"
                :aria-describedby="field.describedBy"
                :class="TOUCH"
              />
            </FormField>
          </div>
          <p v-if="backups.recipient" :class="cn(HINT, 'break-all')">
            {{ t('ui.instance.backups.publicKey', { key: backups.recipient }) }}
          </p>
          <Button type="submit" variant="outline" :class="SAVE" :disabled="processing">
            {{ t('ui.instance.backups.save') }}
          </Button>
        </Form>
      </ScreenSection>

      <ScreenSection
        :title="t('ui.instance.adminsSection')"
        :description="t('ui.instance.adminsDescription')"
        flush
      >
        <ul class="m-0 list-none p-0">
          <li v-for="admin in admins" :key="admin.id" :class="EDIT_ROW">
            <div class="flex min-w-0 flex-col md:w-64 md:shrink-0 md:pt-2">
              <span class="text-sm font-medium">{{ admin.name ?? admin.email }}</span>
              <span class="truncate text-sm text-muted-foreground">
                {{ admin.email }}
                <template v-if="!admin.active"> {{ t('ui.instance.inactive') }}</template>
              </span>
            </div>
            <Form
              v-slot="{ processing, errors }"
              route="instance.admin_password"
              :params="{ id: admin.id }"
              :class="EDIT_ROW_FORM"
            >
              <Input
                name="password"
                type="password"
                autocomplete="new-password"
                :aria-label="t('ui.instance.newPasswordFor', { email: admin.email })"
                :placeholder="t('ui.users.newPassword')"
                :aria-invalid="errors.password ? 'true' : undefined"
                :class="[TOUCH, 'md:w-52']"
              />
              <Input
                name="passwordConfirmation"
                type="password"
                autocomplete="new-password"
                :aria-label="t('ui.instance.confirmPasswordFor', { email: admin.email })"
                :placeholder="t('ui.users.confirmPassword')"
                :aria-invalid="errors.passwordConfirmation ? 'true' : undefined"
                :class="[TOUCH, 'md:w-52']"
              />
              <Button type="submit" variant="outline" :class="TOUCH" :disabled="processing">
                {{ t('ui.instance.setPassword') }}
              </Button>
              <RowErrors
                :errors="errors"
                :fields="{
                  password: t('ui.instance.newPasswordFor', { email: admin.email }),
                  passwordConfirmation: t('ui.instance.confirmPasswordFor', {
                    email: admin.email,
                  }),
                }"
              />
            </Form>
          </li>
        </ul>
      </ScreenSection>
    </EntityScreen>

    <ConfirmDialog
      v-model:open="archiveOpen"
      :title="t('ui.instance.archiveExisting')"
      :description="t('ui.instance.archiveExistingConfirm')"
      :confirm-label="t('ui.instance.archiveExisting')"
      @confirm="archiveExisting"
    />
  </AppLayout>
</template>
