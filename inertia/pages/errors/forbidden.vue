<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
import { t } from '~/i18n'
import PlainLayout from '~/layouts/plain.vue'
import ErrorCard from '~/components/error_card.vue'
</script>

<template>
  <PlainLayout>
    <ErrorCard
      :code="403"
      :icon="Lock"
      :title="t('ui.errors.forbiddenTitle')"
      :lead="t('ui.errors.forbiddenLead')"
      :text="t('ui.errors.forbiddenText')"
    />
  </PlainLayout>
</template>
