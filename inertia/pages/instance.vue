<script setup lang="ts">
import { Server } from 'lucide-vue-next'
import Page from '~/components/page.vue'
import AppLayout from '~/layouts/app.vue'
</script>

<template>
  <AppLayout>
    <Page title="Instance" hide-title>
      <div class="empty">
        <div class="empty__mark">
          <Server :size="22" />
        </div>
        <h1>Instance settings</h1>
        <p>
          SDI mode, backups, the public URL and updates will be managed here. As the Superuser you
          don't have access to business data.
        </p>
      </div>
    </Page>
  </AppLayout>
</template>
