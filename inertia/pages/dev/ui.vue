<script setup lang="ts">
/**
 * The component gallery (#252), development only: each component of the
 * new UI in its states, so one screenshot reviews the kit
 * (`npm run ui:shots -- /dev/ui`, light and dark). Add a component here
 * when it joins the kit.
 */
import { ref } from 'vue'
import { Head } from '@inertiajs/vue3'
import { declareActions } from '@shared/screen_actions'
import ScreenHeader from '~/components/screen/screen_header.vue'
import KeyFacts, { type KeyFact } from '~/components/screen/key_facts.vue'
import ScreenSection from '~/components/screen/screen_section.vue'
import StatusTag from '~/components/screen/status_tag.vue'
import ConfirmDialog from '~/components/screen/confirm_dialog.vue'
import FormField from '~/components/screen/form_field.vue'
import JobRows from '~/components/screen/job_rows.vue'
import IssuedDocumentRows from '~/components/screen/issued_document_rows.vue'
import type { JobRow } from '~/components/job_list.vue'
import type { IssuedDocumentRow } from '~/components/issued_document_list.vue'
import SitePicker from '~/components/site_picker.vue'
import ItemPicker from '~/components/item_picker.vue'
import { Textarea } from '~/components/ui/textarea'
import RecordPreview from '~/components/screen/record_preview.vue'
import type { Tone } from '~/components/screen/screen'
import { NativeSelect } from '~/components/ui/native-select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '~/components/ui/dialog'
import { ORGANISE_BY } from '@shared/invoice_sections'
import { Briefcase, LogOut, Menu, Plus, X } from 'lucide-vue-next'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import AppLayout from '~/layouts/app.vue'
import AppSidebar from '~/components/app_sidebar.vue'
import Logo from '~/components/logo.vue'
import LogoMark from '~/components/logo_mark.vue'
import ThemeToggle from '~/components/theme_toggle.vue'
import AuthField from '~/components/auth_field.vue'
import { Button, buttonVariants, type ButtonVariants } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { BAR_BUTTON, sidebarIconButtonClass, sidebarItemClass } from '~/components/shell_classes'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '~/components/ui/sheet'

const section = 'flex flex-col gap-3 border-t border-border pt-5'
const heading = 'm-0 font-display text-[11px] font-semibold tracking-[0.2em] uppercase'
const caption = 'm-0 text-xs text-muted-foreground'
const BUTTON_VARIANTS: [NonNullable<ButtonVariants['variant']>, string][] = [
  ['default', 'ui.devUi.button.default'],
  ['outline', 'ui.devUi.button.outline'],
  ['ghost', 'ui.devUi.button.ghost'],
]
const BUTTON_SIZES: NonNullable<ButtonVariants['size']>[] = ['default', 'sm', 'touch']
const frame = 'flex flex-col gap-1 rounded-sm bg-sidebar p-3.5 font-sans text-sidebar-foreground'

