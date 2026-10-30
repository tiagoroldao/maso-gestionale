<script setup lang="ts">
import { FileQuestion } from 'lucide-vue-next'
import { t } from '~/i18n'
import PlainLayout from '~/layouts/plain.vue'
import ErrorCard from '~/components/error_card.vue'
</script>

<template>
  <PlainLayout>
    <ErrorCard
      :code="404"
      :icon="FileQuestion"
      :title="t('ui.errors.notFoundTitle')"
      :lead="t('ui.errors.notFoundLead')"
      :text="t('ui.errors.notFoundText')"
    />
  </PlainLayout>
</template>
