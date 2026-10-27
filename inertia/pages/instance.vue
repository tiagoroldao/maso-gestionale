<script setup lang="ts">
import { Server } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
import { t } from '~/i18n'
</script>

<template>
  <AppLayout>
    <Page :title="t('ui.instance.title')" hide-title>
      <div class="empty">
        <div class="empty__mark">
          <Server :size="22" />
        </div>
        <h1>{{ t('ui.instance.heading') }}</h1>
        <p>{{ t('ui.instance.text') }}</p>
      </div>
    </Page>
  </AppLayout>
</template>
