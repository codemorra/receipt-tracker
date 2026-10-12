# Development dependency override

`drizzle-kit@0.31.11`, the current stable release, depends on
`@esbuild-kit/esm-loader@2.6.5`, which loads `@esbuild-kit/core-utils@3.3.2`.
The latter requires `esbuild~0.18.20`, affected by
[GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
The advisory concerns esbuild's development-server feature. This dependency
chain is used by development tools and is excluded from the Docker runtime;
backend startup applies migrations through `drizzle-orm`.

The override in `package.json` replaces only the esbuild dependency beneath
Drizzle Kit's core-utils with `0.25.12`, also used by Drizzle Kit directly.
The existing tsx dependency keeps its own esbuild version. No compatible
stable update of Drizzle Kit or the esbuild-kit packages removes the affected
chain at present. The override avoids npm audit's proposed Drizzle Kit downgrade.

Remove the override when a compatible stable upstream update resolves the
chain, and regenerate the lockfile. Verify `npm audit` and `npm ls esbuild`
before removing any corresponding version-specific `allowScripts` entry.

For changes to this override, verify a fresh `npm ci`, TypeScript transforms
through core-utils (sync and async), Drizzle configuration/schema loading,
migration generation and application against a temporary SQLite database,
repeat migration/generation, the backend dev startup, and the normal tests,
typecheck, lint and build. Keep generated test migrations outside the repository.
