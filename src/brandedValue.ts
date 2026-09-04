/**
 * Nominal branding for values whose validity is *which value it is* — which
 * collaborator produced it, which sibling it belongs to.
 *
 * TypeScript is structural, so two values of the same shape are
 * interchangeable: a host assembling a call literal can pass the priority
 * palette where the status palette belongs, or fabricate a plausible stand-in
 * for a value only a collaborator can legitimately answer. Neither mistake is
 * visible to a pure function's own tests — the function never sees the literal
 * — nor to a behavioural test whose fixture happens to agree.
 *
 * A brand is a phantom property under a module-private `unique symbol`, so the
 * only way to produce one is a deliberate cast. Put the cast in the producing
 * reader and nowhere else, and the compiler refuses every other origin while
 * every downstream consumer that reads the plain type still typechecks — the
 * value stays assignable to what it brands.
 *
 * Brand the *producer's declared return type*, never the shared domain type: a
 * brand on the domain type reaches every consumer of it, which is why the
 * dependency-arrow mode's brand was measured and rejected.
 *
 * @module brandedValue
 */

declare const brandName: unique symbol;

/**
 * `T` tagged with `Name`, assignable to `T` but not producible from it.
 *
 * @typeParam T - The underlying value type, unchanged for every consumer.
 * @typeParam Name - The tag distinguishing this producer's values from every
 *   other branded value of the same underlying type.
 */
export type Branded<T, Name extends string> = T & { readonly [brandName]: Name };

/**
 * Any branded value, whatever it brands and whatever its tag.
 *
 * Lets a consumer ask whether a value carries a brand at all, so a guard can
 * be written over the fields that are deliberately unbranded rather than over
 * a hand-kept list of the ones that are.
 */
export type AnyBranded = { readonly [brandName]: string };
