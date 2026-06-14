import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from "vue-router";
import { auth } from "./stores/auth";

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "login",
    component: () => import("./views/LoginView.vue"),
    meta: { public: true },
  },
  {
    path: "/",
    name: "shares",
    component: () => import("./views/SharesView.vue"),
  },
  { path: "/:pathMatch(.*)*", redirect: "/" },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Auth guard: everything but /login requires an authenticated session. We wait
// for the one-time restore() to finish before deciding, so a page refresh on a
// protected route doesn't bounce to /login while the session is being checked.
router.beforeEach(async (to) => {
  if (!auth.state.ready) await auth.restore();

  if (to.meta.public) {
    if (auth.isAuthenticated.value) return { name: "shares" };
    return true;
  }
  if (!auth.isAuthenticated.value) {
    return {
      name: "login",
      query: to.fullPath === "/" ? {} : { next: to.fullPath },
    };
  }
  return true;
});
