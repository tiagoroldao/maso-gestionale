<script setup lang="ts">
import { TriangleAlert } from 'lucide-vue-next'
import { t } from '~/i18n'
import PlainLayout from '~/layouts/plain.vue'
import ErrorCard from '~/components/error_card.vue'
</script>

<template>
  <PlainLayout>
    <ErrorCard
      :code="500"
      :icon="TriangleAlert"
      :title="t('ui.errors.serverErrorTitle')"
      :lead="t('ui.errors.serverErrorLead')"
      :text="t('ui.errors.serverErrorText')"
    />
  </PlainLayout>
</template>
