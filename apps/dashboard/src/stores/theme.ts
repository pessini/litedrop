import { ref } from "vue";

// Light/dark theme, toggled from the topbar (and the login page) and persisted
// per browser. The active theme is expressed as a `dark` class on <html>;
// styles.css keys its shadcn tokens off `:root` (light) and `:root.dark`
// (dark). Dark — the brand look — is the default until the user picks one.

type Theme = "light" | "dark";
const STORAGE_KEY = "litedrop.theme";

export const theme = ref<Theme>("dark");

function apply(value: Theme): void {
  document.documentElement.classList.toggle("dark", value === "dark");
}

function preferred(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

/** Resolve and apply the initial theme. Call once before mount to avoid a flash. */
export function initTheme(): void {
  theme.value = preferred();
  apply(theme.value);
}

export function toggleTheme(): void {
  theme.value = theme.value === "dark" ? "light" : "dark";
  localStorage.setItem(STORAGE_KEY, theme.value);
  apply(theme.value);
}
