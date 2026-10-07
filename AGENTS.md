# AGENTS.md

Instructions for AI coding agents working on **Star Simulator**, a Vue 3 + TypeScript + Pinia + Vite app that renders physically grounded 3D stars with WebGPU (WebGL2 fallback). See `README.md` for the full project overview.

## Core Rules

1. **Use subagents.** Delegate independent work (research, physics verification, shader work, UI work, test writing, code review) to subagents and run them in parallel where tasks don't depend on each other. Keep the main agent's context focused on planning and integration.
2. **Real physics over arcade.** When realism and "looks cool" conflict, choose realism. Expose artistic exaggeration only as an explicit, clearly labeled option (e.g. *Filter* view mode), never as the default behavior.
3. **Cutting-edge, idiomatic TypeScript.** Use the latest stable TypeScript and modern language features. No legacy patterns.

## Commands

```bash
npm run dev          # Vite dev server
npm run type-check   # vue-tsc --noEmit (must pass)
npm run build        # type-check + production build (must pass)
```

Before finishing any task, run `type-check` and `build`. Do not report work as done if either fails.

## Subagent Guidelines

- Give each subagent a **narrow, self-contained task** with clear inputs and expected output.
- Good splits: `physics/` math, shaders, Pinia stores, Vue components, type definitions, docs.
- Use a **verification subagent** for any new physics formula: it checks units, constants, and limiting cases independently of the author.
- Use a **review subagent** before finalizing larger changes (type safety, GPU resource leaks, reactivity pitfalls).
- Never let two subagents edit the same file concurrently. The main agent resolves overlaps.

## Physics Guidelines

- Use **SI units internally** (kg, m, s, K, W, T). Convert only at the UI boundary (solar masses, solar radii, km, gauss, etc.).
- Define constants once in `src/physics/constants.ts` using CODATA / IAU nominal values (G, c, σ, M☉, R☉, L☉, T☉). Never inline magic numbers.
- Every formula gets a short comment with its name and the source or assumption. Mark approximations explicitly (e.g. `// approx: valid for 0.43 M☉ < M < 2 M☉`).
- Prefer derived values over independent ones: density from mass and radius, luminosity from `4πR²σT⁴`, and so on. Keep sliders consistent with the physics, and make "unlock" overrides explicit.
- Respect physical limits and regimes:
    - Neutron stars: ~1.1–2.3 M☉ (TOV limit), radius ~10–13 km, no ordinary main-sequence relations.
    - White dwarfs: below the Chandrasekhar limit (~1.4 M☉).
    - Main-sequence relations (`L ∝ M^α`, lifetime scaling) only apply within their valid mass ranges and use piecewise exponents where appropriate.
- Rendering must follow the physics: color from blackbody temperature (not hand-picked hex values), limb darkening, and exposure based on actual luminosity.
- Magnetic fields are dipole-based (`B ∝ 1/r³`, field lines `r = L·sin²θ`). Do not invent field shapes for visual flair.
- Add unit tests for physics functions, including limiting cases (the Sun must come out as the Sun).

## TypeScript Guidelines

- Use the **latest stable TypeScript** and keep `tsconfig` on `strict` plus:
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`.
- Prefer modern features: `satisfies`, `const` type parameters, `using` / `await using` for disposable GPU resources, discriminated unions, template literal types, `Object.groupBy`, `structuredClone`, and inferred type predicates.
- **No `any`, no `@ts-ignore`, no non-null `!` assertions.** Use `unknown` plus narrowing, or `@ts-expect-error` with a reason where unavoidable.
- No `enum`. Use `as const` objects or string-literal unions.
- Model star types as a **discriminated union** so each type carries only the fields that make sense for it.
- Use **branded types** for physical units where mixing them up is a risk (e.g. `Kilograms`, `Meters`, `Kelvin`).
- Prefer `readonly`, immutable data and pure functions in `physics/`. Keep side effects in stores and the render layer.
- ES modules only. Use `import type` for type-only imports.

## Vue / Pinia / Vite Guidelines

- Vue 3.5+ with `<script setup lang="ts">` only. No Options API.
- Use modern APIs: `defineModel`, reactive props destructure, `useTemplateRef`, typed `defineEmits` / `defineSlots`.
- Pinia **setup stores** with full type inference. Keep stores small and split by concern (`star`, `simulation`, `view`). No business logic in components.
- **Performance rule:** the render loop must not depend on Vue reactivity per frame. Use `shallowRef` / `markRaw` for GPU objects, and read store values into plain uniforms. Never put Three.js or GPU objects in deep reactive state.
- Dispose everything on unmount: geometries, materials, textures, buffers, listeners, `requestAnimationFrame` loops, and `ResizeObserver`s.
- Use Vite env and config conventions. Don't add dependencies without a clear reason, and prefer the platform over libraries.

## Rendering Guidelines

- Detect WebGPU first, fall back to WebGL2, and keep both paths working. Never assume WebGPU.
- Keep shaders in dedicated files (`src/render/shaders/`) with documented uniforms and units.
- *Real* view mode uses physically based exposure; *Filter* mode is the only place for artificial attenuation.
- Zoom is logarithmic. Handle huge scale ranges (neutron star at ~10 km up to a giant at ~10⁹ km) without precision loss, using camera-relative rendering or scale normalization.

## Code Style

- Small, focused modules with clear names. Prefer clarity over cleverness.
- Comment *why*, not *what*. Physics comments should cite formula and assumptions.
- Keep UI text and units consistent (solar units in the UI, SI in the code).
- Update `README.md` when features, controls, or the physics model change.

## Don'ts

- Don't fake physics for looks without labeling it as an artistic option.
- Don't use magic numbers or unlabeled unit conversions.
- Don't use `any`, `@ts-ignore`, or `!`.
- Don't leak GPU resources or leave render loops running after unmount.
- Don't add heavy dependencies when a small utility will do.
- Don't mark a task complete with failing type-check or build.