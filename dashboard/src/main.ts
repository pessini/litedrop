import { createApp } from "vue";
import App from "./App.vue";
import "./styles.css";
import { router } from "./router";
import { initTheme } from "./stores/theme";

initTheme();
createApp(App).use(router).mount("#app");
