import { computed, reactive, readonly } from "vue";
import { api } from "../api/client";

// Auth state for the dashboard. Single-user: the only credential is a session
// cookie set by the password login. State is simply "authenticated or not",
// derived from GET /api/me. `restore()` on boot asks /api/me to learn whether a
// session is already present.

const state = reactive<{ authenticated: boolean; ready: boolean }>({
  authenticated: false,
  ready: false,
});

export const auth = {
  state: readonly(state),
  isAuthenticated: computed(() => state.authenticated),

  /** Learn from /api/me whether a session cookie is already valid on boot. */
  async restore(): Promise<void> {
    try {
      const me = await api.me();
      state.authenticated = me.authenticated;
    } catch {
      state.authenticated = false;
    } finally {
      state.ready = true;
    }
  },

  /** Exchange the admin password for a session cookie. */
  async loginWithPassword(password: string): Promise<void> {
    await api.passwordLogin(password);
    state.authenticated = true;
  },

  async logout(): Promise<void> {
    await api.logout();
    state.authenticated = false;
  },
};