// The Entity screen kit (#235), with actions as the server would declare them
const sampleActions = declareActions([
  { name: 'primary', label: t('ui.devUi.action.primary'), rank: 'primary', kind: 'dialog' },
  {
    name: 'secondary',
    label: t('ui.devUi.action.secondary'),
    rank: 'secondary',
    kind: 'link',
    href: '/dev/ui',
  },
  { name: 'overflow', label: t('ui.devUi.action.overflow'), rank: 'overflow', kind: 'dialog' },
  {
    name: 'disabled',
    label: t('ui.devUi.action.disabled'),
    rank: 'overflow',
    kind: 'dialog',
    disabledReason: t('ui.devUi.action.disabledReason'),
  },
  { name: 'confirm', label: t('ui.devUi.action.destructive'), rank: 'overflow', kind: 'dialog' },
])
const sampleFacts: KeyFact[] = [
  { label: t('ui.jobs.customer'), value: t('ui.devUi.sampleCustomer'), href: '/dev/ui' },
  { label: t('ui.jobs.site'), value: t('ui.devUi.sampleSite') },
  {
    label: t('ui.jobs.toBill'),
    value: t('ui.devUi.sampleAmount'),
    amount: true,
    hint: t('ui.devUi.sampleHint'),
  },
]
// A section's rows (#239): a Customer's Jobs and Issued Documents
const sampleJobs: JobRow[] = [
  {
    id: 1,
    number: t('ui.devUi.sampleCurrent'),
    title: t('ui.devUi.sampleTitle'),
    status: 'in_progress',
    indicators: { workComplete: false, invoiced: false, paid: false },
    customer: null,
    site: { id: 1, summary: t('ui.devUi.sampleSite') },
    createdAt: '2026-10-20',
  },
  {
    id: 2,
    number: 'C-2026-0098',
    title: t('ui.devUi.sampleJobTitle'),
    status: 'closed',
    indicators: { workComplete: true, invoiced: true, paid: true },
    customer: null,
    site: { id: 1, summary: t('ui.devUi.sampleSite') },
    createdAt: '2026-06-02',
  },
  {
    id: 3,
    number: 'C-2026-0031',
    title: t('ui.devUi.sampleJobTitle'),
    status: 'cancelled',
    indicators: null,
    customer: null,
    site: null,
    createdAt: '2026-02-11',
  },
]
const sampleDocuments: IssuedDocumentRow[] = [
  {
    id: 1,
    number: 'D-2026-0012',
    title: t('ui.devUi.sampleDocument'),
    issuedOn: '2026-10-21',
    customer: t('ui.devUi.sampleCustomer'),
    replaced: false,
  },
  {
    id: 2,
    number: 'D-2026-0007',
    title: t('ui.devUi.sampleDocument'),
    issuedOn: '2026-09-03',
    customer: t('ui.devUi.sampleCustomer'),
    replaced: true,
  },
]
const TONES: [Tone, string][] = [
  ['blue', 'ui.devUi.tones.blue'],
  ['orange', 'ui.devUi.tones.orange'],
  ['green', 'ui.devUi.tones.green'],
  ['grey', 'ui.devUi.tones.grey'],
]
const dialogOpen = ref(false)
const confirmOpen = ref(false)
const sampleSelect = ref('kind')
// The preview of a referenced record (#236), in each of its states
const previewState = ref<'ready' | 'loading' | 'failed'>('ready')
const previewOpen = ref(false)
function openPreview(state: 'ready' | 'loading' | 'failed') {
  previewState.value = state
  previewOpen.value = true
}
const PREVIEW_STATES = [
  ['ready', 'ui.devUi.openPreview'],
  ['loading', 'ui.devUi.openPreviewLoading'],
  ['failed', 'ui.devUi.openPreviewFailed'],
] as const
function sampleDialog(name: string) {
  if (name === 'confirm') confirmOpen.value = true
  else dialogOpen.value = true
}
</script>

