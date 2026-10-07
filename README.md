# ✦ Star Simulator

An interactive, browser-based 3D star simulator. Pick a star type, tweak its physical properties with sliders, fast-forward time to watch it age, and visualize its magnetic field, all rendered in real time with **WebGPU** (with automatic **WebGL2** fallback).

> ⚠️ **Warning:** In *Real* view mode the exposure is fixed, so hot, bright stars blow out. That's the point. Use *Filter* mode to actually see what's going on. 😎

---

## Features

- **3D star rendering** using WebGPU, with a WebGL2 fallback when WebGPU isn't available
- **Multiple star types**
    - Main-sequence star (Sun-like and other spectral classes)
    - Neutron star
    - *(planned)* Red giant, white dwarf, magnetar
- **Real-star presets**: pick a well-known star and the simulator instantly sets its mass, radius, temperature, magnetic field and wind. Density and luminosity are derived consistently, so presets always land in a self-consistent Sandbox state.
- **Live stat editing** via a slider panel with three **constraint modes**:
    | Mode | Editable | Derived |
    |------|----------|---------|
    | **Model** | Mass, magnetic field, age | Radius, temperature, luminosity, density (from the mass–luminosity, mass–radius and Stefan–Boltzmann relations) |
    | **Sandbox** | Mass, radius, temperature, magnetic field | Density `ρ = 3M/4πR³`, luminosity `L = 4πR²σT⁴` |
    | **Free** | Everything | Inconsistencies are detected and reported, not hidden |
- **Stellar aging** for normal stars: a gentle time-acceleration control that advances the star along a mass-dependent track (radius, temperature, luminosity and colour all shift; more massive stars swell and redden more)
- **Magnetic-field visualization** with real dynamics: a tilted dipole, closed coronal loops, active-region loops, open polar field lines stretched into a **Parker spiral** by the stellar wind, and plasma-flow particles tracing the open field — plus a **magnetar-style twist** that winds the whole magnetosphere into a helix under heavy rotation and/or a strong field
- **Stellar-wind controls**: wind speed, mass-loss rate, rotation period and magnetic tilt — a faster wind straightens the field, faster rotation winds it up. Sub-second (millisecond) rotation periods are supported for compact stars.
- **Rotation shapes the star**: centrifugal flattening is computed from real physics, `q = Ω²R³/(GM) = 3Ω²/(4πGρ)`, so a fast-spinning, low-density star visibly bulges into an oblate spheroid (and is flagged once it passes the mass-shedding limit).
- **Physically driven surface inhomogeneity**: convection cell size follows the photospheric pressure scale height `H_p ≈ k_B·T/(μm_H·g)`, so cool giants get a few huge cells and broad cool regions while dwarfs keep fine granulation — and magnetic spots are kept separate from convective dark regions. Hot massive stars and compact objects are handled as their own regimes rather than being forced through the solar granulation law. Giant cells also produce **real 3D relief**: vertices are displaced by the convective height field (amplitude `≈1.5·H_p/R`) with a gradient-perturbed normal, so the photosphere has actual bumps and indentations visible on the limb.
- **Two view modes**
  | Mode | Description |
  |------|-------------|
  | **Real** | Physically based exposure. Hot, bright stars blow out. |
  | **Filter** | Simulates a neutral-density solar filter so you can see surface detail, granules, spots, corona and magnetic structures. |
