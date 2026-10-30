import { createHash } from 'node:crypto';

const MAX_DEPTH = 12;
const MAX_NODES = 63;
const MAX_CONSTANT = 1_000_000;
const MAX_INPUT = 1_000_000;
const BINARY = new Set(['add', 'subtract', 'multiply', 'min', 'max']);
const UNARY = new Set(['negate', 'abs']);

function invalid() {
  throw new Error('CANDIDATE_PROGRAM_INVALID');
}

function dataObject(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  let prototype;
  let descriptors;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
    keys = Reflect.ownKeys(value);
  } catch {
    invalid();
  }
  if (prototype !== Object.prototype && prototype !== null) invalid();
  if (keys.length !== expectedKeys.length ||
      keys.some(key => typeof key !== 'string' || !expectedKeys.includes(key))) invalid();

  const result = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

/**
 * Validate and freeze a small arithmetic AST. This is data interpretation, not
 * JavaScript evaluation: programs cannot import, loop, access the host, or call code.
 */
export function validateCandidateProgram(program) {
  let nodes = 0;
  function visit(node, depth) {
    nodes += 1;
    if (depth > MAX_DEPTH || nodes > MAX_NODES) {
      throw new Error('CANDIDATE_PROGRAM_LIMIT_EXCEEDED');
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) invalid();
    let opDescriptor;
    try { opDescriptor = Object.getOwnPropertyDescriptor(node, 'op'); }
    catch { invalid(); }
    if (!opDescriptor || !opDescriptor.enumerable || !Object.hasOwn(opDescriptor, 'value') ||
        typeof opDescriptor.value !== 'string') invalid();

    const op = opDescriptor.value;
    if (op === 'input') {
      const value = dataObject(node, ['op']);
      return Object.freeze({ op: value.op });
    }
    if (op === 'const') {
      const value = dataObject(node, ['op', 'value']);
      if (!Number.isSafeInteger(value.value) || Math.abs(value.value) > MAX_CONSTANT) invalid();
      return Object.freeze({ op: value.op, value: value.value });
    }
    if (UNARY.has(op)) {
      const value = dataObject(node, ['op', 'arg']);
      return Object.freeze({ op: value.op, arg: visit(value.arg, depth + 1) });
    }
    if (BINARY.has(op)) {
      const value = dataObject(node, ['op', 'left', 'right']);
      return Object.freeze({
        op: value.op,
        left: visit(value.left, depth + 1),
        right: visit(value.right, depth + 1)
      });
    }
    invalid();
  }
  return visit(program, 0);
}

export function evaluateCandidateProgram(program, input) {
  if (!Number.isSafeInteger(input) || Math.abs(input) > MAX_INPUT) {
    throw new Error('CANDIDATE_INPUT_OUT_OF_BOUNDS');
  }
  const normalized = validateCandidateProgram(program);

  function evaluate(node) {
    if (node.op === 'input') return input;
    if (node.op === 'const') return node.value;
    if (node.op === 'negate') return -evaluate(node.arg);
    if (node.op === 'abs') return Math.abs(evaluate(node.arg));

    const left = evaluate(node.left);
    const right = evaluate(node.right);
    let result;
    switch (node.op) {
      case 'add': result = left + right; break;
      case 'subtract': result = left - right; break;
      case 'multiply': result = left * right; break;
      case 'min': result = Math.min(left, right); break;
      case 'max': result = Math.max(left, right); break;
      default: invalid();
    }
    if (!Number.isSafeInteger(result)) throw new Error('CANDIDATE_RESULT_OUT_OF_BOUNDS');
    return result;
  }

  const result = evaluate(normalized);
  if (!Number.isSafeInteger(result)) throw new Error('CANDIDATE_RESULT_OUT_OF_BOUNDS');
  return result;
}

export function candidateProgramHash(program) {
  const normalized = validateCandidateProgram(program);
  const identity = 'ngl-experiment-001:candidate-program:v1\n' + JSON.stringify(normalized);
  return createHash('sha256').update(identity).digest('hex');
}
