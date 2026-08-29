<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  methods: {
    handleAuthClick() {
      window.location.href = "/api/google_auth_start";
    },
  },
});
</script>

<template>
  <div class="flex-1 flex items-center justify-center px-4 py-12">
    <div class="max-w-lg w-full bg-base-100 rounded-2xl border border-white/[0.06] shadow-xl shadow-black/20 p-8">
      <h1 class="text-2xl font-semibold tracking-tight text-base-content">
        Authorize Google
      </h1>
      <p class="mt-2 text-sm text-base-content/60 leading-relaxed">
        Connect your Google account to allow syncing contact photos.
        We only request access to your contacts.
      </p>
      <div class="mt-6">
        <button
          @click="handleAuthClick"
          id="signin-button"
          class="btn btn-outline border-white/[0.06] bg-base-100/50 hover:bg-base-300 hover:border-primary/30 backdrop-blur-sm gap-3 w-full h-12 transition-all duration-200"
        >
          <img class="w-5" alt="Google login" src="/google_logo.svg" />
          Sign in with Google
        </button>
      </div>
      <p class="mt-4 text-xs text-base-content/40 text-center">
        Your credentials are never stored on our servers.
      </p>
    </div>
  </div>
</template>

<style scoped></style>
