<script setup lang="ts">
/**
 * The app shell (ADR 0020, docs/ui.md): the black sidebar on desktop
 * (folded to icons from 768 to 1023px), and on the phone a black bar whose
 * "☰", always top right, opens the same sidebar as a drawer from the
 * right. The page renders in the content area as it did before the shell.
 */
import { ref } from 'vue'
import { Link } from '@adonisjs/inertia/vue'
import { Menu, X } from 'lucide-vue-next'
import { t } from '~/i18n'
import AppSidebar from '~/components/app_sidebar.vue'
import FlashToasts from '~/components/flash_toasts.vue'
import LogoMark from '~/components/logo_mark.vue'
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '~/components/ui/sheet'

const drawerOpen = ref(false)

const barButton =
  'grid size-11 place-items-center rounded-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-sidebar-brand'
</script>

<template>
  <div class="flex min-h-screen flex-col md:flex-row">
    <aside
      class="sticky top-0 hidden h-screen w-[236px] shrink-0 overflow-y-auto md:block md:max-lg:w-16"
    >
      <AppSidebar />
    </aside>

    <Sheet v-model:open="drawerOpen">
      <header
        class="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between bg-sidebar pr-1 pl-4 font-sans md:hidden"
      >
        <Link
          href="/"
          class="rounded-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-sidebar-brand"
        >
          <LogoMark class="h-6 w-10" cut-class="fill-sidebar-brand" />
          <span class="sr-only">{{ t('ui.shell.wordmark') }}</span>
        </Link>
        <SheetTrigger :class="barButton" :aria-label="t('ui.shell.openMenu')">
          <Menu :size="22" aria-hidden="true" />
        </SheetTrigger>
      </header>

      <SheetContent
        side="right"
        :aria-describedby="undefined"
        class="w-[312px] max-w-[85vw] gap-0 overflow-y-auto border-0 bg-sidebar shadow-[-10px_0_30px_rgba(0,0,0,0.35)] sm:max-w-[312px]"
      >
        <SheetTitle class="sr-only">{{ t('ui.shell.openMenu') }}</SheetTitle>
        <AppSidebar drawer @navigate="drawerOpen = false">
          <template #close>
            <SheetClose :class="barButton" :aria-label="t('ui.shell.closeMenu')">
              <X :size="22" aria-hidden="true" />
            </SheetClose>
          </template>
        </AppSidebar>
      </SheetContent>
    </Sheet>

    <div class="app-main min-w-0 flex-1">
      <slot />
    </div>
  </div>
  <FlashToasts />
</template>
