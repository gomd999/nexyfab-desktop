/** Max UTF-8 size of uploaded `.scad` source (bytes). */
export const OPENSCAD_MAX_SCAD_BYTES = 512 * 1024;

/** Inline sync response only below this mesh size (bytes). */
export const OPENSCAD_SYNC_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Async job may retain base64 up to this size (still in-process memory; use R2 for larger in production). */
export const OPENSCAD_JOB_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** Default wall-clock limit for one OpenSCAD invocation (ms). */
export const OPENSCAD_DEFAULT_TIMEOUT_MS = 90_000;

/** Job records expire after this TTL (ms). */
export const OPENSCAD_JOB_TTL_MS = 60 * 60 * 1000;

/** Mesh outputs at or above this size (bytes) may be uploaded to object storage when configured. */
export const OPENSCAD_ARTIFACT_MIN_BYTES_FOR_S3 = 512 * 1024;
