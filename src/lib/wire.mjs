// Wire-agency (syndicated) copy detection. Wire copy never counts as independent corroboration.
const WIRE_URL = /\/wireStory\//i;
const WIRE_DATELINE = /\((AP|Reuters|AFP)\)\s*[—–-]/;
// Byline naming a wire agency. Acronyms are matched case-sensitively to avoid false positives.
const WIRE_BYLINE_WORDS = /\b(the\s+)?associated\s+press\b|\breuters\b|\bagence\s+france[\s-]+presse\b/i;
const WIRE_BYLINE_ACRONYMS = /\b(AP|AFP)\b/;

export function isWireByline(author) {
  if (!author) return false;
  const a = String(author);
  return WIRE_BYLINE_WORDS.test(a) || WIRE_BYLINE_ACRONYMS.test(a);
}

/** @param {{url?:string, summary?:string|null, author?:string|null}} a */
export function isWireCopy({ url, summary, author } = {}) {
  return WIRE_URL.test(url || '') || WIRE_DATELINE.test(summary || '') || isWireByline(author);
}
