<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ApiError, api } from "../api/client";
import Icon from "../components/Icon.vue";
import { auth } from "../stores/auth";
import { theme, toggleTheme } from "../stores/theme";

// Single-user login: exchange the admin password for a session cookie. The
// password form is shown when the server reports password_login is enabled;
// otherwise login is disabled for this instance.

const router = useRouter();
const route = useRoute();
const password = ref("");
const error = ref<string | null>(null);
const busy = ref(false);
const passwordLogin = ref(true);

onMounted(async () => {
  try {
    const methods = await api.authMethods();
    passwordLogin.value = methods.password_login;
  } catch {
    // Method discovery is best-effort; default to showing the password form.
  }
});

function afterLogin() {
  const next = typeof route.query.next === "string" ? route.query.next : "/";
  router.push(next);
}

async function submitPassword() {
  error.value = null;
  busy.value = true;
  try {
    await auth.loginWithPassword(password.value);
    afterLogin();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "login failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="login-grid" aria-hidden />
    <div class="login-bloom" aria-hidden />

    <button
      class="theme-toggle"
      type="button"
      :title="theme === 'dark' ? 'Switch to light' : 'Switch to dark'"
      :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
      @click="toggleTheme"
    >
      <Icon :name="theme === 'dark' ? 'sun' : 'moon'" />
    </button>

    <div class="login-inner">
      <div class="login-brand">
        <img class="login-logo login-logo-light" src="/brand/logo.svg" alt="litedrop" />
        <img class="login-logo login-logo-dark" src="/brand/logo-dark.svg" alt="litedrop" />
      </div>

      <p class="login-kicker mono">$ litedrop login</p>
      <h1>Hey, you're back.</h1>
      <p class="muted login-sub">
        {{
          passwordLogin
            ? "Enter the admin password and pick up where you left off."
            : "Login is disabled for this instance."
        }}
      </p>

      <div class="card login-card">
        <div v-if="error" class="alert alert-error">{{ error }}</div>

        <form v-if="passwordLogin" @submit.prevent="submitPassword">
          <div class="field" style="margin-bottom: 18px">
            <label class="label" for="password">Admin password</label>
            <input
              id="password"
              v-model="password"
              type="password"
              class="input"
              autocomplete="current-password"
              autofocus
            />
          </div>
          <button
            type="submit"
            class="btn btn-primary btn-block"
            style="height: 40px"
            :disabled="busy || !password"
          >
            {{ busy ? "Checking…" : "Sign in" }}
          </button>
        </form>

        <p v-else class="muted" style="margin: 0">
          Set an admin password on the server to enable login.
        </p>
      </div>

      <p class="login-foot mono">self-hosted · your box, your rules</p>
    </div>
  </div>
</template>

<style scoped>
.login {
  position: relative;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  overflow: hidden;
}
/* Blueprint grid fading out radially — same atmosphere as the marketing hero. */
.login-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, color-mix(in oklab, var(--border) 70%, transparent) 1px, transparent 1px),
    linear-gradient(to bottom, color-mix(in oklab, var(--border) 70%, transparent) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse 80% 60% at 50% 40%, black 30%, transparent 75%);
}
.login-bloom {
  position: absolute;
  top: -140px;
  left: 50%;
  transform: translateX(-50%);
  width: 620px;
  height: 440px;
  border-radius: 50%;
  background: color-mix(in oklab, var(--primary) 14%, transparent);
  filter: blur(110px);
  pointer-events: none;
}
.login-inner {
  position: relative;
  width: 400px;
  max-width: 100%;
  text-align: center;
}
.login-brand {
  display: inline-flex;
  align-items: center;
  margin-bottom: 28px;
}
.login-logo {
  display: block;
  width: 168px;
  height: auto;
}
.login-logo-dark {
  display: none;
}
:global(:root.dark .login-logo-light) {
  display: none;
}
:global(:root.dark .login-logo-dark) {
  display: block;
}
.login-kicker {
  font-size: 13px;
  color: var(--primary);
  margin: 0 0 10px;
}
h1 {
  font-size: 30px;
  margin: 0 0 8px;
}
.login-sub {
  font-size: 15px;
  margin: 0 0 28px;
}
.login-card {
  padding: 24px;
  text-align: left;
}
:global(:root.dark .login-card) {
  border-color: color-mix(in oklab, var(--primary) 30%, var(--border));
  box-shadow: 0 0 40px -12px color-mix(in oklab, var(--primary) 35%, transparent);
}
.login-foot {
  margin-top: 24px;
  font-size: 12px;
  color: var(--muted-foreground);
}
.theme-toggle {
  position: fixed;
  top: 16px;
  right: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted-foreground);
  cursor: pointer;
  z-index: 1;
}
.theme-toggle:hover {
  color: var(--foreground);
  background: var(--accent-token);
}
</style>
