<script setup lang="ts">
import PlainLayout from '~/layouts/plain.vue'
import { t } from '~/i18n'
</script>

<template>
  <PlainLayout>
    <div class="home">
      <article class="prose-card">
        <div class="pc-top">
          <span class="pc-status mono tag" :style="{ color: 'var(--subtle)' }">
            <span class="dot" /> 404
          </span>
        </div>
        <div class="pc-lead">
          <span>{{ t('ui.errors.notFoundTitle') }}</span>
          <em>{{ t('ui.errors.notFoundLead') }}</em>
        </div>
        <p class="pc-para">{{ t('ui.errors.notFoundText') }}</p>
      </article>
    </div>
  </PlainLayout>
</template>
