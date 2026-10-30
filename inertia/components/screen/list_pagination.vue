<script setup lang="ts">
/**
 * Previous / next links under a paginated list, keeping the other query
 * string parameters (such as a search term). A page past the last (an old
 * link, or rows gone since) offers the way back to the last page.
 */
import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'
// The links keep the current URL and only change ?page=, so there is no route name to pass
// eslint-disable-next-line @adonisjs/prefer-adonisjs-inertia-link
import { Link } from '@inertiajs/vue3'
import { t } from '~/i18n'
import { cn } from '~/lib/utils'
import { buttonVariants } from '~/components/ui/button'
import { TOUCH } from './screen'

export type PaginationProps = { currentPage: number; lastPage: number; total: number }

const props = defineProps<PaginationProps>()

const page = usePage()

function pageUrl(number: number) {
  const [path, query = ''] = page.url.split('?')
  const params = new URLSearchParams(query)
  params.set('page', String(number))
  return `${path}?${params.toString()}`
}

const pastTheLast = computed(() => props.currentPage > props.lastPage)
const previous = computed(() =>
  props.currentPage > 1 && !pastTheLast.value ? pageUrl(props.currentPage - 1) : null
)
const next = computed(() =>
  props.currentPage < props.lastPage ? pageUrl(props.currentPage + 1) : null
)
const BUTTON = cn(buttonVariants({ variant: 'outline' }), TOUCH)
</script>

<template>
  <nav
    v-if="lastPage > 1 || pastTheLast"
    :aria-label="t('ui.common.paginationLabel')"
    class="flex flex-wrap items-center gap-2 font-sans text-foreground"
  >
    <Link v-if="pastTheLast" :href="pageUrl(lastPage)" :class="BUTTON">
      {{ t('ui.common.backToLastPage') }}
    </Link>
    <Link v-if="previous" :href="previous" :class="BUTTON">{{ t('ui.common.previous') }}</Link>
    <span v-if="!pastTheLast" class="text-[13px] text-muted-foreground">
      {{ t('ui.common.pagination', { current: currentPage, last: lastPage, total }) }}
    </span>
    <Link v-if="next" :href="next" :class="BUTTON">{{ t('ui.common.next') }}</Link>
  </nav>
</template>
