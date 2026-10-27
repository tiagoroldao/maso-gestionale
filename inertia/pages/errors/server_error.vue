<script setup lang="ts">
import PlainLayout from '~/layouts/plain.vue'
import { t } from '~/i18n'
</script>

<template>
  <PlainLayout>
    <div class="home">
      <article class="prose-card">
        <div class="pc-top">
          <span class="pc-status mono tag" :style="{ color: '#c0392b' }">
            <span class="dot" /> 500
          </span>
        </div>
        <div class="pc-lead">
          <span>{{ t('ui.errors.serverErrorTitle') }}</span>
          <em>{{ t('ui.errors.serverErrorLead') }}</em>
        </div>
        <p class="pc-para">{{ t('ui.errors.serverErrorText') }}</p>
      </article>
    </div>
  </PlainLayout>
</template>
