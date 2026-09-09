import { defineConfig } from 'oxlint'

// The lint config lives with the code it describes: `oxlint` runs from this package, and every
// glob below is relative to this file. Formatting is the opposite: one root `oxfmt.config.ts` is
// the single source of style for the whole workspace.
//
// Strict by design. A one-off exception lives next to the code as `oxlint-disable-next-line` with
// the reason above it, never as an `'off'` in `rules` below. `'off'` appears only in `overrides`,
// where it is scoped to the files it describes and carries the reason with it. A rule that does
// not fit this codebase at all is left out of `rules` entirely, with a comment where it would
// have gone saying why.
export default defineConfig({
  ignorePatterns: ['**/node_modules/**', '**/dist/**', 'tmp-*/**'],
  // Node-only source (Bun is the runtime, but nothing in `src` touches a Bun global): declaring
  // the runtime is what lets rules that resolve globals — `no-undef`, `unicorn/prefer-global-this`
  // — tell `process` apart from a typo.
  env: { node: true, es2024: true },
  // Setting `plugins` replaces oxlint's default list, so the defaults are restated before
  // `import` / `promise` / `node` are added.
  plugins: ['typescript', 'unicorn', 'oxc', 'import', 'promise', 'node', 'jsdoc'],
  // The repository conventions a glob cannot express (Effect program shape, function
  // declarations, predicate naming); see lint/custom.js.
  jsPlugins: ['./lint/custom.js'],
  options: {
    typeAware: true,
    typeCheck: true,
    // A rule that stops firing must have its `oxlint-disable` comment deleted with it, otherwise
    // the suppression silently outlives its reason.
    reportUnusedDisableDirectives: 'deny',
    // Nothing here is configured as a warning; this keeps a rule that defaults to `warn` from
    // slipping through `oxlint` unnoticed.
    denyWarnings: true,
  },
  categories: {
    correctness: 'error',
    suspicious: 'error',
    perf: 'error',
  },
  // Rules in the correctness / suspicious / perf categories are already errors via `categories`
  // above and are not restated; this list only adds rules from the pedantic / style / restriction
  // / nursery categories, which no category enables.
  rules: {
    // An Effect program is a value: it is returned from a named `function`, never run in the
    // middle of one, and its steps are `yield*` inside a single `Effect.gen` rather than nested
    // `flatMap` closures. These five rules are what keep that shape from drifting.
    'custom/effect-gen-return': 'error',
    'custom/no-effect-fn': 'error',
    'custom/no-effect-flatmap': 'error',
    'custom/no-effect-run': 'error',
    'custom/effect-promise-import': 'error',
    'custom/function-declaration': 'error',
    'custom/predicate-is-name': 'error',
    'custom/type-pascal-case': 'error',
    // `@internal` and friends are modifiers, so their text belongs to the description;
    // `check-tag-names` is what catches a tag that is merely misspelled.
    'jsdoc/empty-tags': 'error',
    'jsdoc/check-tag-names': 'error',
    eqeqeq: 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    'no-param-reassign': ['error', { props: true }],
    'no-plusplus': 'error',
    // `_enum` is the generator for the OpenAPI `enum` keyword, which is a reserved word in
    // JavaScript; every other dangling underscore stays a smell.
    // `_enum` is the generator for the OpenAPI `enum` keyword, a reserved word in JavaScript;
    // `_tag` is Effect's discriminant on tagged errors. Every other dangling underscore stays a
    // smell.
    'no-underscore-dangle': ['error', { allow: ['_enum', '_tag'] }],
    // Paired with `env: { node: true }` above, so `process` resolves and a typo does not.
    'no-undef': 'error',

    // Escape hatches out of the type system, and the unsound types that survive `strict`.
    'typescript/no-explicit-any': 'error',
    'typescript/no-non-null-assertion': 'error',
    'typescript/consistent-type-imports': 'error',
    'typescript/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    'typescript/ban-ts-comment': 'error',
    'typescript/prefer-ts-expect-error': 'error',
    'typescript/no-unsafe-function-type': 'error',
    'typescript/no-empty-object-type': 'error',
    'typescript/no-invalid-void-type': 'error',
    'typescript/no-non-null-asserted-nullish-coalescing': 'error',
    'typescript/non-nullable-type-assertion-style': 'error',
    'typescript/no-dynamic-delete': 'error',

    // Type-aware: the rules that need `typeAware` above to say anything at all.
    'typescript/no-misused-promises': 'error',
    'typescript/require-await': 'error',
    'typescript/prefer-readonly': 'error',
    // `??` on a string would keep `''`, and `x || 'fallback'` on an empty join / an empty last
    // path segment is deliberate throughout the generators, so strings are left to `||`.
    'typescript/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
    'typescript/switch-exhaustiveness-check': 'error',
    'typescript/no-unsafe-argument': 'error',
    'typescript/no-unsafe-assignment': 'error',
    'typescript/no-unsafe-member-access': 'error',
    'typescript/no-unsafe-call': 'error',
    'typescript/no-unsafe-return': 'error',
    'typescript/no-deprecated': 'error',
    'typescript/restrict-plus-operands': 'error',
    'typescript/no-confusing-void-expression': 'error',
    'typescript/only-throw-error': 'error',
    'typescript/prefer-promise-reject-errors': 'error',
    'typescript/prefer-reduce-type-parameter': 'error',
    'typescript/prefer-includes': 'error',
    'typescript/prefer-string-starts-ends-with': 'error',
    'typescript/prefer-optional-chain': 'error',
    'typescript/use-unknown-in-catch-callback-variable': 'error',
    'typescript/return-await': 'error',
    'typescript/strict-void-return': 'error',

    // Declaration style. `consistent-type-definitions: 'type'` locks in the repo-wide
    // `type X = {...}`; the default of this rule is the opposite ('interface'), so the option is
    // load-bearing, not decoration.
    'typescript/consistent-type-definitions': ['error', 'type'],
    'typescript/consistent-type-exports': 'error',
    'typescript/consistent-generic-constructors': 'error',
    'typescript/array-type': 'error',
    'typescript/method-signature-style': 'error',
    'typescript/no-inferrable-types': 'error',
    'typescript/dot-notation': 'error',
    'typescript/prefer-for-of': 'error',
    'typescript/prefer-find': 'error',
    'typescript/prefer-function-type': 'error',
    // ESM-only package: a `require` call would not survive the build.
    'typescript/no-require-imports': 'error',
    'typescript/no-import-type-side-effects': 'error',

    // Rejections and throws must carry an Error, or the CLI reports `[object Object]` instead of
    // an actionable message.
    'no-throw-literal': 'error',
    'unicorn/error-message': 'error',
    'unicorn/prefer-type-error': 'error',

    // Node / ESM hygiene.
    'unicorn/prefer-module': 'error',
    'unicorn/prefer-global-this': 'error',
    'unicorn/prefer-node-protocol': 'error',
    'unicorn/require-module-specifiers': 'error',
    'unicorn/prefer-export-from': 'error',
    'unicorn/prefer-import-meta-properties': 'error',
    // `no-abusive-eslint-disable` pairs with `reportUnusedDisableDirectives` above: a suppression
    // must name the rule it silences and must still be earning its place.
    'unicorn/no-abusive-eslint-disable': 'error',
    'unicorn/no-anonymous-default-export': 'error',

    // String and array work: this is what a code generator does all day.
    'prefer-template': 'error',
    'no-useless-concat': 'error',
    'no-multi-str': 'error',
    'unicorn/consistent-template-literal-escape': 'error',
    'unicorn/consistent-existence-index-check': 'error',
    'unicorn/require-array-join-separator': 'error',
    'unicorn/prefer-negative-index': 'error',
    'unicorn/prefer-array-index-of': 'error',
    'unicorn/prefer-array-some': 'error',
    'unicorn/prefer-array-flat': 'error',
    'unicorn/prefer-object-from-entries': 'error',
    'unicorn/prefer-string-replace-all': 'error',
    'unicorn/prefer-string-slice': 'error',
    'unicorn/prefer-string-trim-start-end': 'error',
    'unicorn/prefer-spread': 'error',
    'unicorn/prefer-at': 'error',
    'unicorn/explicit-length-check': 'error',
    'unicorn/throw-new-error': 'error',
    'unicorn/no-array-for-each': 'error',
    'unicorn/no-await-expression-member': 'error',
    'unicorn/prefer-native-coercion-functions': 'error',
    'unicorn/consistent-empty-array-spread': 'error',
    'unicorn/prefer-single-call': 'error',
    'unicorn/no-useless-collection-argument': 'error',
    'unicorn/no-useless-fallback-in-spread': 'error',
    'unicorn/no-unnecessary-array-flat-depth': 'error',
    'unicorn/no-magic-array-flat-depth': 'error',
    'unicorn/no-unnecessary-slice-end': 'error',
    'unicorn/no-length-as-slice-end': 'error',
    'unicorn/no-unreadable-array-destructuring': 'error',
    'unicorn/no-immediate-mutation': 'error',

    // Regex and numbers.
    'unicorn/prefer-regexp-test': 'error',
    'prefer-regex-literals': 'error',
    'no-div-regex': 'error',
    'no-regex-spaces': 'error',
    'unicorn/prefer-number-properties': 'error',
    'unicorn/prefer-math-min-max': 'error',
    'unicorn/prefer-math-trunc': 'error',
    'unicorn/prefer-modern-math-apis': 'error',
    'unicorn/numeric-separators-style': 'error',
    'unicorn/no-zero-fractions': 'error',
    'unicorn/escape-case': 'error',
    'unicorn/no-hex-escape': 'error',
    radix: 'error',
    'prefer-numeric-literals': 'error',
    'prefer-exponentiation-operator': 'error',
    'unicorn/no-typeof-undefined': 'error',

    // Control flow and declarations. `curly` is `multi-line` rather than `all` so the guard-clause
    // form (`if (!x) return null` on one line) stays legal, while a body that wraps onto its own
    // line must be braced.
    curly: ['error', 'multi-line'],
    'no-else-return': 'error',
    'no-lonely-if': 'error',
    'no-useless-return': 'error',
    'no-return-assign': 'error',
    'unicorn/no-lonely-if': 'error',
    'unicorn/prefer-logical-operator-over-ternary': 'error',
    'unicorn/prefer-default-parameters': 'error',
    'unicorn/no-object-as-default-parameter': 'error',
    'unicorn/no-unreadable-iife': 'error',
    'unicorn/no-useless-switch-case': 'error',
    'default-case-last': 'error',
    'default-param-last': 'error',
    'no-fallthrough': 'error',
    'no-case-declarations': 'error',
    'array-callback-return': 'error',
    'no-loop-func': 'error',
    'no-inner-declarations': 'error',
    'block-scoped-var': 'error',
    'init-declarations': 'error',
    'no-redeclare': 'error',
    'no-multi-assign': 'error',
    'no-sequences': 'error',
    'no-useless-assignment': 'error',
    'no-unreachable-loop': 'error',
    // Hoisted `function` declarations are safe to reference above their definition; `const` /
    // `class` are the TDZ hazard this rule is for.
    'no-use-before-define': ['error', { functions: false }],
    'func-style': ['error', 'declaration', { allowArrowFunctions: true }],
    'arrow-body-style': 'error',
    'prefer-arrow-callback': 'error',
    'guard-for-in': 'error',
    'no-labels': 'error',
    'no-label-var': 'error',
    'no-extra-label': 'error',
    'no-lone-blocks': 'error',
    yoda: 'error',
    'no-self-compare': 'error',

    // Objects and globals.
    'object-shorthand': 'error',
    'operator-assignment': 'error',
    'prefer-object-spread': 'error',
    'prefer-object-has-own': 'error',
    'no-prototype-builtins': 'error',
    'no-object-constructor': 'error',
    'no-array-constructor': 'error',
    'no-new-wrappers': 'error',
    'unicorn/new-for-builtins': 'error',
    'prefer-rest-params': 'error',
    'no-implicit-globals': 'error',
    'no-extra-bind': 'error',
    'no-useless-computed-key': 'error',
    'symbol-description': 'error',
    'unicorn/no-useless-promise-resolve-reject': 'error',
    'unicorn/prefer-structured-clone': 'error',
    'unicorn/prefer-optional-catch-binding': 'error',

    // Code injection surfaces (`eval` itself is already `correctness`).
    'no-new-func': 'error',
    'no-script-url': 'error',
    'no-bitwise': 'error',
    // `void promise` is the marker `typescript/no-floating-promises` prescribes for a deliberate
    // fire-and-forget; `void 0` stays banned.
    'no-void': ['error', { allowAsStatement: true }],
    'no-empty': 'error',
    'no-empty-function': 'error',
    'unicode-bom': 'error',
    // A parked TODO is debt that belongs in an issue, not in the source.
    'no-warning-comments': 'error',

    // promise / node rules sit outside the enabled categories, so the ones that matter for an
    // async CLI are named explicitly.
    'promise/param-names': 'error',
    'promise/valid-params': 'error',
    'promise/spec-only': 'error',
    'promise/no-new-statics': 'error',
    'promise/no-multiple-resolved': 'error',
    'promise/no-return-wrap': 'error',
    'promise/no-return-in-finally': 'error',
    'promise/no-nesting': 'error',
    'promise/no-promise-in-callback': 'error',
    'promise/no-callback-in-promise': 'error',
    'promise/catch-or-return': 'error',
    'promise/always-return': 'error',
    'promise/prefer-catch': 'error',
    'node/no-exports-assign': 'error',
    'node/no-new-require': 'error',
    'node/no-mixed-requires': 'error',
    'node/global-require': 'error',
    'node/no-path-concat': 'error',
    'node/handle-callback-err': 'error',
    'node/callback-return': 'error',

    // Module graph. `extensions` keeps relative specifiers `.js`-suffixed, which NodeNext
    // resolution requires at runtime and `tsc` does not check.
    'import/extensions': ['error', 'always', { ignorePackages: true }],
    'import/no-cycle': 'error',
    'import/no-duplicates': 'error',
    'import/no-default-export': 'error',
    'import/no-mutable-exports': 'error',
    'import/first': 'error',
    'import/export': 'error',
    'import/unambiguous': 'error',
    'import/no-commonjs': 'error',
    'import/no-named-default': 'error',
    'import/no-unassigned-import': 'error',
    'import/no-named-as-default': 'error',
    'import/no-anonymous-default-export': 'error',
    'import/consistent-type-specifier-style': 'error',
    'import/no-self-import': 'error',
    'import/no-absolute-path': 'error',
    'import/no-empty-named-blocks': 'error',

    // Naming: the identifiers a reader scans first.
    'no-shadow-restricted-names': 'error',
    'no-delete-var': 'error',
  },

  // --- Dependency direction ----------------------------------------------------------------
  //
  // `src` is layered, and each layer may only reach downwards. The rules below state, per
  // directory, which siblings it may *not* import; the message names what is left. Regexes match
  // relative specifiers only, so an external package such as `@typespec/openapi3` never collides
  // with a banned directory name.
  //
  //   layer 0  config  format  fsp  merge  utils  openapi   (leaves: import nothing internal)
  //   layer 1  guard -> openapi              emit -> format, fsp
  //   layer 2  generator <-> helper -> utils, guard, openapi, emit
  //   layer 3  core -> everything below it
  //   layer 4  shared -> config, core, format, fsp, openapi
  //   layer 5  cli, vite-plugin -> config, core, format, openapi, shared
  //
  // A change that needs a new edge is a change to this list first, and to the code second.
  overrides: [
    {
      files: [
        'src/config/**',
        'src/error/**',
        'src/format/**',
        'src/fsp/**',
        'src/merge/**',
        'src/utils/**',
        'src/openapi/**',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '^\\.\\./',
                message: 'leaf module: no project-internal imports allowed',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/guard/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex:
                  '^(\\.\\./)+(cli|config|core|emit|format|fsp|generator|helper|merge|shared|utils|vite-plugin)(/.*)?$',
                message: 'guard may only import openapi',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/emit/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex:
                  '^(\\.\\./)+(cli|config|core|generator|guard|helper|merge|openapi|shared|utils|vite-plugin)(/.*)?$',
                message: 'emit may only import format, fsp',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/generator/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex:
                  '^(\\.\\./)+(cli|config|core|emit|format|fsp|merge|shared|vite-plugin)(/.*)?$',
                message: 'generator may only import utils, guard, helper, openapi',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/helper/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '^(\\.\\./)+(cli|config|core|format|fsp|merge|shared|vite-plugin)(/.*)?$',
                message: 'helper may only import utils, guard, generator, openapi, emit',
              },
              {
                regex: '^\\./index(\\.js)?$',
                message:
                  'import helper modules directly, not via the helper/index.ts barrel (cycle risk)',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/core/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '^(\\.\\./)+(cli|config|shared|vite-plugin)(/.*)?$',
                message:
                  'core may only import utils, guard, helper, generator, openapi, emit, format, fsp, merge',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/shared/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex:
                  '^(\\.\\./)+(cli|emit|generator|guard|helper|merge|utils|vite-plugin)(/.*)?$',
                message: 'shared may only import config, core, format, fsp, openapi',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/cli/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex:
                  '^(\\.\\./)+(emit|fsp|generator|guard|helper|merge|utils|vite-plugin)(/.*)?$',
                message: 'cli may only import config, core, format, openapi, shared',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/vite-plugin/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '^(\\.\\./)+(cli|core|emit|generator|guard|helper|merge|utils)(/.*)?$',
                message: 'vite-plugin may only import config, format, fsp, openapi, shared',
              },
            ],
          },
        ],
      },
    },
    {
      // Vite resolves a plugin config through its default export, and tsdown / oxfmt / oxlint
      // configs are the same shape.
      files: ['**/*.config.ts', '**/*.config.mts'],
      rules: {
        'import/no-default-export': 'off',
      },
    },
    {
      // The two places an Effect meets something that is not one: the Vite plugin's hooks are
      // Vite's own Promise/callback API, and the test helpers hand a result back to a test.
      // Everywhere else an Effect is returned, not run.
      files: ['src/vite-plugin/**', 'src/testing/**'],
      rules: { 'custom/no-effect-run': 'off' },
    },
    {
      // The convention plugin is an oxlint JS plugin: it walks an untyped ESTree and its
      // contract with oxlint is a default export.
      files: ['lint/**'],
      rules: {
        'import/no-default-export': 'off',
        'import/no-anonymous-default-export': 'off',
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'typescript/no-unsafe-return': 'off',
      },
    },
    {
      // `as OpenAPI` on what swagger-parser returns is the one sanctioned cast in `src`: the
      // parser is typed as a union of the OpenAPI 2 / 3.0 / 3.1 documents, and narrowing it is
      // the whole point of this module.
      files: ['src/openapi/index.ts'],
      rules: {
        'typescript/consistent-type-assertions': 'off',
        'typescript/no-unsafe-type-assertion': 'off',
        'typescript/no-unsafe-argument': 'off',
      },
    },
    {
      // asphodelosVite(): any is intentional — typing the return would force Vite / Rollup type
      // installs on consumers of the library.
      files: ['src/vite-plugin/index.ts'],
      rules: {
        'typescript/no-explicit-any': 'off',
      },
    },
    {
      // A JSON Schema compiler is mutually recursive by construction: `typebox()` dispatches to
      // `t/object`, `t/array`, `t/union` …, and each of those recurses back into `typebox()` for
      // its children. The cycle is the design, not an accident — `import/no-cycle` stays on
      // everywhere else, where it is what catches an accidental layer cycle.
      files: ['src/generator/typebox/**'],
      rules: {
        'import/no-cycle': 'off',
      },
    },
    {
      // These blocks hand-mirror, statement for statement, the source the generator emits a few
      // lines above them, then run it to prove the emitted semantics hold. Reformatting them to
      // this repo's style would break the correspondence that is the point of the test.
      files: ['src/generator/typebox/index.test.ts'],
      rules: {
        'eslint/prefer-regex-literals': 'off',
        'unicorn/no-useless-collection-argument': 'off',
        'unicorn/no-lonely-if': 'off',
        curly: 'off',
      },
    },
    {
      // The suite drives the generators against real files and asserts on the text they emit.
      files: ['**/*.test.ts'],
      rules: {
        // The layering describes `src`; a test reaches for whatever fixture or helper spells the
        // case out most directly.
        'no-restricted-imports': 'off',
        // A test arranges imperatively and casts freely when that is the clearest way to build a
        // fixture; the type-safety rules that exist only to police those casts are scoped off
        // here, nothing else is.
        'typescript/no-explicit-any': 'off',
        'typescript/consistent-type-assertions': 'off',
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-return': 'off',
        // `let` declared per suite and assigned in a hook is the shape of a fixture, not an
        // uninitialized binding waiting to bite.
        'init-declarations': 'off',
        // Stub callbacks (`() => {}` passed to a plugin hook or a spy) are the point.
        'no-empty-function': 'off',
        // Fixtures feed and assert on source text that contains a literal `${...}`; there that is
        // the value under test, not a lost backtick.
        'no-template-curly-in-string': 'off',
        // A cast onto a fixture is how a test spells "this shape, for this case".
        'typescript/no-unsafe-type-assertion': 'off',
        // `(result?.[1] as {...}).expr` throws when the call returned nothing — in a test that
        // throw is the failure signal, not a hazard to guard against.
        'no-unsafe-optional-chaining': 'off',
        // A helper that builds a fixture belongs inside the `describe` that uses it, next to the
        // cases it serves, not hoisted to module scope away from them.
        'unicorn/consistent-function-scoping': 'off',
        // `(await run()).ok` is how an assertion reads; naming the intermediate adds nothing.
        'unicorn/no-await-expression-member': 'off',
        // Steps in a scenario run in order on purpose; `Promise.all` would race them.
        'no-await-in-loop': 'off',
      },
    },
  ],
})
