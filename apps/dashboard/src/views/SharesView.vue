<script setup lang="ts">
import type { Share } from "@litedrop/api-types";
import { computed, onMounted, ref } from "vue";
import { ApiError, api } from "../api/client";
import Icon from "../components/Icon.vue";
import UploadForm from "../components/UploadForm.vue";
import { formatBytes, formatExpiry, formatViews } from "../lib/format";
import { copy } from "../stores/toast";

const shares = ref<Share[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const showUpload = ref(false);

// Summary cards over the loaded shares.
const stats = computed(() => {
  const list = shares.value;
  const active = list.filter((s) => s.status === "active");
  const locked = list.filter((s) => s.has_password).length;
  const views = list.reduce((sum, s) => sum + s.view_count, 0);
  return {
    total: list.length,
    active: active.length,
    locked,
    inactive: list.length - active.length,
    views,
  };
});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    shares.value = await api.listShares();
  } catch (err) {
    error.value =
      err instanceof ApiError ? err.message : "could not load shares";
  } finally {
    loading.value = false;
  }
}

function onCreated(share: Share) {
  shares.value.unshift(share);
  showUpload.value = false;
}

async function revoke(share: Share) {
  if (
    !confirm(
      `Revoke "${share.filename}"? The link will stop working immediately.`,
    )
  ) {
    return;
  }
  try {
    const res = await api.deleteShare(share.id);
    share.status = res.status as Share["status"];
  } catch (err) {
    alert(err instanceof ApiError ? err.message : "revoke failed");
  }
}

onMounted(load);
</script>

<template>
  <div class="container">
    <div class="page-head">
      <div>
        <h1>Your shares</h1>
        <p class="muted" style="margin: 0">Upload, view counts, and revocation.</p>
      </div>
      <button class="btn btn-primary" @click="showUpload = !showUpload">
        <Icon v-if="!showUpload" name="plus" /> {{ showUpload ? "Close" : "New share" }}
      </button>
    </div>

    <div v-if="showUpload" class="card" style="margin-bottom: 1.5rem">
      <UploadForm @created="onCreated" />
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>

    <div v-if="loading" class="spinner">Loading…</div>

    <template v-else>
      <div class="stats">
        <div class="card stat">
          <div class="stat-label">Total shares</div>
          <div class="stat-value">{{ stats.total }}</div>
          <div class="stat-sub">in this workspace</div>
        </div>
        <div class="card stat">
          <div class="stat-label">Active</div>
          <div class="stat-value">{{ stats.active }}</div>
          <div class="stat-sub">{{ stats.locked }} password-protected</div>
        </div>
        <div class="card stat">
          <div class="stat-label">Inactive</div>
          <div class="stat-value">{{ stats.inactive }}</div>
          <div class="stat-sub">revoked, expired or consumed</div>
        </div>
        <div class="card stat">
          <div class="stat-label">Total views</div>
          <div class="stat-value">{{ stats.views }}</div>
          <div class="stat-sub">across all shares</div>
        </div>
      </div>

      <div v-if="shares.length === 0 && !error" class="card">
        <div class="empty">
          No shares yet. Hit <strong>New share</strong> to upload your first file.
        </div>
      </div>

      <div v-else class="card" style="overflow: hidden">
        <div class="table-wrap">
          <table>
            <colgroup>
              <col />
              <col style="width: 104px" />
              <col style="width: 176px" />
              <col style="width: 96px" />
              <col style="width: 84px" />
              <col style="width: 168px" />
              <col style="width: 248px" />
            </colgroup>
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Link</th>
                <th>Views</th>
                <th>Size</th>
                <th>Expiry</th>
                <th style="text-align: right">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in shares" :key="s.id">
                <td>
                  <div style="display: flex; align-items: center; gap: 8px; min-width: 0">
                    <span class="trunc" style="font-weight: 600" :title="s.filename">
                      {{ s.filename }}
                    </span>
                    <Icon v-if="s.has_password" name="lock" class="icon-lock" :size="14" />
                  </div>
                </td>
                <td>
                  <div style="display: inline-flex; gap: 4px">
                    <span
                      class="badge"
                      :class="s.status === 'active' ? 'badge-success' : 'badge-warning'"
                    >
                      {{ s.status }}
                    </span>
                    <span
                      v-if="s.report_count > 0"
                      class="badge badge-reported"
                      :title="`Reported as abuse by ${s.report_count} viewer(s)`"
                    >
                      ⚑ {{ s.report_count }}
                    </span>
                  </div>
                </td>
                <td>
                  <span class="trunc mono muted" style="font-size: 13px" :title="`/s/${s.slug}`">
                    /s/{{ s.slug }}
                  </span>
                </td>
                <td class="muted nowrap">{{ formatViews(s.view_count, s.max_views) }}</td>
                <td class="muted nowrap">{{ formatBytes(s.size_bytes) }}</td>
                <td>
                  <span class="trunc muted" style="font-size: 13px" :title="formatExpiry(s.expires_at)">
                    {{ formatExpiry(s.expires_at) }}
                  </span>
                </td>
                <td style="text-align: right" class="nowrap">
                  <div style="display: inline-flex; gap: 6px">
                    <button class="btn btn-outline btn-sm" @click="copy(s.url, 'Share URL copied')">
                      <Icon name="copy" /> Copy
                    </button>
                    <button class="btn btn-outline btn-sm" @click="copy(s.raw_url, 'Raw URL copied')">
                      Raw
                    </button>
                    <a class="btn btn-outline btn-sm" :href="s.url" target="_blank" rel="noopener">
                      <Icon name="external" /> Open
                    </a>
                    <button
                      v-if="s.status === 'active'"
                      class="btn btn-danger btn-sm"
                      title="Revoke"
                      aria-label="Revoke share"
                      @click="revoke(s)"
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
