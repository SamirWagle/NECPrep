/**
 * Let Node import the app's TypeScript modules by their extensionless
 * specifiers.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/<something>.mjs
 *
 * WHY
 * ---
 * Node >= 22.18 strips TypeScript types natively, so a script can import
 * `frontend/src/**` directly and share one implementation with the app rather
 * than keeping a mirrored copy that drifts. What Node will not do is guess
 * extensions: the app writes `import { x } from '../data/syllabus'` — correct
 * under Vite and `moduleResolution: "bundler"` — and Node raises
 * ERR_MODULE_NOT_FOUND because no such file exists.
 *
 * The alternative was to write `'../data/syllabus.ts'` in the app source
 * (tsconfig already sets `allowImportingTsExtensions`), but that bends app code
 * around a build script and would have to be repeated for every module a script
 * ever reaches. A resolve hook fixes it once, outside the app.
 *
 * SCOPE
 * -----
 * Only relative specifiers with no extension are retried, and only with `.ts`
 * then `.tsx`, then `/index.ts`. Anything else — bare package names, explicit
 * extensions, absolute URLs — is handed straight back to the default resolver,
 * so a genuinely missing module still fails as a missing module.
 */

import { registerHooks } from 'node:module';

const RETRY_SUFFIXES = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/** Relative, and no extension of any kind on the final segment. */
function isExtensionlessRelative(specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return false;
  const lastSegment = specifier.slice(specifier.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!isExtensionlessRelative(specifier)) {
      return nextResolve(specifier, context);
    }
    for (const suffix of RETRY_SUFFIXES) {
      try {
        return nextResolve(specifier + suffix, context);
      } catch {
        // Try the next candidate. The original error is re-raised below if
        // none of them resolve, so a real typo is still reported as a typo.
      }
    }
    return nextResolve(specifier, context);
  },
});
