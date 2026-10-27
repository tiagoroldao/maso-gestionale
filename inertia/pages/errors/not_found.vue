<script setup lang="ts">
import PlainLayout from '~/layouts/plain.vue'
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
          <span>Not found.</span>
          <em>That route hasn't been built yet.</em>
        </div>
        <p class="pc-para">
          The page you tried to reach doesn't exist. Check the URL or go back to the dashboard.
        </p>
      </article>
    </div>
  </PlainLayout>
</template>
