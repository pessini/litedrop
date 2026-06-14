<script setup lang="ts">
import { useRouter } from "vue-router";
import Icon from "./components/Icon.vue";
import { auth } from "./stores/auth";
import { theme, toggleTheme } from "./stores/theme";
import { toastMessage } from "./stores/toast";

const router = useRouter();

async function logout() {
  await auth.logout();
  router.push({ name: "login" });
}
</script>

<template>
  <header v-if="auth.isAuthenticated.value" class="topbar">
    <router-link to="/" class="brand">litedrop</router-link>
    <nav class="nav">
      <router-link to="/" class="navlink" active-class="" exact-active-class="navlink-active">
        Shares
      </router-link>
    </nav>
    <span class="spacer" />
    <button class="navlink" @click="logout">Log out</button>
    <button
      class="navlink navlink-icon"
      type="button"
      :title="theme === 'dark' ? 'Switch to light' : 'Switch to dark'"
      :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
      @click="toggleTheme"
    >
      <Icon :name="theme === 'dark' ? 'sun' : 'moon'" />
    </button>
  </header>

  <router-view />

  <div v-if="toastMessage" class="toast">{{ toastMessage }}</div>
</template>
