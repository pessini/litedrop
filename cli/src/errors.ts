// CLI errors carry a deterministic exit code so scripts and agents can branch
// on the failure mode.

export type ErrorKind = "io" | "usage" | "auth" | "notFound" | "api";

// Io=1, Usage=2, Auth=3, NotFound=4, Api=5 — stable codes, so scripts/agents
// that branch on the exit code keep working across releases.
const EXIT_CODES: Record<ErrorKind, number> = {
  io: 1,
  usage: 2,
  auth: 3,
  notFound: 4,
  api: 5,
};

export class CliError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "CliError";
    this.kind = kind;
  }

  get exitCode(): number {
    return EXIT_CODES[this.kind];
  }
}

/** Local I/O (file, config, stdin). Exit 1. */
export const ioError = (message: string): CliError =>
  new CliError("io", message);
/** Bad invocation / missing required input. Exit 2. */
export const usageError = (message: string): CliError =>
  new CliError("usage", message);
/** Missing or rejected credentials (401/403). Exit 3. */
export const authError = (message: string): CliError =>
  new CliError("auth", message);
/** No such share (404). Exit 4. */
export const notFoundError = (message: string): CliError =>
  new CliError("notFound", message);
/** Other server / protocol error. Exit 5. */
export const apiError = (message: string): CliError =>
  new CliError("api", message);
