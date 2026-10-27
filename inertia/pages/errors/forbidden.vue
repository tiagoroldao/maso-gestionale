<script setup lang="ts">
import PlainLayout from '~/layouts/plain.vue'
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
          <span>Not allowed.</span>
          <em>Your role can't open this page.</em>
        </div>
        <p class="pc-para">Ask an Admin if you think you should have access.</p>
      </article>
    </div>
  </PlainLayout>
</template>
