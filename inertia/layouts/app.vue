<script setup lang="ts">
import { t } from '~/i18n'
import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'
import {
  Boxes,
  Briefcase,
  Building2,
  CalendarDays,
  Contact,
  House,
  LogOut,
  MapPin,
  Package,
  Server,
  Users,
} from 'lucide-vue-next'
import { Form } from '@adonisjs/inertia/vue'
import Logo from '~/components/logo.vue'
import FlashToasts from '~/components/flash_toasts.vue'
import ThemeToggle from '~/components/theme_toggle.vue'
import NavLink, { type NavItem } from '~/components/nav_link.vue'

/**
 * Top-level app navigation, per role. The server enforces access; this
 * only hides links a role can't use.
 */
const navByRole: Record<string, NavItem[]> = {
  superuser: [{ label: t('ui.nav.instance'), route: 'instance', icon: Server }],
  admin: [
    { label: t('ui.nav.dashboard'), route: 'dashboard', icon: House },
    { label: t('ui.nav.jobs'), route: 'jobs.index', icon: Briefcase },
    { label: t('ui.nav.schedule'), route: 'visits.schedule', icon: CalendarDays },
    { label: t('ui.nav.customers'), route: 'customers.index', icon: Contact },
    { label: t('ui.nav.sites'), route: 'sites.index', icon: MapPin },
    { label: t('ui.nav.items'), route: 'items.index', icon: Package },
    { label: t('ui.nav.stock'), route: 'stock.index', icon: Boxes },
    { label: t('ui.nav.users'), route: 'users.index', icon: Users },
    { label: t('ui.nav.settings'), route: 'company_settings.edit', icon: Building2 },
  ],
  office: [
    { label: t('ui.nav.dashboard'), route: 'dashboard', icon: House },
    { label: t('ui.nav.jobs'), route: 'jobs.index', icon: Briefcase },
    { label: t('ui.nav.schedule'), route: 'visits.schedule', icon: CalendarDays },
    { label: t('ui.nav.customers'), route: 'customers.index', icon: Contact },
    { label: t('ui.nav.sites'), route: 'sites.index', icon: MapPin },
    { label: t('ui.nav.items'), route: 'items.index', icon: Package },
    { label: t('ui.nav.stock'), route: 'stock.index', icon: Boxes },
  ],
  technician: [{ label: t('ui.nav.dashboard'), route: 'dashboard', icon: House }],
}

const page = usePage()
const nav = computed(() => navByRole[page.props.user?.role ?? ''] ?? [])
</script>

<template>
  <header class="header header--bar">
    <div class="header__inner">
      <Logo :size="28" />
      <div class="header__right">
        <ThemeToggle />
        <Form route="session.destroy">
          <button type="submit" class="btn btn--secondary btn--sm">
            <LogOut :size="15" /> {{ t('ui.common.logout') }}
          </button>
        </Form>
      </div>
    </div>
  </header>

  <nav class="subnav">
    <div class="subnav__inner">
      <NavLink v-for="item in nav" :key="item.label" :route="item.route" class="subnav__item">
        <component :is="item.icon" v-if="item.icon" :size="14" />
        {{ item.label }}
      </NavLink>
    </div>
  </nav>

  <div class="app-main">
    <slot />
  </div>
  <FlashToasts />
</template>
