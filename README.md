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
- **Evolving magnetic-field simulation** (a reduced-order, documented approximation — not MHD): a tilted dipole with closed coronal loops, **bipolar magnetic regions** that emerge, drift and decay, and open polar field lines. Regions host flux-tube loops that shear, then **reconnect** — swapping connectivity, contracting in confined flares or flinging bright **ejecta** outward in eruptions. Open lines wind into a **Parker spiral** whose outer field responds to wind/rotation changes only after the wind travel time. The **Magnetic field** slider has real effects: a stronger field raises the confinement radius, magnetic tension, stored energy and response speed, while a weaker field is opened by the wind. Plasma-flow particles trace the open field by arc length.
- **Stellar-wind controls**: wind speed, mass-loss rate, rotation period and magnetic tilt — a faster wind straightens the field, faster rotation winds it up. Sub-second (millisecond) rotation periods are supported for compact stars. An independent **magnetic clock** (days per second) plays the field dynamics without ageing the star.
- **Rotation shapes the star**: centrifugal flattening is computed from real physics, `q = Ω²R³/(GM) = 3Ω²/(4πGρ)`, so a fast-spinning, low-density star visibly bulges into an oblate spheroid (and is flagged once it passes the mass-shedding limit).
- **Physically driven surface inhomogeneity**: convection cell size follows the photospheric pressure scale height `H_p ≈ k_B·T/(μm_H·g)`, so cool giants get a few huge cells and broad cool regions while dwarfs keep fine granulation — and magnetic spots are kept separate from convective dark regions. Granulation is rendered as irregular bright granules split by narrow dark **intergranular lanes** (two cellular-noise octaves plus a coarser network), with a fragment-level level-of-detail fade so a distant disc is smooth instead of shimmering. Hot massive stars and compact objects are handled as their own regimes rather than being forced through the solar granulation law. Giant cells also produce **real 3D relief**: vertices are displaced by the convective height field (amplitude `≈1.5·H_p/R`) with a gradient-perturbed normal, so the photosphere has actual bumps and indentations visible on the limb.
- **Rotation-driven starspot population**: active regions **emerge, grow, drift and decay** on their own surface clock (separate from stellar aging), each a bipolar group of tens of small **pores** around one or two dominant spots, with a dark **umbra**, a warm **penumbra** and bright **faculae** hugging the plage. Spots have irregular (non-circular) boundaries, follow the solar latitude-dependent (differential) rotation law — the equator races, the poles lag — and their colour and contrast come from the blackbody at the spot temperature (umbra ≈ 0.66·T_eff, penumbra ≈ 0.87·T_eff), not a hand-picked tint. Their number and area come from a **Rossby-number activity model** (`Ro = P_rot/τ_conv`): a faster rotator is more spotted, and **Auto activity** derives the level from the star's rotation. At solar maximum the Sun shows several dozen individual spots and an estimated Wolf number R ≈ 150. A cycle-phase control migrates the active belt equatorward (butterfly diagram); the fully evolving 11-year cycle is not yet modelled.
- **Grouped sunspot data in the UI**: the panel reports the activity regime, Rossby number and convective turnover time, the live spot count and spotted area, and an estimated sunspot number (`R = Ns + 10·Ng`).
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
- **Optional star ambience**: a soft procedural drone whose *pitch follows size*, *brightness follows temperature*, *pulse rate follows rotation* and *texture follows magnetic field and activity*. Fast-spinning neutron stars get a faster, gently pulsing heartbeat, but always as an explicitly artistic sonification — bounded and compressed so extreme stars add texture, not volume
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
| **Magnetic dynamics controls** | Toggle the field simulation, pause/resume, set the magnetic clock (days per second) and activity, enable **event focus** (slows time during a fast event), reset; reports regions, bundles, reconnections/flares/eruptions, ejecta, max loop twist, open winding, magnetic pressure, wind ram pressure, plasma β, confinement radius, Alfvén crossing time and free/released magnetic energy |
| **Sunspot controls** | Toggle the simulation, pause/resume surface drift, set activity (auto from rotation or manual), cycle phase and surface-time speed, reset |
| **Field lines / particles / corona toggles** | Show or hide each layer |
| **HDR bloom / lens flare toggles** | Toggle the camera-optics effects |
| **Starfield / pulsar toggles** | Show or hide the background and compact-star beams |
| **Tone mapping selector** | Switch between *AgX* and *Neutral* (Khronos PBR Neutral) |
| **Auto-exposure + compensation** | Eye adaptation, or manual exposure offset in stops |
| **Fit star button** | Reframe the camera on the star |
| **View mode toggle** | Switch between *Real* and *Filter* |
| **Sound toggle / ambience controls** | Enable the optional star hum, set its volume and a *Calm ↔ Dynamic* character |

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
- **Photosphere (sphere)**: physics-driven convection detail — cell size, contrast, lane depth, granule variation, giant-cell blending and evolution speed come from the surface model (see below). Granulation is two octaves of cellular noise (irregular bright granules with narrow dark lanes) plus a coarse network, boiling slowly in time and faded by screen-space level of detail. Giant cells geometrically displace the surface (**3D bumps/indentations**) with a gradient-perturbed normal; plus faculae tied to active regions, the linear limb-darkening law `I(μ) = 1 − u(1 − μ)`, mild limb **reddening**, and blackbody colour from the **Planckian locus**. Convective dark regions and the evolving magnetic-spot layer are separate.
- **Sunspots**: a bounded, preallocated layer of irregular caps on the photosphere. Each spot is a direction plus the cosines of its plage/penumbra/umbra angular radii, so a fragment needs only a dot product, a cheap trigonometric edge wobble and a few smoothsteps per spot. Up to `MAX_RENDERED_SUNSPOTS` (48) are evaluated per fragment; overlapping spots combine with `max` (never summed, so they don't double-darken) and spots replace the granulated surface rather than being multiplied over it. Their colour and brightness come from the blackbody at the spot temperature, faculae brighten the surrounding plage near the limb, and a small flux-compensation term keeps the disc's total flux consistent as spotted area grows.
- **Photosphere (neutron star)**: the light is bent by gravity. Using the photon invariant `sin α = (b/R)√(1 − u)` and **Beloborodov's approximation** `1 − cos α = (1 − u)(1 − cos ψ)`, each screen pixel is mapped to the surface point actually seen — including the far side (`ψ > 90°`), so more than half the surface is visible. `u = r_s/R` is computed from the mass and radius.
- **Corona / chromosphere**: a soft camera-facing billboard (diffuse corona with fractal streamers) plus a thin red **chromosphere rim** and **prominences**, gated to Filter mode since that is when they are really visible.
- **Pulsar jet**: a long-lived particle outflow, not a solid cone. Packets launch into a narrow cone about the spin axis (nudged by the magnetic tilt) and travel ballistically for a long time so a developed, collimated jet forms. Rotation appears as phase-locked **helical flutes** — the jet is a twisted, rope-like structure that rotates with the star. Packets are instanced emissive blobs (streaked along their velocity) with per-packet relativistic **Doppler beaming** from the angle to the camera. (Packets represent emitting plasma blobs, not individual particles.)
- **Background**: a procedural starfield with a faint Milky Way band, pinned to the camera so it acts as a fixed reference sky.
- **Magnetic field**: a tilted dipole with closed coronal loops, evolving bipolar regions whose loops shear and reconnect, and open polar field lines wound into a Parker spiral by the wind, with plasma-flow particles sampled by arc length. The shape and evolution are driven by a reduced-order simulation: seeded bipolar regions emerge, drift with latitude-dependent rotation and surface libration, then decay; each hosts flux-tube loops whose signed footpoint shear is driven by differential rotation plus a prescribed turbulent surface motion and relaxed on a 60-day timescale. When the shear crosses a seeded threshold the loops reconnect — swapping connectivity with a neighbour and releasing stored magnetic energy — contracting as a confined flare or, near the confinement radius, launching a bright ejectum. The **field-strength slider** sets magnetic pressure `B²/2μ₀`, tension, free energy, Alfvén speed and the confinement radius, so it changes the simulated behaviour rather than only the colour. Open-line winding uses the wind speed but never below the corotation speed `Ω·r`, and each node sees the rotation rate from `r/v` seconds earlier. Compact objects use prescribed localised shear events instead of differential rotation. See the physics section below for the assumptions.
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
- **Starspot activity**: a solar-calibrated approximation, not an MHD simulation. The number and area of spots come from a **Rossby-number activity model** (`Ro = P_rot/τ_conv`, turnover `τ_conv ≈ 10.4 d` at solar mass, `activity ∝ Ro^−0.8`, saturating at the solar value), so a faster rotator is more spotted and the Sun at solar maximum carries several dozen individual spots (~0.2 % spotted area, estimated `R = Ns + 10·Ng ≈ 150`). Active regions are **bipolar groups** — one or two dominant spots plus a scatter of small pores — emerging in an active-latitude belt that migrates equatorward with the cycle phase (30° → 5°; evolved giants may carry higher-latitude spots at larger sizes). Region areas follow a geometric (top-heavy) distribution, spots follow a fast-emergence/slow-decay lifecycle and larger spots live longer (0.5–30 days). Rotation uses the solar differential law `Ω(λ) = A + B·sin²λ + C·sin⁴λ` (Snodgrass & Ulrich 1990, sidereal; `A = 14.713`, `B = −2.396`, `C = −1.787` °/day), with the wind-store period as the equatorial fiducial period. Spot colour and radiance come from the blackbody at `T_umbra ≈ 0.66·T_eff` and `T_penumbra ≈ 0.87·T_eff`, so contrast is strongest on Sun-like stars. Hot radiative-envelope stars and compact objects host no ordinary spots. Polarity reversals and the fully evolving 11-year cycle are not modelled yet.
- **Magnetic-field dynamics**: a reduced-order, energy-aware, non-MHD model with changing connectivity. **Bipolar magnetic regions** emerge on activity-scaled, seeded absolute times, drift with latitude-dependent rotation and surface libration, and fade through their lifetime (irregular layout comes from region flux, separation and confinement — not per-vertex noise). Each region hosts one to three flux-tube **bundles**; a bundle's signed footpoint shear obeys `dθ/dt = r(t) − θ/τ` with `r` the relative differential-rotation rate `Ω(λ_B) − Ω(λ_A)` (exactly zero for a symmetric dipole) plus a prescribed turbulent surface motion integrated in closed form, and `τ = 60 d`. The loop apex is a damped magnetic-tension spring solved exactly (frequency `v_A/L`), so it responds faster for a stronger field. Free energy is `E ≈ p_B·V·(θ/θ_ref)²` with `p_B = B²/2μ₀`. When `|θ|` crosses a seeded threshold the tube **reconnects**: it swaps its far footpoint with a neighbouring bundle, shear drops below the trigger level, and the released energy is debited from the budget; reconnection is rate-limited by a documented inflow closure (a fraction `0.08` of the local Alfvén speed) plus a short cooldown, so events cannot cascade. The loop then contracts (confined flare) or a bright **ejectum** escapes when a per-bundle deterministic draw — weighted by shear and by weak confinement near the confinement radius `r_conf` (`r⁴ = 2πB₀²R⁶/(μ₀Ṁv)`) — selects eruption. Plasma beta `β = p_th/p_B` uses the documented coronal density and temperature (`10⁻¹² kg/m³`, `1.5×10⁶ K`; compact closed zone `10⁻⁶ kg/m³`); `v_A = B/√(μ₀ρ)` is capped at `c`. Open lines use `Δφ = −∫ Ω/v_out ds` with `v_out = min(max(v_wind, Ωr), c)` (the corotation floor keeps winding bounded inside the light cylinder `R_LC = c/Ω`), and the rotation rate is read `∫ds/v_out` seconds earlier. Compact objects replace rotation with localised shear events that ramp, hold and then decay. Event-focus playback slows simulated time while a fast event is visible; no hidden amplification is applied.
- **Neutron stars**: ~1.4 M☉ in a ~10–12 km radius, density on the order of 10¹⁷ kg/m³, magnetic fields from ~10⁸ G up to ~10¹⁵ G (magnetar territory). Compactness `u = r_s/R ≈ 0.3–0.4` drives the gravitational lensing. Luminosity follows from the blackbody relation, never from the main-sequence relation.

The **constraint modes** decide which relations are enforced:

| Mode | Enforced |
|------|----------|
| Model | `R(M)`, `L(M)`, `T(L, R)`, `ρ(M, R)`, plus the evolution track |
| Sandbox | `ρ(M, R)`, `L(R, T)` |
| Free | none — deviations are reported |

### Aging

For normal stars a time-scale slider advances simulated age as a fraction of the main-sequence lifetime. Luminosity rises monotonically and radius swells on a **mass-dependent** track; temperature is then derived from `L` and `R`, so it changes consistently and turns redder with age. More massive stars swell and redden more than low-mass stars. Neutron stars are treated as stable end-states and don't age in this model.

### Sonification (optional)

There is no sound in space, so the ambience is explicitly an *artistic sonification* of the star's state, not a physics simulation of sound. A small Web Audio graph plays a warm drone (a fundamental plus a fifth, octave, twelfth and double octave) through a gently compressed low-pass chain. The pure, side-effect-free mapping lives in `audio/ambienceModel.ts`:

| Stellar input | Audio parameter | Mapping |
|---------------|-----------------|---------|
| Radius / regime | Drone pitch | Logarithmic, clamped to ~34–108 Hz (bigger stars deeper) |
| Temperature | Filter cutoff + harmonic balance | Logarithmic, clamped; never shrill |
| Rotation period | Pulse rate | Log-mapped to 0.3–6 Hz; slow stars breathe, fast compact stars get a regular heartbeat |
| Magnetic field | Drift + detune shimmer | Stronger fields add slow texture, never level |
| Spot activity | Drift + breath noise | Solar-calibrated activity model drives slow movement |
| Magnetic tilt / spin | Pulse depth, shimmer | Bounded; amplitude pulses never fully gate |

Everything is clamped to fixed ranges, so a magnetar and a millisecond pulsar sound more *textured*, not louder. Changes crossfade over ~1 s, slow movement is generated by LFOs inside the graph (no render-loop coupling), and the audio engine is created lazily on the first user gesture, suspended when the tab is hidden, and disposed on unmount. A *Calm ↔ Dynamic* control biases the amount of movement.

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
    │   ├── ViewModeToggle.vue
    │   └── AudioControls.vue     # Ambience enable, volume, Calm ↔ Dynamic
    ├── composables/
    │   └── useStarAmbience.ts    # App-level audio lifecycle + store wiring
    ├── stores/
    │   ├── star.ts               # Inputs, constraint mode, solver-driven stats
    │   ├── simulation.ts         # Age, time scale, running state
    │   ├── sunspots.ts           # Spot controls + throttled summaries
    │   ├── magnetosphere.ts      # Magnetic playback controls + diagnostics
    │   ├── view.ts               # View mode, zoom, layer/effect toggles
    │   ├── wind.ts               # Wind speed, mass loss, rotation, tilt
    │   └── audio.ts              # Ambience enabled/volume/character + status
    ├── audio/
    │   ├── ambienceModel.ts      # Pure stellar-input → audio-parameter mapping
    │   ├── ambienceModel.test.ts
    │   └── createStarAmbience.ts # Web Audio graph + automation + lifecycle
    ├── simulation/
    │   ├── sunspotSimulation.ts  # Evolving spot clock (emergence/drift/decay)
    │   ├── sunspotSimulation.test.ts
    │   ├── magnetosphereSimulation.ts  # Torsional loops, Parker winding, shear events
    │   └── magnetosphereSimulation.test.ts
    ├── render/
    │   ├── createRenderer.ts     # WebGPU detection + WebGL2 fallback
    │   ├── starMesh.ts           # Photosphere (sphere + lensed disc) + corona
    │   ├── postprocessing.ts     # HDR, exposure, AgX/Neutral tone mapping, dither
    │   ├── exposure.ts           # Auto-exposure (eye adaptation) + metering
    │   ├── pulsar.ts             # Rotating particle jet with Doppler beaming
    │   ├── starfield.ts          # Procedural starfield + Milky Way backdrop
    │   ├── shaders/
    │   │   ├── surfaceDetail.ts     # Shared granulation (cells + lanes), broad cool regions
    │   │   ├── sunspots.ts          # Irregular umbra/penumbra caps + faculae
    │   │   ├── starSurface.ts       # Sphere photosphere, limb law + reddening
    │   │   ├── lensedSurface.ts     # Neutron-star disc + light bending
    │   │   └── corona.ts            # Corona + chromosphere + prominences
    │   ├── magneticField.ts      # Field-line rendering driven by the simulation
    │   └── camera.ts             # Orbit + log zoom + fit + dynamic clipping
    ├── physics/
    │   ├── color.ts              # Blackbody colour from the Planckian locus
    │   ├── relations.ts          # Mass / radius / density / luminosity math
    │   ├── rotation.ts           # Rotational flattening / oblateness (q, density)
    │   ├── surface.ts            # Convection cell size from scale height (regimes)
    │   ├── activity.ts           # Rossby-number starspot activity / population model
    │   ├── sunspots.ts           # Spot lifecycle, differential rotation, contrast, regions
    │   ├── magnetosphere.ts      # Alfvén speed, light cylinder, Parker winding, shear rate
    │   ├── evolution.ts          # Mass-dependent aging track
    │   ├── solver.ts             # Central input → consistent-stats solver
    │   ├── starTypes.ts          # Presets for each star type
    │   ├── starPresets.ts        # Named real-star presets
    │   ├── color.test.ts         # Unit tests (colour, conversions)
    │   ├── relations.test.ts     # Unit tests (limits, scalings)
    │   ├── rotation.test.ts      # Unit tests (oblateness, density coupling)
    │   ├── surface.test.ts       # Unit tests (regimes, cell size)
    │   ├── activity.test.ts      # Unit tests (Rossby number, population, belts)
    │   ├── sunspots.test.ts      # Unit tests (supported, lifecycle, rotation, regions)
    │   ├── magnetosphere.test.ts # Unit tests (Alfvén speed, winding, shear rate)
    │   ├── starPresets.test.ts   # Unit tests (ranges, consistency)
    │   ├── evolution.test.ts
    │   └── solver.test.ts
    └── types/
        ├── star.ts
        ├── magnetosphere.ts
        └── sunspots.ts
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
- [x] Reduced-order magnetic-field simulation (evolving bipolar regions, footpoint shear, Alfvén/tension dynamics, reconnection, eruptions, Parker winding, compact shear events)
- [x] Physics-driven surface inhomogeneity (giant convection cells, cool regions, hot/compact regimes)
- [x] Evolving sunspot simulation (emergence, differential-rotation drift, umbra/penumbra, decay)
- [x] Realistic granulation (irregular bright granules, dark intergranular lanes, screen-space LOD fade)
- [x] Rossby-number starspot activity model with multi-spot regions, automatic activity and faculae
- [ ] Evolving 11-year activity cycle with butterfly migration and polarity reversals
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