<script setup lang="ts">
/**
 * An error page's content (forbidden, not found, server error): the status
 * code with an icon, what happened, what to do, and the way back: the
 * dashboard when signed in, otherwise the sign-in page.
 */
import type { Component } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { Link } from '@adonisjs/inertia/vue'
import { t } from '~/i18n'

defineProps<{ code: number; icon: Component; title: string; lead: string; text: string }>()

const page = usePage()

const action =
  'mt-8 inline-flex h-11 items-center justify-center rounded-sm bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card max-md:w-full'
</script>

<template>
  <article class="w-full max-w-[560px] rounded-sm border border-border bg-card p-6 md:p-10">
    <p
      class="flex items-center gap-2 font-display text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase"
    >
      <component :is="icon" :size="16" aria-hidden="true" />
      {{ code }}
    </p>
    <h1 class="mt-4 font-display text-2xl font-bold tracking-[0.01em] text-balance md:text-[28px]">
      {{ title }}
    </h1>
    <p class="mt-2 text-lg text-foreground-2">{{ lead }}</p>
    <p class="mt-3 text-sm text-pretty text-muted-foreground">{{ text }}</p>

    <Link v-if="page.props.user" route="dashboard" :class="action">
      {{ t('ui.errors.toDashboard') }}
    </Link>
    <Link v-else route="session.create" :class="action">{{ t('ui.errors.signIn') }}</Link>
  </article>
</template>