- **Physically motivated light**: temperature-driven surface brightness (`∝ T⁴`), blackbody colour from the **Planckian locus**, limb darkening + limb reddening, a soft billboard corona with a red **chromosphere rim and prominences** (Filter mode), HDR bloom, and a bloom-driven lens flare — all separately toggleable
- **HDR rendering pipeline**: linear **float16** targets → exposure → **AgX** or **Khronos PBR Neutral** tone mapping (hue-preserving, unlike ACES) → sRGB encode → **dithering** to kill banding in the glow gradients
- **Auto-exposure (eye adaptation)**: smoothly adapting exposure as you zoom or change luminosity, with an exposure-compensation slider; can be switched to manual
- **Relativistic neutron stars**: a cheap **Schwarzschild light-bending** model (Beloborodov's approximation) shows more than half the surface at once, plus a **pulsar particle jet** — plasma packets launched along the swept magnetic axis with relativistic Doppler beaming (brighter/bluer when approaching, dimmer/redder when receding)
- **Procedural starfield + Milky Way band** backdrop, so exposure changes read against a fixed sky
- **Scroll wheel zoom** (logarithmic) and radius-driven geometry — change the radius and the star really grows, so you have to zoom out
- Responsive UI built with Vue 3

---

## Tech Stack

| Area | Technology |
|------|------------|
| UI framework | [Vue 3](https://vuejs.org/) (Composition API, `<script setup>`) |
| Language | [TypeScript](https://www.typescriptlang.org/) |
| State management | [Pinia](https://pinia.vuejs.org/) |
| Build tool / dev server | [Vite](https://vitejs.dev/) |
| Type checking | [vue-tsc](https://github.com/vuejs/language-tools/tree/master/packages/tsc) |
| 3D rendering | WebGPU, falling back to WebGL2 (via [Three.js](https://threejs.org/) `WebGPURenderer`) |

---

## Getting Started

### Prerequisites

- Node.js **20+**
- A modern browser. For WebGPU: Chrome / Edge 113+, or recent Firefox / Safari with WebGPU enabled. Everything else falls back to WebGL2.

### Install & run

```bash
git clone https://github.com/<your-user>/star-simulator.git
cd star-simulator
npm install
npm run dev
```

Then open the URL printed by Vite (usually `http://localhost:5173`).

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Vite dev server with HMR |
| `npm run build` | Type-check with `vue-tsc` and create a production build |
| `npm run preview` | Preview the production build locally |
| `npm run type-check` | Run `vue-tsc --noEmit` |
| `npm test` | Run the physics unit tests with [Vitest](https://vitest.dev/) |

---

## Controls

| Input | Action |
|-------|--------|
| **Mouse wheel** | Zoom in / out (logarithmic) |
| **Left mouse drag** | Orbit around the star |
| **Constraint mode selector** | Switch between *Model*, *Sandbox* and *Free* |
| **Mass / radius / temperature slider** | Adjust the primary inputs (availability depends on the constraint mode) |
| **Luminosity / density slider** | Adjust directly in *Free* mode; derived and read-only otherwise |
| **Magnetic field slider** | Surface field strength (10⁻³ G … 10¹⁵ G depending on type) |
| **Real-star preset selector** | Load a known star's parameters instantly |
| **Star type selector** | Switch between star types |
| **Time speed control** | Accelerate stellar aging (main-sequence stars) |
| **Wind speed / mass-loss / rotation / tilt** | Shape the magnetic field and plasma outflow |
| **Field lines / particles / corona toggles** | Show or hide each layer |
| **HDR bloom / lens flare toggles** | Toggle the camera-optics effects |
| **Starfield / pulsar toggles** | Show or hide the background and compact-star beams |
| **Tone mapping selector** | Switch between *AgX* and *Neutral* (Khronos PBR Neutral) |
| **Auto-exposure + compensation** | Eye adaptation, or manual exposure offset in stops |
| **Fit star button** | Reframe the camera on the star |
| **View mode toggle** | Switch between *Real* and *Filter* |

---

## Star Presets

Selecting a preset sets the star's parameters instantly (and switches to Sandbox mode so the values stay self-consistent).

| Category | Stars |
|----------|-------|
| Main sequence | Sun, Proxima Centauri, Barnard's Star, Alpha Centauri A, Sirius A, Altair, Vega, R136a1 |
| Giants | Arcturus, Aldebaran |
| Supergiants | Polaris, Rigel, Deneb, Antares, Betelgeuse, VY Canis Majoris |
| Compact objects | Crab Pulsar, PSR J1748−2446ad, SGR 1806−20 (magnetar) |

Mass, radius and effective temperature are the defining observational inputs; density and luminosity follow from `ρ = 3M/4πR³` and `L = 4πR²σT⁴`. Try **Altair** for the oblateness model, **Betelgeuse**/**VY Canis Majoris** for giant convection cells with 3D relief, and **SGR 1806−20** for the twisted magnetosphere and pulsar jet.

---

## How It Works

### Rendering

At startup the app checks for WebGPU support and initializes the WebGPU renderer; if it's unavailable, it falls back to WebGL2 automatically. Rendering goes through a TSL render pipeline:

- **HDR pipeline**: the scene renders into a linear **float16** target; bloom and the lens flare are extracted from that HDR signal; the output node then applies **exposure → tone mapping → sRGB encode → dither**. AgX or Khronos PBR Neutral are offered because they preserve hue in very bright, saturated colours, where ACES drifts (and blackbody hue *is* the point).
- **Photosphere (sphere)**: physics-driven convection detail — cell size, contrast, giant-cell blending and evolution speed come from the surface model (see below); giant cells geometrically displace the surface (**3D bumps/indentations**) with a gradient-perturbed normal; plus faculae, the linear limb-darkening law `I(μ) = 1 − u(1 − μ)`, limb **reddening**, and blackbody colour from the **Planckian locus**. Convective dark regions and magnetic spots are separate layers.
- **Photosphere (neutron star)**: the light is bent by gravity. Using the photon invariant `sin α = (b/R)√(1 − u)` and **Beloborodov's approximation** `1 − cos α = (1 − u)(1 − cos ψ)`, each screen pixel is mapped to the surface point actually seen — including the far side (`ψ > 90°`), so more than half the surface is visible. `u = r_s/R` is computed from the mass and radius.
- **Corona / chromosphere**: a soft camera-facing billboard (diffuse corona with fractal streamers) plus a thin red **chromosphere rim** and **prominences**, gated to Filter mode since that is when they are really visible.
- **Pulsar jet**: a long-lived particle outflow, not a solid cone. Packets launch into a narrow cone about the spin axis (nudged by the magnetic tilt) and travel ballistically for a long time so a developed, collimated jet forms. Rotation appears as phase-locked **helical flutes** — the jet is a twisted, rope-like structure that rotates with the star. Packets are instanced emissive blobs (streaked along their velocity) with per-packet relativistic **Doppler beaming** from the angle to the camera. (Packets represent emitting plasma blobs, not individual particles.)
- **Background**: a procedural starfield with a faint Milky Way band, pinned to the camera so it acts as a fixed reference sky.
- **Magnetic field**: a tilted dipole with closed coronal loops, active-region loops, and open polar field lines wound into a Parker spiral by the wind, with plasma-flow particles. Under heavy rotation and/or a strong field, the whole magnetosphere is wound about the dipole axis into a twisted, force-free **magnetar-style helix** (twist scales with both `Ω` and `B`).
- **Exposure**: auto-exposure meters the star (adapting smoothly as you zoom or change luminosity); manual mode uses an EV offset. Surface brightness uses the blackbody `∝ T⁴` law, so it is essentially distance-independent for a resolved star.

### Physics model

All physical quantities are SI internally. A single solver (`physics/solver.ts`) turns the editable inputs into a consistent state; nothing is interpolated behind its back.

- **Density**: `ρ = 3M / (4πR³)`
- **Luminosity** (Stefan–Boltzmann): `L = 4πR²σT⁴`
- **Blackbody surface radiance**: `I = σT⁴ / π`
- **Apparent flux**: `F = L / (4πd²)`
- **Blackbody colour**: Planck's law integrated against the CIE 1931 colour-matching functions (Wyman–Sloan–Shirley 2013 fits) → linear sRGB, hue-normalised
- **Main-sequence mass–luminosity relation**: `L ∝ M^3.5` (approximation)
- **Mass–radius relation**: `R ∝ M^0.8` (`M < M☉`), `R ∝ M^0.57` (`M > M☉`)
- **Main-sequence lifetime**: `t ≈ 10 Gyr · (M / M☉)^-2.5` (approximation)
- **Rotational flattening**: rotation parameter `q = Ω²R³/(GM) = 3Ω²/(4πGρ)`, flattening `f ≈ 1.25·q` (first-order, clamped). Low density and fast rotation ⇒ strong oblateness; `q ≥ 0.8` is flagged as mass-shedding.
- **Surface convection**: pressure scale height `H_p ≈ k_B·T_eff/(μ·m_H·g)` with `g = GM/R²`, cell size `≈ 4·H_p`. This is what makes extended (low-density) stars show giant cells. Regimes: cool dwarfs → fine granules; cool giants → few large cells + broad cool regions; hot massive stars → low contrast; neutron stars → smooth (no ordinary convection). Approximate — real granulation also depends on opacity and envelope depth.
- **Neutron stars**: ~1.4 M☉ in a ~10–12 km radius, density on the order of 10¹⁷ kg/m³, magnetic fields from ~10⁸ G up to ~10¹⁵ G (magnetar territory). Compactness `u = r_s/R ≈ 0.3–0.4` drives the gravitational lensing. Luminosity follows from the blackbody relation, never from the main-sequence relation.

The **constraint modes** decide which relations are enforced:

| Mode | Enforced |
|------|----------|
| Model | `R(M)`, `L(M)`, `T(L, R)`, `ρ(M, R)`, plus the evolution track |
| Sandbox | `ρ(M, R)`, `L(R, T)` |
| Free | none — deviations are reported |

### Aging

For normal stars a time-scale slider advances simulated age as a fraction of the main-sequence lifetime. Luminosity rises monotonically and radius swells on a **mass-dependent** track; temperature is then derived from `L` and `R`, so it changes consistently and turns redder with age. More massive stars swell and redden more than low-mass stars. Neutron stars are treated as stable end-states and don't age in this model.

---

## Project Structure

```
star-simulator/
├── index.html
├── vite.config.ts                # Vite + Vitest config
├── tsconfig.json
├── package.json
└── src/
    ├── main.ts
    ├── App.vue
    ├── components/
    │   ├── StarCanvas.vue        # Canvas + renderer lifecycles
    │   ├── ControlPanel.vue      # Sliders, modes, wind & view controls
    │   ├── StarTypeSelector.vue
    │   └── ViewModeToggle.vue
    ├── stores/
    │   ├── star.ts               # Inputs, constraint mode, solver-driven stats
    │   ├── simulation.ts         # Age, time scale, running state
    │   ├── view.ts               # View mode, zoom, layer/effect toggles
    │   └── wind.ts               # Wind speed, mass loss, rotation, tilt
    ├── render/
    │   ├── createRenderer.ts     # WebGPU detection + WebGL2 fallback
    │   ├── starMesh.ts           # Photosphere (sphere + lensed disc) + corona
    │   ├── postprocessing.ts     # HDR, exposure, AgX/Neutral tone mapping, dither
    │   ├── exposure.ts           # Auto-exposure (eye adaptation) + metering
    │   ├── pulsar.ts             # Rotating particle jet with Doppler beaming
    │   ├── starfield.ts          # Procedural starfield + Milky Way backdrop
    │   ├── shaders/
    │   │   ├── surfaceDetail.ts     # Shared granulation + spots
    │   │   ├── starSurface.ts       # Sphere photosphere, limb law + reddening
    │   │   ├── lensedSurface.ts     # Neutron-star disc + light bending
    │   │   └── corona.ts            # Corona + chromosphere + prominences
    │   ├── magneticField.ts      # Dipole, loops, Parker spiral, particles
    │   └── camera.ts             # Orbit + log zoom + fit + dynamic clipping
    ├── physics/
    │   ├── color.ts              # Blackbody colour from the Planckian locus
    │   ├── relations.ts          # Mass / radius / density / luminosity math
    │   ├── rotation.ts           # Rotational flattening / oblateness (q, density)
    │   ├── surface.ts            # Convection cell size from scale height (regimes)
    │   ├── evolution.ts          # Mass-dependent aging track
    │   ├── solver.ts             # Central input → consistent-stats solver
    │   ├── starTypes.ts          # Presets for each star type
    │   ├── starPresets.ts        # Named real-star presets
    │   ├── color.test.ts         # Unit tests (colour, conversions)
    │   ├── relations.test.ts     # Unit tests (limits, scalings)
    │   ├── rotation.test.ts      # Unit tests (oblateness, density coupling)
    │   ├── surface.test.ts       # Unit tests (regimes, cell size)
    │   ├── starPresets.test.ts   # Unit tests (ranges, consistency)
    │   ├── evolution.test.ts
    │   └── solver.test.ts
    └── types/
        └── star.ts
```

---

## Roadmap

- [x] Main-sequence star rendering + sliders
- [x] Neutron star type
- [x] Magnetic field visualization (tilted dipole, loops, Parker spiral, plasma flow)
- [x] Real / Filter view modes
- [x] Time acceleration & mass-dependent aging
- [x] Constraint modes (Model / Sandbox / Free) with consistency checks
- [x] HDR bloom, soft corona and bloom-driven lens flare
- [x] Radius-driven geometry scaling and camera fit
- [x] HDR float16 pipeline, AgX / Khronos PBR Neutral tone mapping, dithering
- [x] Blackbody colour from the Planckian locus (CIE 1931)
- [x] Auto-exposure (eye adaptation)
- [x] Chromosphere rim and prominences (Filter mode)
- [x] Relativistic neutron-star rendering (Beloborodov light bending) + pulsar particle jet
- [x] Rotation-driven oblateness (density-coupled) with sub-second compact-star rotation
- [x] Magnetar-style twisted magnetosphere (rotation + field strength)
- [x] Physics-driven surface inhomogeneity (giant convection cells, cool regions, hot/compact regimes)
- [x] Real-star presets (Sun, Sirius, Vega, Betelgeuse, Crab Pulsar, magnetar, …)
- [x] Procedural starfield / Milky Way backdrop
- [ ] Red giant & white dwarf stages
- [ ] Magnetar preset (extreme field + flares)
- [ ] Spectral class presets (O, B, A, F, G, K, M)
- [ ] Shareable star configurations via URL
- [ ] Mobile touch controls (pinch to zoom)

---

## Browser Support

| Browser | Renderer |
|---------|----------|
| Chrome / Edge 113+ | WebGPU |
| Firefox / Safari (recent) | WebGPU (if enabled) or WebGL2 |
| Older browsers | WebGL2 |

---

## Contributing

Issues and PRs are welcome. Before opening a PR, please run:

```bash
npm test
npm run type-check
npm run build
```

---

## License

MIT, see [LICENSE](./LICENSE).