<script setup lang="ts">
/**
 * Previous / next links for a paginated list, keeping the other query
 * string parameters (such as a search term).
 */
import { computed } from 'vue'
import { t } from '~/i18n'
import { usePage } from '@inertiajs/vue3'
// The links keep the current URL and only change ?page=, so there is no route name to pass
// eslint-disable-next-line @adonisjs/prefer-adonisjs-inertia-link
import { Link } from '@inertiajs/vue3'

const props = defineProps<{ currentPage: number; lastPage: number; total: number }>()

const page = usePage()

function pageUrl(number: number) {
  const [path, query = ''] = page.url.split('?')
  const params = new URLSearchParams(query)
  params.set('page', String(number))
  return `${path}?${params.toString()}`
}

const previous = computed(() => (props.currentPage > 1 ? pageUrl(props.currentPage - 1) : null))
const next = computed(() =>
  props.currentPage < props.lastPage ? pageUrl(props.currentPage + 1) : null
)
</script>

<template>
  <nav
    v-if="lastPage > 1"
    :aria-label="t('ui.common.paginationLabel')"
    :style="{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '16px' }"
  >
    <Link v-if="previous" :href="previous" class="btn btn--secondary btn--sm">{{
      t('ui.common.previous')
    }}</Link>
    <span :style="{ color: 'var(--subtle)', fontSize: '13px' }">
      {{ t('ui.common.pagination', { current: currentPage, last: lastPage, total }) }}
    </span>
    <Link v-if="next" :href="next" class="btn btn--secondary btn--sm">{{
      t('ui.common.next')
    }}</Link>
  </nav>
</template>
