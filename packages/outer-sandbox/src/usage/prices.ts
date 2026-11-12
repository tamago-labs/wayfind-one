// Central price book for metered calls. One place — tools and the usage
// reporter reference these, never hardcode prices inline.
//
// Known prices: Muse Image is a flat $0.01 per generated image; Meta
// web_search grounding is $0.0025 per query on top of token cost; Meta voice
// transcription is $0.18 per audio hour (whole seconds). Everything
// else records quantities (tokens, calls, seconds) with cost computed when
// rates are known; unknown rates mean "tracked, not yet priced".
export const IMAGE_USD_EACH = 0.01;

/** Meta web_search grounding: $2.50 per 1,000 queries, on top of token cost. */
export const GROUNDED_SEARCH_USD_EACH = 0.0025;

/** Meta voice-transcribe-1.0: $0.18 per audio hour, whole seconds rounded down. */
export const VOICE_USD_PER_SEC = 0.18 / 3600;

export type UsageKind =
  | 'chat'
  | 'grounded_search'
  | 'voice'
  | 'image'
  | 'read_file'
  | 'websearch'
  | 'summarize';

export type UsageUnit = 'tokens' | 'images' | 'seconds' | 'calls' | 'chars';
