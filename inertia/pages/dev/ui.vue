<script setup lang="ts">
/**
 * The component gallery (#252), development only: each component of the
 * new UI in its states, so one screenshot reviews the kit
 * (`npm run ui:shots -- /dev/ui`, light and dark). Add a component here
 * when it joins the kit.
 */
import { Head } from '@inertiajs/vue3'
import { Briefcase, LogOut, Menu, X } from 'lucide-vue-next'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import AppLayout from '~/layouts/app.vue'
import AppSidebar from '~/components/app_sidebar.vue'
import LogoMark from '~/components/logo_mark.vue'
import ThemeToggle from '~/components/theme_toggle.vue'
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
            <div :class="[frame, 'text-white']">
              <LogoMark class="h-[26px] w-11" cut-class="fill-sidebar-brand" />
              <span
                class="font-display text-[10px] font-semibold tracking-[0.24em] whitespace-nowrap uppercase"
              >
                {{ t('ui.shell.wordmark') }}
              </span>
            </div>
            <figcaption :class="caption">{{ t('ui.devUi.onFrame') }}</figcaption>
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
        <h2 :class="heading">{{ t('ui.devUi.sheet') }}</h2>
        <div class="flex flex-wrap items-start gap-6">
          <Sheet>
            <SheetTrigger
              class="h-9 rounded-sm border border-border bg-card px-3 text-sm text-foreground hover:bg-background"
            >
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
