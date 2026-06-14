import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Env } from "../../env.ts";
import type {
  PutObject,
  StorageBackend,
  StorageProvider,
  StoredObject,
} from "../backend.ts";

// Local filesystem StorageBackend for dev. Bytes go to <root>/<key>.bin and the
// content type to <root>/<key>.type.
export class LocalStorage implements StorageBackend {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  // Keep keys from escaping the storage root (defense-in-depth; slugs are
  // already CSPRNG and contain no path separators).
  private pathFor(key: string, ext: string): string {
    const target = resolve(this.root, `${key}.${ext}`);
    if (target !== `${this.root}${sep}${key}.${ext}`) {
      throw new Error(`invalid storage key: ${key}`);
    }
    return target;
  }

  async put(obj: PutObject): Promise<void> {
    const dataPath = this.pathFor(obj.key, "bin");
    await mkdir(dirname(dataPath), { recursive: true });
    await writeFile(dataPath, obj.body);
    await writeFile(this.pathFor(obj.key, "type"), obj.contentType, "utf8");
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const body = await readFile(this.pathFor(key, "bin"));
      const contentType = await readFile(this.pathFor(key, "type"), "utf8");
      return { body: new Uint8Array(body), contentType, size: body.byteLength };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key, "bin"), { force: true });
    await rm(this.pathFor(key, "type"), { force: true });
  }
}

// Default provider — no config beyond STORAGE_DIR, so the app boots out of the box.
export const localProvider: StorageProvider = {
  name: "local",
  create(env: Env): StorageBackend {
    return new LocalStorage(env.STORAGE_DIR);
  },
};
