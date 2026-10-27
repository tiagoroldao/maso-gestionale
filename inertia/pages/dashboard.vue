<script setup lang="ts">
import { LayoutGrid } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import { t } from '~/i18n'
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.dashboard.title')" hide-title>
      <div class="empty">
        <div class="empty__mark">
          <LayoutGrid :size="22" />
        </div>
        <h1>{{ t('ui.dashboard.emptyTitle') }}</h1>
        <p>{{ t('ui.dashboard.emptyText') }}</p>
      </div>
    </Page>
  </AppLayout>
</template>
