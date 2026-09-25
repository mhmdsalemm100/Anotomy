# Attribution and licences

The **application code** in this repository (everything outside `public/models/` and
`public/data/`) is released under the [MIT License](LICENSE).

The **anatomical 3D data and texts** keep their own licences. If you redistribute the
models, screenshots or renderings, keep these credits.

## 3D geometry

| Files | Source | Licence |
|---|---|---|
| `public/models/male/*` (most structures) | **Z-Anatomy** — The open source atlas of anatomy, Lluís Vinent. Exported to glTF by [nqwrc/3d-anatomy](https://github.com/nqwrc/3d-anatomy) (commit `8ca3b742`). | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `public/models/male/*` (skin, hair, lips, external ear, kidneys, brain and ventricles, ileum, rectum, mesentery, optic chiasm/tract) | **BodyParts3D 4.0**, © The Database Center for Life Science (DBCLS), via the repackaging in [ashemag/human-atlas](https://github.com/ashemag/human-atlas) (commit `1c38bf35`). | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `public/models/female/*` | **HuBMAP Human Reference Atlas — 3D Reference Organ Set for Female v1.5**, Kristen Browne and Heidi Schlehlein (2023), [doi:10.48539/HBM352.BTSQ.586](https://doi.org/10.48539/HBM352.BTSQ.586), via [ashemag/human-atlas](https://github.com/ashemag/human-atlas) (commit `e6743fa1`). | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

Required attribution strings:

- "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International"
- "Z-Anatomy - The open source atlas of anatomy - CC-BY-SA 4.0"
- "BodyParts3D - The Database Center for Life Science" (as credited inside Z-Anatomy)

Because part of the male model is CC BY-SA 4.0, the combined male model files are distributed
under **CC BY-SA 4.0**. The female model files are **CC BY 4.0**.

### Adaptations

- Z-Anatomy: Draco geometry decoded, node transforms baked, named by their Z-Anatomy
  (Terminologia Anatomica based) names, re-classified into 12 body systems, simplified with
  meshoptimizer (bounded geometric error), re-compressed with EXT_meshopt_compression.
  **Excluded** (not redistributed): the inner ear model (University of Dundee, CC BY-NC-SA 4.0),
  the kidney model (lissiecowley, CC BY-NC 4.0) and the intracranial brain meshes whose licence
  is not stated upstream ("Brainder", UW "White matter").
- BodyParts3D: registered onto the Z-Anatomy skeleton with per-bone ICP and a smooth
  displacement field (`tools/lib/register.mjs`); the skin's inner dermal surface was removed
  and the outer surface fitted to enclose the musculature (`tools/lib/skinfit.mjs`).
- HuBMAP HRA: placenta/umbilical structures removed; labels derived from node ids where missing.

## Texts

- Knowledge-base entries in `src/kb/` are original educational summaries written to agree with
  standard anatomy references (see `src/kb/references.ts`); they do not reproduce text or figures
  from those books.
- Latin names come from the Z-Anatomy `Translations` table (CC BY-SA 4.0).
- `public/data/definitions.json` contains short definitions from **Wikipedia** (CC BY-SA 3.0 /
  GFDL), shown only as a fallback and always with a link to the source article.

## Software

three.js (MIT), three-mesh-bvh (MIT), meshoptimizer (MIT), glTF-Transform (MIT), Draco (Apache-2.0), Vite (MIT).
