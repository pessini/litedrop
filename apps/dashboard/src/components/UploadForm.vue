<script setup lang="ts">
import type { Share, UploadControls } from "@litedrop/api-types";
import { ref } from "vue";
import { ApiError, api } from "../api/client";

// Browser upload. Accepts a dropped/picked file or pasted text, plus link
// controls. Files are .md/.html text under the 5 MB cap, so we read them as
// text and POST via the raw-body path (name + controls as query params); the
// backend re-validates extension, UTF-8 sniff, and size.

const emit = defineEmits<{ created: [Share] }>();

const ALLOWED = [".md", ".markdown", ".html", ".htm"];

const filename = ref("");
const content = ref("");
const expires = ref("7d");
const password = ref("");
const maxViews = ref<string>("");
const dragging = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

async function loadFile(file: File) {
  if (!ALLOWED.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    error.value = `unsupported file type — allowed: ${ALLOWED.join(", ")}`;
    return;
  }
  filename.value = file.name;
  content.value = await file.text();
  error.value = null;
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
}

function onPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void loadFile(file);
}

async function submit() {
  error.value = null;
  if (!filename.value.trim()) {
    error.value = "a filename is required (e.g. NOTES.md)";
    return;
  }
  const controls: UploadControls = { expires: expires.value };
  if (password.value) controls.password = password.value;
  if (maxViews.value) {
    const n = Number(maxViews.value);
    if (!Number.isInteger(n) || n < 1) {
      error.value = "max views must be a positive whole number";
      return;
    }
    controls.max_views = n;
  }

  busy.value = true;
  try {
    const share = await api.createShare(
      filename.value.trim(),
      content.value,
      controls,
    );
    emit("created", share);
    // Reset for the next upload.
    filename.value = "";
    content.value = "";
    password.value = "";
    maxViews.value = "";
    expires.value = "7d";
    if (fileInput.value) fileInput.value.value = "";
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "upload failed";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card-body" @submit.prevent="submit">
    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div
      class="dropzone"
      :class="{ dragging }"
      @click="fileInput?.click()"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <strong>Drop a file</strong> or click to choose
      <div class="muted" style="font-size: 0.85rem; margin-top: 0.3rem">
        .md / .markdown / .html / .htm · up to 5 MB
      </div>
      <input
        ref="fileInput"
        type="file"
        accept=".md,.markdown,.html,.htm,text/markdown,text/html"
        hidden
        @change="onPick"
      />
    </div>

    <div class="field" style="margin-top: 1rem">
      <label for="content">…or paste content</label>
      <textarea id="content" v-model="content" placeholder="# Hello"></textarea>
    </div>

    <div class="field">
      <label for="name">Filename</label>
      <input id="name" v-model="filename" placeholder="NOTES.md" />
    </div>

    <div class="row">
      <div class="field">
        <label for="expires">Expires</label>
        <select id="expires" v-model="expires">
          <option value="1h">1 hour</option>
          <option value="24h">24 hours</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
          <option value="never">never</option>
        </select>
      </div>
      <div class="field">
        <label for="maxviews">Max views</label>
        <input id="maxviews" v-model="maxViews" type="number" min="1" placeholder="unlimited" />
      </div>
      <div class="field">
        <label for="pw">Password</label>
        <input id="pw" v-model="password" type="password" autocomplete="off" placeholder="none" />
      </div>
    </div>

    <button type="submit" class="btn-primary" :disabled="busy" style="margin-top: 1rem">
      {{ busy ? "Uploading…" : "Create share" }}
    </button>
  </form>
</template>