<template>
  <AppLayout>
    <Head :title="t('ui.devUi.title')" />
    <div class="flex max-w-5xl flex-col gap-6 p-6 pb-24 font-sans text-foreground md:p-10">
      <header class="flex flex-col gap-2">
        <h1 class="m-0 text-2xl font-semibold">{{ t('ui.devUi.title') }}</h1>
        <p :class="caption">{{ t('ui.devUi.intro') }}</p>
      </header>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.logo') }}</h2>
        <div class="flex flex-wrap items-end gap-6">
          <figure class="m-0 flex flex-col gap-2">
            <div class="rounded-sm border border-border bg-card p-4 text-foreground">
              <LogoMark class="h-[26px] w-11" />
            </div>
            <figcaption :class="caption">{{ t('ui.devUi.onSurface') }}</figcaption>
          </figure>
          <figure class="m-0 flex flex-col gap-2">
            <div :class="frame">
              <Logo />
            </div>
            <figcaption :class="caption">{{ t('ui.devUi.onFrame') }}</figcaption>
          </figure>
          <figure class="m-0 flex flex-col gap-2">
            <div :class="frame">
              <Logo stacked />
            </div>
            <figcaption :class="caption">{{ t('ui.devUi.stacked') }}</figcaption>
          </figure>
        </div>
      </section>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.menuItems') }}</h2>
        <div class="flex flex-wrap items-start gap-6">
          <figure class="m-0 flex w-[236px] flex-col gap-2">
            <div :class="frame">
              <a href="#" :class="sidebarItemClass(false)">{{ t('ui.devUi.inactive') }}</a>
              <a href="#" aria-current="page" :class="sidebarItemClass(false)">
                {{ t('ui.devUi.active') }}
              </a>
            </div>
            <figcaption :class="caption">{{ t('ui.devUi.sidebar') }}</figcaption>
          </figure>
          <figure class="m-0 flex w-[312px] flex-col gap-2">
            <div :class="frame">
              <a href="#" :class="sidebarItemClass(true)">{{ t('ui.devUi.inactive') }}</a>
              <a href="#" aria-current="page" :class="sidebarItemClass(true)">
                {{ t('ui.devUi.active') }}
              </a>
            </div>
            <figcaption :class="caption">{{ t('ui.devUi.drawer') }}</figcaption>
          </figure>
          <figure class="m-0 flex w-16 flex-col gap-2">
            <!-- The folded look, fixed here whatever the screen size -->
            <div :class="[frame, 'px-2']">
              <a
                href="#"
                :title="t('ui.devUi.inactive')"
                :class="cn(sidebarItemClass(false), 'justify-center px-0')"
              >
                <Briefcase :size="18" aria-hidden="true" />
                <span class="sr-only">{{ t('ui.devUi.inactive') }}</span>
              </a>
              <a
                href="#"
                aria-current="page"
                :title="t('ui.devUi.active')"
                :class="
                  cn(
                    sidebarItemClass(false),
                    'justify-center px-0 aria-[current=page]:after:right-1'
                  )
                "
              >
                <Briefcase :size="18" aria-hidden="true" />
                <span class="sr-only">{{ t('ui.devUi.active') }}</span>
              </a>
            </div>
            <figcaption :class="caption">{{ t('ui.devUi.folded') }}</figcaption>
          </figure>
        </div>
      </section>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.buttons') }}</h2>
        <div class="flex flex-wrap items-start gap-6">
          <figure class="m-0 flex flex-col gap-2">
            <div :class="[frame, 'flex-row items-center gap-1.5']">
              <ThemeToggle :class="sidebarIconButtonClass(false)" />
              <button type="button" :class="sidebarIconButtonClass(false)">
                <LogOut :size="16" aria-hidden="true" />
                <span class="sr-only">{{ t('ui.common.logout') }}</span>
              </button>
            </div>
            <figcaption :class="caption">{{ t('ui.devUi.sidebar') }}</figcaption>
          </figure>
          <figure class="m-0 flex flex-col gap-2">
            <div :class="[frame, 'flex-row items-center gap-1.5']">
              <ThemeToggle :class="sidebarIconButtonClass(true)" />
              <button type="button" :class="sidebarIconButtonClass(true)">
                <LogOut :size="16" aria-hidden="true" />
                <span class="sr-only">{{ t('ui.common.logout') }}</span>
              </button>
              <button type="button" :class="BAR_BUTTON" :aria-label="t('ui.shell.openMenu')">
                <Menu :size="22" aria-hidden="true" />
              </button>
              <button type="button" :class="BAR_BUTTON" :aria-label="t('ui.shell.closeMenu')">
                <X :size="22" aria-hidden="true" />
              </button>
            </div>
            <figcaption :class="caption">{{ t('ui.devUi.drawer') }}</figcaption>
          </figure>
        </div>
      </section>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.controls') }}</h2>
        <div
          v-for="size in BUTTON_SIZES"
          :key="size"
          class="flex flex-wrap items-center gap-3 rounded-sm border border-border bg-card p-4"
        >
          <Button
            v-for="[variant, label] in BUTTON_VARIANTS"
            :key="variant"
            :variant="variant"
            :size="size"
          >
            {{ t(label) }}
          </Button>
          <Button :size="size" disabled>{{ t('ui.devUi.button.disabled') }}</Button>
          <Button variant="outline" :size="size === 'touch' ? 'icon-touch' : 'icon'">
            <Plus aria-hidden="true" />
            <span class="sr-only">{{ t('ui.devUi.button.icon') }}</span>
          </Button>
          <span :class="caption">{{ size }}</span>
        </div>
        <div class="grid gap-4 rounded-sm border border-border bg-card p-4 md:grid-cols-2">
          <div class="flex flex-col gap-1.5">
            <Label for="gallery-empty">{{ t('ui.devUi.field.label') }}</Label>
            <Input id="gallery-empty" :placeholder="t('ui.devUi.field.placeholder')" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="gallery-filled">{{ t('ui.devUi.field.label') }}</Label>
            <Input id="gallery-filled" :default-value="t('ui.devUi.field.value')" />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="gallery-disabled">{{ t('ui.devUi.field.disabled') }}</Label>
            <Input id="gallery-disabled" :default-value="t('ui.devUi.field.value')" disabled />
          </div>
          <div class="flex flex-col gap-1.5">
            <Label for="gallery-textarea">{{ t('ui.devUi.field.label') }}</Label>
            <Textarea id="gallery-textarea" :default-value="t('ui.devUi.sectionText')" rows="2" />
          </div>
          <AuthField
            name="gallery-invalid"
            type="text"
            autocomplete="off"
            :label="t('ui.devUi.field.touch')"
            :error="t('ui.devUi.field.error')"
          />
        </div>
      </section>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.sheet') }}</h2>
        <div class="flex flex-wrap items-start gap-6">
          <Sheet>
            <SheetTrigger :class="buttonVariants({ variant: 'outline' })">
              {{ t('ui.devUi.openSheet') }}
            </SheetTrigger>
            <SheetContent side="right" :close-label="t('ui.shell.closeMenu')">
              <SheetHeader>
                <SheetTitle>{{ t('ui.devUi.sheet') }}</SheetTitle>
                <SheetDescription>{{ t('ui.devUi.sheetText') }}</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
          <figure class="m-0 flex w-[312px] flex-col gap-2">
            <!-- The phone menu as it shows in its drawer -->
            <div class="h-[760px] overflow-y-auto rounded-sm bg-sidebar shadow-drawer">
              <AppSidebar drawer />
            </div>
            <figcaption :class="caption">{{ t('ui.devUi.drawer') }}</figcaption>
          </figure>
        </div>
      </section>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.statusTags') }}</h2>
        <div class="flex flex-wrap gap-2 rounded-sm border border-border bg-card p-4">
          <StatusTag v-for="[tone, label] in TONES" :key="tone" :tone="tone">
            {{ t(label) }}
          </StatusTag>
        </div>
      </section>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.screen') }}</h2>
        <p :class="caption">{{ t('ui.devUi.screenIntro') }}</p>
        <!-- As on a screen: header, key facts, sections -->
        <div class="flex flex-col overflow-hidden rounded-sm border border-border bg-background">
          <ScreenHeader
            :crumbs="[{ label: t('ui.devUi.sampleParent'), href: '/dev/ui' }]"
            :current="t('ui.devUi.sampleCurrent')"
            :title="t('ui.devUi.sampleTitle')"
            :facts="t('ui.devUi.sampleFacts')"
            :actions="sampleActions"
            @dialog="sampleDialog"
          >
            <template #tags>
              <StatusTag tone="orange">{{ t('ui.devUi.tones.orange') }}</StatusTag>
            </template>
          </ScreenHeader>
          <div class="flex flex-col gap-3 p-3.5 md:gap-5 md:p-5">
            <KeyFacts :facts="sampleFacts" />
            <ScreenSection :title="t('ui.devUi.section')">
              <template #actions>
                <Button variant="outline" class="h-11 md:h-9" @click="dialogOpen = true">
                  {{ t('ui.devUi.sectionAction') }}
                </Button>
              </template>
              <p class="m-0 text-sm">{{ t('ui.devUi.sectionText') }}</p>
            </ScreenSection>
          </div>
        </div>
      </section>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.rows') }}</h2>
        <p :class="caption">{{ t('ui.devUi.rowsIntro') }}</p>
        <div class="grid items-start gap-5 md:grid-cols-[2fr_1fr]">
          <ScreenSection :title="t('ui.jobs.title')" flush>
            <JobRows :jobs="sampleJobs" :total="12" all-href="/dev/ui" show-site />
          </ScreenSection>
          <div class="flex flex-col gap-5">
            <ScreenSection :title="t('ui.issuedDocuments.title')" flush>
              <IssuedDocumentRows :documents="sampleDocuments" :show-customer="false" />
            </ScreenSection>
            <ScreenSection :title="t('ui.issuedDocuments.title')" flush>
              <IssuedDocumentRows :documents="[]" />
            </ScreenSection>
          </div>
        </div>
      </section>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.pickers') }}</h2>
        <div class="grid gap-4 rounded-sm border border-border bg-card p-4 md:grid-cols-2">
          <SitePicker />
          <ItemPicker />
        </div>
      </section>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.dialog') }}</h2>
        <div class="flex flex-wrap gap-3">
          <Button variant="outline" @click="dialogOpen = true">
            {{ t('ui.devUi.openDialog') }}
          </Button>
          <Button variant="outline" @click="confirmOpen = true">
            {{ t('ui.devUi.openConfirm') }}
          </Button>
        </div>
        <div class="grid gap-4 rounded-sm border border-border bg-card p-4 md:grid-cols-2">
          <FormField
            id="gallery-select"
            v-slot="field"
            :label="t('ui.invoices.organiseBy')"
            :hint="t('ui.devUi.dialogText')"
          >
            <NativeSelect
              :id="field.id"
              v-model="sampleSelect"
              :aria-describedby="field.describedBy"
            >
              <option v-for="option in ORGANISE_BY" :key="option" :value="option">
                {{ t(`ui.invoices.organiseOptions.${option}`) }}
              </option>
            </NativeSelect>
          </FormField>
          <FormField
            id="gallery-field-error"
            v-slot="field"
            :label="t('ui.devUi.field.label')"
            :error="t('ui.devUi.field.error')"
          >
            <Input
              :id="field.id"
              class="h-11 md:h-9"
              :aria-invalid="field.invalid"
              :aria-describedby="field.describedBy"
            />
          </FormField>
        </div>
        <Dialog v-model:open="dialogOpen">
          <DialogContent :close-label="t('ui.screen.closeDialog')">
            <DialogTitle>{{ t('ui.devUi.dialog') }}</DialogTitle>
            <DialogDescription>{{ t('ui.devUi.dialogText') }}</DialogDescription>
            <DialogFooter>
              <Button variant="outline" class="h-11 md:h-9" @click="dialogOpen = false">
                {{ t('ui.screen.goBack') }}
              </Button>
              <Button class="h-11 md:h-9" @click="dialogOpen = false">
                {{ t('ui.devUi.confirm') }}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <ConfirmDialog
          v-model:open="confirmOpen"
          :title="t('ui.devUi.action.destructive')"
          :description="t('ui.devUi.confirmText')"
          :confirm-label="t('ui.devUi.action.destructive')"
        />
      </section>

      <section :class="section">
        <h2 :class="heading">{{ t('ui.devUi.preview') }}</h2>
        <p :class="caption">{{ t('ui.devUi.previewIntro') }}</p>
        <div class="flex flex-wrap gap-3">
          <Button
            v-for="[state, label] in PREVIEW_STATES"
            :key="state"
            variant="outline"
            aria-haspopup="dialog"
            @click="openPreview(state)"
          >
            {{ t(label) }}
          </Button>
        </div>
        <RecordPreview
          v-model:open="previewOpen"
          :kind="t('ui.items.itemSection')"
          :title="previewState === 'loading' ? undefined : t('ui.devUi.sampleItem')"
          :subtitle="previewState === 'loading' ? undefined : t('ui.devUi.sampleItemLine')"
          href="/dev/ui"
          :state="previewState"
          :facts="[
            { label: t('ui.items.stock'), value: t('ui.devUi.sampleStock') },
            { label: t('ui.items.available'), value: t('ui.devUi.sampleAvailable') },
          ]"
        />
      </section>
    </div>
  </AppLayout>
</template>
