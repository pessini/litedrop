import { ref } from "vue";

// Dead-simple transient toast for copy/confirm feedback.
export const toastMessage = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string): void {
  toastMessage.value = message;
  clearTimeout(timer);
  timer = setTimeout(() => (toastMessage.value = null), 2200);
}

export async function copy(text: string, label = "Copied"): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Copy failed — select and copy manually");
  }
}
