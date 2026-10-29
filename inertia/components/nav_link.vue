<script lang="ts">
import { type Component } from 'vue'
import { urlFor } from '~/client'

export type NavRoute = Parameters<typeof urlFor>[0]

export type NavItem = {
  label: string
  route: NavRoute
  icon?: Component
}
</script>

<script setup lang="ts">
/**
 * A link that marks itself with `aria-current="page"` when the current URL
 * matches its route. By default nested URLs count as a match, so a
 * "Settings" link stays active on "/settings/security". Pass `exact` to
 * only match the route itself, or `section` to match a wider path prefix
 * than the route's own.
 */
import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'

const props = withDefaults(defineProps<{ route: NavRoute; exact?: boolean; section?: string }>(), {
  exact: false,
  section: undefined,
})

const page = usePage()
const href = computed(() => urlFor(props.route))
const isActive = computed(() => {
  const path = page.url.split('?')[0]
  const within = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`)
  if (props.section && within(props.section)) return true
  return props.exact ? path === href.value : within(href.value)
})
</script>

<template>
  <Link :href="href" :aria-current="isActive ? 'page' : undefined">
    <slot />
  </Link>
</template>
