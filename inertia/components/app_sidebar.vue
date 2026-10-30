<script setup lang="ts">
/**
 * The black sidebar (docs/ui.md "Menu"): the logo, the role's menu grouped
 * by area, and the user. On desktop it sits on the left, folded to icons
 * at tablet widths; on the phone the same sidebar opens as a drawer
 * (`drawer`), roomier, with search and a close button (the `close` slot).
 */
import { computed, type Component } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { Form, Link } from '@adonisjs/inertia/vue'
import {
  Boxes,
  Briefcase,
  Building2,
  CalendarDays,
  Contact,
  FileText,
  House,
  Inbox,
  LogOut,
  MapPin,
  Package,
  Search,
  Server,
  Truck,
  Users,
} from 'lucide-vue-next'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import { menuFor } from '@shared/menu'
import LogoMark from '~/components/logo_mark.vue'
import ThemeToggle from '~/components/theme_toggle.vue'
import NavLink, { type NavRoute } from '~/components/nav_link.vue'
import { roleLabel } from '~/components/role_label'
import { sidebarIconButtonClass, sidebarItemClass } from '~/components/shell_classes'

const props = withDefaults(defineProps<{ drawer?: boolean }>(), { drawer: false })
const emit = defineEmits<{ navigate: [] }>()

/** Shown in place of the name when the sidebar is folded to icons */
const ICONS: Record<string, Component> = {
  'dashboard': House,
  'jobs.index': Briefcase,
  'visits.schedule': CalendarDays,
  'my_visits.index': CalendarDays,
  'invoices.index': FileText,
  'supplier_invoices.index': Inbox,
  'items.index': Package,
  'stock.index': Boxes,
  'suppliers.index': Truck,
  'customers.index': Contact,
  'sites.index': MapPin,
  'company_settings.edit': Building2,
  'users.index': Users,
  'instance': Server,
}

const page = usePage()
const user = computed(() => page.props.user)
const groups = computed(() => menuFor(user.value?.role))

/** Hidden while folded (tablet), kept for screen readers; never folded in the drawer */
const folded = computed(() => (props.drawer ? '' : 'md:max-lg:sr-only'))

const itemClass = computed(() => sidebarItemClass(props.drawer))
const iconButton = computed(() => sidebarIconButtonClass(props.drawer))
</script>

<template>
  <div
    :class="
      cn(
        'flex min-h-full flex-col bg-sidebar font-sans text-sidebar-foreground tabular-nums',
        drawer ? 'gap-[18px] px-3.5 pt-1 pb-4' : 'gap-[22px] px-3.5 py-5 md:max-lg:px-2'
      )
    "
  >
    <div :class="cn('flex items-center justify-between', drawer ? 'pl-2.5' : '')">
      <Link
        href="/"
        :class="
          cn(
            'flex flex-col gap-2 rounded-sm text-white outline-none focus-visible:ring-2 focus-visible:ring-sidebar-brand',
            drawer ? 'py-2.5' : 'px-3 pt-1 pb-2.5 md:max-lg:items-center md:max-lg:px-0'
          )
        "
        @click="emit('navigate')"
      >
        <LogoMark
          :class="drawer ? 'h-6 w-10' : 'h-[26px] w-11 md:max-lg:h-5 md:max-lg:w-[34px]'"
          cut-class="fill-sidebar-brand"
        />
        <span
          :class="
            cn(
              'font-display text-[10px] font-semibold tracking-[0.24em] whitespace-nowrap uppercase',
              drawer ? 'sr-only' : folded
            )
          "
        >
          {{ t('ui.shell.wordmark') }}
        </span>
      </Link>
      <slot name="close" />
    </div>

    <label
      v-if="drawer"
      class="flex h-10 shrink-0 items-center gap-2 rounded-sm bg-sidebar-accent px-3 text-sm text-sidebar-muted"
      :title="t('ui.shell.searchSoon')"
    >
      <Search :size="16" aria-hidden="true" />
      <input
        type="search"
        disabled
        :aria-label="t('ui.common.search')"
        :placeholder="t('ui.shell.searchPlaceholder')"
        class="w-full border-0 bg-transparent text-white outline-none placeholder:text-sidebar-muted"
      />
    </label>

    <nav :aria-label="t('ui.shell.mainNav')" class="flex flex-col gap-[22px]">
      <div v-for="group in groups" :key="group.label" class="flex flex-col gap-0.5">
        <p
          :class="
            cn(
              'pb-1.5 font-display text-[10px] font-semibold tracking-[0.2em] text-sidebar-label uppercase',
              drawer ? 'px-3.5' : 'px-3',
              folded
            )
          "
        >
          {{ t(group.label) }}
        </p>
        <div
          v-if="!drawer"
          aria-hidden="true"
          class="mx-2 mb-1 hidden h-px bg-sidebar-border md:max-lg:block"
        />
        <NavLink
          v-for="item in group.items"
          :key="item.route"
          :route="item.route as NavRoute"
          :section="item.section"
          :title="drawer ? undefined : t(item.label)"
          :class="itemClass"
          @click="emit('navigate')"
        >
          <component
            :is="ICONS[item.route]"
            v-if="!drawer && ICONS[item.route]"
            :size="18"
            aria-hidden="true"
            class="hidden shrink-0 md:max-lg:block"
          />
          <span :class="folded">{{ t(item.label) }}</span>
        </NavLink>
      </div>
    </nav>

    <div
      v-if="user"
      :class="
        cn(
          'mt-auto flex gap-2.5 border-t border-sidebar-border text-white',
          drawer ? 'items-center p-3' : 'flex-col pt-3 md:max-lg:items-center lg:px-3'
        )
      "
    >
      <span class="flex min-w-0 flex-1 items-center gap-2.5">
        <span
          aria-hidden="true"
          :class="
            cn(
              'grid shrink-0 place-items-center rounded-sm bg-sidebar-chip text-xs font-semibold',
              drawer ? 'size-8' : 'size-7'
            )
          "
        >
          {{ user.initials }}
        </span>
        <span :class="cn('flex min-w-0 flex-1 flex-col', folded)">
          <span :class="cn('truncate font-medium', drawer ? 'text-sm' : 'text-[13px]')">
            {{ user.fullName ?? user.email }}
          </span>
          <span class="text-xs text-sidebar-muted">{{ roleLabel(user.role) }}</span>
        </span>
      </span>
      <span :class="cn('flex items-center gap-1.5', drawer ? '' : 'md:max-lg:flex-col')">
        <ThemeToggle :class="iconButton" />
        <Form route="session.destroy">
          <button type="submit" :class="iconButton" :title="t('ui.common.logout')">
            <LogOut :size="16" aria-hidden="true" />
            <span class="sr-only">{{ t('ui.common.logout') }}</span>
          </button>
        </Form>
      </span>
    </div>
  </div>
</template>
