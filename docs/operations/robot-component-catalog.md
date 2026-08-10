# Robot production component catalog

Production motor, reducer, and bearing records are not trusted from JSON fields alone. Each component must bind to an evidence file below the manifest directory using a full SHA-256 digest. Production validation also requires confirmed mass data.

```powershell
npm run evidence:robot-component-catalog-validate -- `
  --manifest C:\catalog\manifest.json `
  --output validation-reports\robot-catalog-validation.json
```

The manifest schema is `nexyfab.robot-component-catalog.v1`. Its `artifacts[]` entries contain:

- `path`: evidence file path relative to the manifest
- `sha256`: lowercase or uppercase 64-character SHA-256
- `source`: manufacturer or standards source description
- `mediaType`: optional media type such as `application/pdf`

The validator rejects malformed component records, missing evidence, byte/hash mismatches, duplicate hashes, estimated production mass, and paths that escape the manifest directory, including through symlinks. It reads evidence files without modifying them and writes an immutable validation report.

A valid catalog is not a product release. Joint requirement selection, traceable housing capacity, exact static interference, governed motion, manufacturing checks, STEP round-trip, native CAD evidence, and dual expert approval must also pass.
