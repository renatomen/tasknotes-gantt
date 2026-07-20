// Jest stub for `*.svelte` imports: unit tests that transitively import a
// component only need it to be a constructible default export, never rendered
// (component behaviour is covered by e2e). Real Svelte compilation is not run
// in the Node unit environment.
export default function SvelteComponentStub() {}
