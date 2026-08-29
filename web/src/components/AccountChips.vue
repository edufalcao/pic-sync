<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();

const whatsappConnected = ref(false);
const googleConnected = ref(false);
const pendingScope = ref<"whatsapp" | "google" | "all" | null>(null);
const working = ref(false);

const showBar = computed(() => whatsappConnected.value || googleConnected.value);

const modalTitle = computed(() =>
  pendingScope.value === "all"
    ? "Log out?"
    : pendingScope.value === "whatsapp"
      ? "Disconnect WhatsApp?"
      : "Disconnect Google?"
);

const modalText = computed(() => {
  switch (pendingScope.value) {
    case "whatsapp":
      return "Your WhatsApp session will be removed from this app and you'll need to scan the QR code again to reconnect.";
    case "google":
      return "Access to your Google Contacts will be revoked and you'll need to authorize again to sync.";
    default:
      return "Both accounts will be disconnected and all stored sessions will be deleted.";
  }
});

onMounted(async () => {
  try {
    const res = await fetch("/api/status", { credentials: "include" });
    const status = await res.json();
    whatsappConnected.value = status.whatsappConnected;
    googleConnected.value = status.googleConnected;
  } catch {}
});

async function confirmLogout(): Promise<void> {
  const scope = pendingScope.value;
  pendingScope.value = null;
  if (!scope) return;

  working.value = true;
  try {
    await fetch("/api/logout", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
  } catch {
    // Even on failure, update the UI — the router guard will re-check /status.
  } finally {
    working.value = false;
    if (scope === "whatsapp") whatsappConnected.value = false;
    if (scope === "google") googleConnected.value = false;
    if (scope === "all") {
      whatsappConnected.value = false;
      googleConnected.value = false;
    }
    router.push("/");
  }
}
</script>

<template>
  <div v-if="showBar" class="mt-4 flex items-center justify-center gap-2 flex-wrap">
    <div
      v-if="whatsappConnected"
      class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-base-100 border border-white/[0.06] text-xs text-base-content/50"
    >
      <span class="w-1.5 h-1.5 rounded-full bg-success"></span>
      WhatsApp
      <button
        class="text-base-content/30 hover:text-error transition-colors duration-200 text-sm leading-none"
        :disabled="working"
        aria-label="Disconnect WhatsApp"
        @click="pendingScope = 'whatsapp'"
      >
        ×
      </button>
    </div>

    <div
      v-if="googleConnected"
      class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-base-100 border border-white/[0.06] text-xs text-base-content/50"
    >
      <span class="w-1.5 h-1.5 rounded-full bg-success"></span>
      Google
      <button
        class="text-base-content/30 hover:text-error transition-colors duration-200 text-sm leading-none"
        :disabled="working"
        aria-label="Disconnect Google"
        @click="pendingScope = 'google'"
      >
        ×
      </button>
    </div>

    <button
      class="text-xs text-base-content/30 hover:text-base-content/60 transition-colors duration-200 hover:underline underline-offset-2"
      :disabled="working"
      @click="pendingScope = 'all'"
    >
      Log out
    </button>
  </div>

  <!-- Confirmation modal -->
  <div
    v-if="pendingScope"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
    @click.self="pendingScope = null"
  >
    <div class="max-w-sm w-full bg-base-100 rounded-2xl border border-white/[0.06] shadow-xl shadow-black/40 p-6">
      <h3 class="text-lg font-semibold tracking-tight text-base-content">
        {{ modalTitle }}
      </h3>
      <p class="mt-2 text-sm text-base-content/60 leading-relaxed">
        {{ modalText }}
      </p>
      <div class="mt-5 flex gap-3 justify-end">
        <button class="btn btn-sm btn-ghost text-base-content/60" @click="pendingScope = null">
          Cancel
        </button>
        <button class="btn btn-sm btn-error" @click="confirmLogout">
          Disconnect
        </button>
      </div>
    </div>
  </div>
</template>
