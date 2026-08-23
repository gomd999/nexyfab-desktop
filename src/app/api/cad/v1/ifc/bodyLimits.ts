export const MAX_INLINE_IFC_BYTES = 20 * 1024 * 1024;

/**
 * Valid IFC STEP physical files are printable text plus governed whitespace.
 * A JSON client may nevertheless encode Unicode as `\uXXXX`; a non-BMP scalar
 * then occupies at most three times its original UTF-8 bytes.  These finite
 * envelopes preserve a full-size IFC document (or pair) plus JSON field and
 * bounded auxiliary-input overhead without weakening the 20 MiB per-IFC cap.
 */
export const MAX_SINGLE_IFC_JSON_BYTES = 64 * 1024 * 1024;
export const MAX_PAIR_IFC_JSON_BYTES = 128 * 1024 * 1024;
