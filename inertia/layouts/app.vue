<script setup lang="ts">
import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { House, LogOut, Server, Users } from 'lucide-vue-next'
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
  superuser: [{ label: 'Instance', route: 'instance', icon: Server }],
  admin: [
    { label: 'Dashboard', route: 'dashboard', icon: House },
    { label: 'Users', route: 'users.index', icon: Users },
  ],
  office: [{ label: 'Dashboard', route: 'dashboard', icon: House }],
  technician: [{ label: 'Dashboard', route: 'dashboard', icon: House }],
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
            <LogOut :size="15" /> Log out
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
