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
            <span class="dot" /> 403
          </span>
        </div>
        <div class="pc-lead">
          <span>{{ t('ui.errors.forbiddenTitle') }}</span>
          <em>{{ t('ui.errors.forbiddenLead') }}</em>
        </div>
        <p class="pc-para">{{ t('ui.errors.forbiddenText') }}</p>
      </article>
    </div>
  </PlainLayout>
</template>
