<script setup lang="ts">
/**
 * The component gallery (#252), development only: each component of the
 * new UI in its states, so one screenshot reviews the kit
 * (`npm run ui:shots -- /dev/ui`, light and dark). Add a component here
 * when it joins the kit.
 */
import { Head } from '@inertiajs/vue3'
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
const BUTTON_VARIANTS: NonNullable<ButtonVariants['variant']>[] = ['default', 'outline', 'ghost']
const BUTTON_SIZES: NonNullable<ButtonVariants['size']>[] = ['default', 'sm', 'touch']
const frame = 'flex flex-col gap-1 rounded-sm bg-sidebar p-3.5 font-sans text-sidebar-foreground'
</script>

<template>
  <AppLayout>
    <Head :title="t('ui.devUi.title')" />
    <div class="flex max-w-5xl flex-col gap-6 p-6 font-sans text-foreground md:p-10">
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
          <Button v-for="variant in BUTTON_VARIANTS" :key="variant" :variant="variant" :size="size">
            {{ t(`ui.devUi.button.${variant}`) }}
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
    </div>
  </AppLayout>
</template>
