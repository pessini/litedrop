import type { components } from "./schema";
import type { Share } from "./types.js";

// Compile-time bridge between the hand-written types and the generated OpenAPI
// contract. If the backend spec changes but a hand-written type drifts, this
// stops type-checking — so it acts as an enforced contract. No runtime output;
// it is type-checked in place by this package's `typecheck` script.

// Invariant type-equality (the standard fn-identity trick: tolerant equality
// like `extends` would let one side silently add/drop fields).
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

function assertExact<_T extends true>(): void {}

assertExact<Equal<Share, components["schemas"]["Share"]>>();
