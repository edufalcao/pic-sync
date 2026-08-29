<script setup lang="ts">
import { ref, onMounted } from "vue";
import { event } from "vue-gtag";
import { EventType, SyncProgress } from "../../../interfaces/api";
import { addHandler, sendEvent } from "../services/ws";
import { enforcePayments } from "../settings";
import AccountChips from "../components/AccountChips.vue";

interface ManualSyncData {
  existingPhoto: string | null;
  newPhoto: string;
  contactName: string | null;
}

const imageDisplayedCount = 9;
const syncProgress = ref(0);
const syncCount = ref(0);
const images = ref<string[]>([]);
const totalContactsPushed = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const lastSyncReceived = ref<number | null>(null);
const showCoffeeButton = ref(true);
const isManualSync = ref<boolean | undefined>(false);
const isManualSyncLoading = ref<boolean | undefined>(false);
const manualSyncData = ref<ManualSyncData | null>(null);

function initSync() {
  fetch(`/api/init_sync${window.location.search}`, {
    credentials: "include",
  });
}

function checkServerDisconnected() {
  // Display an error message if the server has disconnected.
  errorMessage.value =
    lastSyncReceived.value &&
    syncProgress.value !== 100 &&
    Date.now() - lastSyncReceived.value > 30 * 1000
      ? "Server has disconnected. Please refresh the page and restart the process."
      : undefined;
}

function onSyncProgress(progress: SyncProgress): void {
  if (!totalContactsPushed.value) {
    event("num_contacts_synced", {
      method: "Google",
      value: progress.totalContacts,
    });
    totalContactsPushed.value = true;
  }

  lastSyncReceived.value = Date.now();
  syncProgress.value = progress.progress;
  syncCount.value = progress.syncCount;
  errorMessage.value = progress.error;
  isManualSync.value = progress.isManualSync;
  if (progress.image) {
    images.value.push(progress.image);
    if (images.value.length > imageDisplayedCount) images.value.shift();
  }
}

function onSyncConfirm(data: any): void {
  manualSyncData.value = data;
  isManualSyncLoading.value = false;
}

function onPhotoConfirm(accept: boolean): void {
  isManualSyncLoading.value = true;
  manualSyncData.value = null;
  sendEvent(EventType.SyncPhotoConfirm, { accept });
}

onMounted(() => {
  addHandler(EventType.SyncProgress, onSyncProgress);
  addHandler(EventType.SyncConfirm, onSyncConfirm);
  initSync();
  setInterval(checkServerDisconnected, 5 * 1000);
  enforcePayments.then((val) => {
    showCoffeeButton.value = val;
  });
});
</script>

<template>
  <div class="flex-1 flex items-center justify-center px-4 py-12">
    <div class="w-full max-w-lg">
      <div class="bg-base-100 rounded-2xl border border-white/[0.06] shadow-xl shadow-black/20 p-8">
        <h1 class="text-2xl font-semibold tracking-tight text-base-content">
          {{ syncProgress === 100 ? 'Sync Complete' : 'Syncing Contacts' }}
        </h1>

        <p class="mt-2 text-sm text-base-content/60 leading-relaxed" v-if="!isManualSync && syncProgress !== 100">
          Your contacts are syncing. Keep this tab open.
        </p>

        <!-- Error alert -->
        <Transition name="slide-up">
          <div
            v-if="errorMessage"
            class="flex items-center gap-2 mt-4 px-3 py-2.5 rounded-lg bg-error/10 border border-error/20 text-sm text-error"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="shrink-0 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{{ errorMessage }}</span>
          </div>
        </Transition>

        <!-- Manual sync photo comparison -->
        <div class="mt-6" v-if="isManualSync && !isManualSyncLoading">
          <div class="text-sm font-medium text-base-content mb-4">
            {{ manualSyncData?.contactName ?? "Unknown contact" }}
          </div>
          <div class="grid grid-cols-2 gap-4">
            <!-- Current photo -->
            <div class="flex flex-col items-center rounded-xl border border-white/[0.06] bg-base-100 p-4">
              <span class="text-xs text-base-content/50 mb-3">Current</span>
              <div class="avatar avatar-placeholder mb-3">
                <div class="w-20 rounded-full bg-base-200">
                  <img v-if="manualSyncData?.existingPhoto" :src="'data:image/jpeg;base64, ' + manualSyncData?.existingPhoto" alt="Current photo" />
                  <span v-if="!manualSyncData?.existingPhoto" class="text-xs text-base-content/30">None</span>
                </div>
              </div>
              <button class="btn btn-sm btn-outline border-white/[0.06] w-full" @click="onPhotoConfirm(false)">
                Keep
              </button>
            </div>
            <!-- WhatsApp photo -->
            <div class="flex flex-col items-center rounded-xl border border-primary/30 bg-primary/5 p-4">
              <span class="text-xs text-base-content/50 mb-3">WhatsApp</span>
              <div class="avatar avatar-placeholder mb-3">
                <div class="w-20 rounded-full bg-base-200">
                  <img v-if="manualSyncData?.newPhoto" :src="'data:image/jpeg;base64, ' + manualSyncData?.newPhoto" alt="WhatsApp photo" />
                  <span v-if="!manualSyncData?.newPhoto" class="text-xs text-base-content/30">None</span>
                </div>
              </div>
              <button class="btn btn-sm btn-primary w-full" @click="onPhotoConfirm(true)">
                Use This
              </button>
            </div>
          </div>
        </div>

        <!-- Manual sync loading -->
        <div class="flex flex-col items-center gap-2 my-8" v-if="isManualSync && isManualSyncLoading">
          <span class="loading loading-spinner loading-md text-primary"></span>
          <span class="text-sm text-base-content/50">Loading next contact...</span>
        </div>

        <!-- Progress bar -->
        <div class="mt-6" v-if="syncProgress < 100">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs text-base-content/40">Progress</span>
            <span class="text-xs font-medium font-mono text-base-content/60">{{ Math.round(syncProgress) }}%</span>
          </div>
          <div class="w-full bg-neutral rounded-full h-2.5 overflow-hidden">
            <div
              class="bg-primary h-2.5 rounded-full transition-all duration-500 ease-out relative"
              :style="{ width: syncProgress + '%' }"
            >
              <div class="absolute inset-0 rounded-full bg-gradient-to-r from-transparent via-white/20 to-transparent"></div>
            </div>
          </div>
        </div>

        <!-- Completion badge -->
        <div v-if="syncProgress === 100" class="mt-4">
          <div class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-success/10 border border-success/25 shadow-lg shadow-success/15 text-success text-sm font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {{ syncCount }} contacts synced
          </div>
        </div>

        <!-- Avatar group -->
        <div class="flex items-center gap-0 mt-5 -space-x-2" v-if="images.length > 0">
          <div
            v-for="(image, index) in images.slice(-imageDisplayedCount)"
            :key="index"
            class="avatar avatar-pop-in"
          >
            <div class="w-11 rounded-full ring-[3px] ring-base-100">
              <img :src="'data:image/jpeg;base64, ' + image" />
            </div>
          </div>
          <div
            v-if="syncCount >= imageDisplayedCount"
            class="avatar avatar-placeholder"
          >
            <div class="w-11 rounded-full bg-base-200 text-base-content/50 ring-[3px] ring-base-100">
              <span class="text-xs">+{{ syncCount > imageDisplayedCount ? syncCount - imageDisplayedCount : 0 }}</span>
            </div>
          </div>
        </div>
      </div>

      <AccountChips v-if="syncProgress === 100" />
    </div>
  </div>
</template>

<style scoped></style>
