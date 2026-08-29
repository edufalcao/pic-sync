<script setup lang="ts">
import { reactive } from "vue";
import { useRouter } from "vue-router";

import AccountChips from "../components/AccountChips.vue";

const router = useRouter();

interface Option {
  title: string;
  description: string;
  target: string;
  value: boolean;
  onChange?: (options: Option[]) => (event: Event) => void;
}

const disableOtherOptionsOnChange = (target: string) => (options: Option[]) => (event: Event) => {
  const checkbox = event.target as HTMLInputElement;
  if (checkbox.checked) {
    options.filter((o) => o.target !== target).forEach((o) => (o.value = false));
  }
};

const options = reactive<Option[]>([
  {
    title: "Manual Sync",
    description: "Compare and select each photo manually before syncing.",
    target: "manual_sync",
    value: false,
    onChange: disableOtherOptionsOnChange("manual_sync"),
  },
  {
    title: "Overwrite existing images",
    description: "Replace existing contact images with WhatsApp photos.",
    target: "overwrite_photos",
    value: false,
    onChange: disableOtherOptionsOnChange("overwrite_photos"),
  },
]);

function startSync() {
  const searchParams = new URLSearchParams();
  options.forEach((option) => {
    searchParams.set(option.target, String(option.value));
  });
  router.push(`/sync?${searchParams.toString()}`);
}
</script>

<template>
  <div class="flex-1 flex items-center justify-center px-4 py-12">
    <div class="max-w-lg w-full">
      <div class="bg-base-100 rounded-2xl border border-white/[0.06] shadow-xl shadow-black/20 p-8">
      <h1 class="text-2xl font-semibold tracking-tight text-base-content">
        Sync Options
      </h1>
      <p class="mt-2 text-sm text-base-content/60 leading-relaxed">
        Configure how your contacts will be synced.
      </p>

      <div class="mt-6 divide-y divide-white/[0.06]">
        <label
          v-for="option in options"
          :key="option.target"
          class="group flex items-center justify-between py-4 cursor-pointer"
        >
          <div class="pr-4">
            <div class="text-sm font-medium text-base-content group-hover:text-primary transition-colors duration-200">{{ option.title }}</div>
            <div class="text-xs text-base-content/50 mt-0.5">{{ option.description }}</div>
          </div>
          <input
            type="checkbox"
            v-model="option.value"
            class="toggle toggle-sm toggle-primary"
            :onChange="option.onChange?.(options)"
          />
        </label>
      </div>

      <button class="btn btn-primary w-full mt-6 h-12 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-shadow duration-300" @click="startSync()">
        Start Sync
      </button>
      </div>

      <AccountChips />
    </div>
  </div>
</template>

<style scoped></style>
