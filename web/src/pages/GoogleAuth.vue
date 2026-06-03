<script setup lang="ts">
// @ts-nocheck
// This is indeed a bad solution, but the Google imports just don't play nice with Typescript...
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { event } from "vue-gtag";

const router = useRouter();

const CLIENT_ID = ref("");
const gisLoaded = ref(false);
const configLoaded = ref(false);
const tokenClient = ref<any>(undefined);

// Most code here is based on https://developers.google.com/people/quickstart/js
async function loadConfig() {
  const res = await fetch("/api/config", { credentials: "include" });
  const data = await res.json();
  CLIENT_ID.value = data.clientId;
  if (!data.clientId) {
    console.error("Google Client ID not configured on the server.");
    return;
  }
  configLoaded.value = true;
  tryInit();
}

function tryInit() {
  if (configLoaded.value && gisLoaded.value) initGis();
}

function addJSSrc(url: string, onLoad: () => void = () => {}) {
  const authScriptElement = document.createElement("script");
  authScriptElement.src = url;
  if (onLoad) {
    authScriptElement.onload = onLoad;
  }
  authScriptElement.setAttribute("async", "");
  authScriptElement.setAttribute("defer", "");
  document.head.appendChild(authScriptElement);
}

function initGis() {
  tokenClient.value = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID.value,
    scope: "https://www.googleapis.com/auth/contacts",
    callback: onSignIn,
  });
}

function handleAuthClick() {
  tokenClient.value.requestAccessToken({ prompt: "consent" });
}

async function onSignIn(resp: any) {
  if (resp.error !== undefined) {
    throw resp;
  }
  event("google_authorized", { method: "Google" });
  const token = resp;
  fetch("/api/init_gapi", {
    credentials: "include",
    method: "POST",
    body: JSON.stringify({ token: token }),
    headers: {
      "Content-Type": "application/json",
    },
  }).then((res) => {
    if (res.status === 200) {
      const url = new URL(res.url);
      router.push(url.pathname);
    } else {
      throw res;
    }
  });
}

onMounted(() => {
  loadConfig();
  addJSSrc("https://accounts.google.com/gsi/client", () => {
    gisLoaded.value = true;
    tryInit();
  });
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
          :disabled="!tokenClient"
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
