// Browser-bundled counterpart of src/strict-json.mjs. Keep this pure utility under game/ because
// scripts/build-game.mjs intentionally rejects browser dependency paths outside the game source tree.
const DEFAULT_MAX_JSON_DEPTH = 128;

/**
 * Reject duplicate JSON object keys before JSON.parse applies last-key-wins
 * semantics. The caller must still JSON.parse the source after this lexical
 * preflight. Key strings are decoded before comparison, so escaped spellings
 * of the same key collide.
 */
export function assertNoDuplicateJsonObjectKeys(source, {
  label = 'JSON',
  maxDepth = DEFAULT_MAX_JSON_DEPTH
} = {}) {
  if (typeof source !== 'string' ||
      typeof label !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(label) ||
      !Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 256) {
    throw new Error('STRICT_JSON_INVALID_CONFIG');
  }
  const fail = code => { throw new Error(label + '_' + code); };
  let index = 0;
  const skipWhitespace = () => {
    while (source[index] === ' ' || source[index] === '\t' || source[index] === '\r' || source[index] === '\n') index += 1;
  };
  const readStringToken = () => {
    if (source[index] !== '"') fail('JSON_INVALID');
    const start = index++;
    while (index < source.length) {
      const character = source[index];
      if (character === '\\') {
        if (index + 1 >= source.length) fail('JSON_INVALID');
        index += 2;
        continue;
      }
      index += 1;
      if (character === '"') return source.slice(start, index);
    }
    fail('JSON_INVALID');
  };
  const parseValue = (depth = 0) => {
    if (depth > maxDepth) fail('JSON_TOO_DEEP');
    skipWhitespace();
    if (source[index] === '{') {
      index += 1;
      skipWhitespace();
      if (source[index] === '}') { index += 1; return; }
      const keys = new Set();
      while (index < source.length) {
        skipWhitespace();
        const token = readStringToken();
        let key;
        try { key = JSON.parse(token); }
        catch { fail('JSON_INVALID'); }
        if (keys.has(key)) fail('DUPLICATE_JSON_KEY');
        keys.add(key);
        skipWhitespace();
        if (source[index] !== ':') fail('JSON_INVALID');
        index += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (source[index] === ',') { index += 1; continue; }
        if (source[index] === '}') { index += 1; return; }
        fail('JSON_INVALID');
      }
      fail('JSON_INVALID');
    }
    if (source[index] === '[') {
      index += 1;
      skipWhitespace();
      if (source[index] === ']') { index += 1; return; }
      while (index < source.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (source[index] === ',') { index += 1; continue; }
        if (source[index] === ']') { index += 1; return; }
        fail('JSON_INVALID');
      }
      fail('JSON_INVALID');
    }
    if (source[index] === '"') { readStringToken(); return; }
    const start = index;
    while (index < source.length &&
      source[index] !== ',' && source[index] !== ']' && source[index] !== '}' &&
      source[index] !== ' ' && source[index] !== '\t' && source[index] !== '\r' && source[index] !== '\n') {
      index += 1;
    }
    if (index === start) fail('JSON_INVALID');
  };

  parseValue();
  skipWhitespace();
  if (index !== source.length) fail('JSON_INVALID');
}
