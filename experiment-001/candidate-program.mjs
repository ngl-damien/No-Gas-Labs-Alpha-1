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

export function candidateProgramHash(program, version = 'v1') {
  if (version !== 'v1' && version !== 'v2' && version !== 'v3') throw new Error('CANDIDATE_PROGRAM_VERSION_INVALID');
  const normalized = validateCandidateProgram(program);
  const identity = 'ngl-experiment-001:candidate-program:' + version + '\n' + JSON.stringify(normalized);
  return createHash('sha256').update(identity).digest('hex');
}


const MAX_PROOF_DEGREE = 32;
const MAX_PROOF_COEFFICIENT_BITS = 4096;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function trimPolynomial(coefficients) {
  while (coefficients.length > 1 && coefficients.at(-1) === 0n) coefficients.pop();
  return coefficients;
}

function coefficientBitLength(value) {
  const magnitude = value < 0n ? -value : value;
  return magnitude === 0n ? 0 : magnitude.toString(2).length;
}

// Sum |c_i| * M^i is a conservative upper bound for |p(x)| on |x| <= M.
function boundedPolynomialMagnitude(coefficients) {
  const inputBound = BigInt(MAX_INPUT);
  let power = 1n;
  let bound = 0n;
  for (const coefficient of coefficients) {
    const magnitude = coefficient < 0n ? -coefficient : coefficient;
    bound += magnitude * power;
    if (bound > MAX_SAFE_INTEGER_BIGINT) {
      throw new Error('CANDIDATE_PROOF_INTERMEDIATE_OUT_OF_BOUNDS');
    }
    power *= inputBound;
  }
  return bound;
}

/**
 * Prove that a candidate program is exactly x² in the restricted polynomial
 * language. BigInt normal forms avoid floating-point proof arithmetic. A
 * conservative bound is checked at every AST node so runtime intermediates
 * remain safe integers throughout the declared input domain.
 *
 * abs/min/max are intentionally outside this proof language; they remain
 * available to the finite-test v1/v2 strategies.
 */
export function proveCandidateSquareProgram(program) {
  const normalized = validateCandidateProgram(program);
  let maximumIntermediateBound = 0n;

  function visit(node) {
    let coefficients;
    switch (node.op) {
      case 'input':
        coefficients = [0n, 1n];
        break;
      case 'const':
        coefficients = [BigInt(node.value)];
        break;
      case 'negate':
        coefficients = visit(node.arg).map(value => -value);
        break;
      case 'add':
      case 'subtract': {
        const left = visit(node.left);
        const right = visit(node.right);
        const length = Math.max(left.length, right.length);
        const sign = node.op === 'add' ? 1n : -1n;
        coefficients = Array.from({ length }, (_, index) =>
          (left[index] ?? 0n) + sign * (right[index] ?? 0n));
        break;
      }
      case 'multiply': {
        const left = visit(node.left);
        const right = visit(node.right);
        coefficients = Array(left.length + right.length - 1).fill(0n);
        for (let i = 0; i < left.length; i += 1) {
          for (let j = 0; j < right.length; j += 1) {
            coefficients[i + j] += left[i] * right[j];
          }
        }
        break;
      }
      default:
        throw new Error('CANDIDATE_PROOF_UNSUPPORTED_OPERATOR');
    }

    trimPolynomial(coefficients);
    if (coefficients.length - 1 > MAX_PROOF_DEGREE ||
        coefficients.some(value => coefficientBitLength(value) > MAX_PROOF_COEFFICIENT_BITS)) {
      throw new Error('CANDIDATE_PROOF_LIMIT_EXCEEDED');
    }
    const bound = boundedPolynomialMagnitude(coefficients);
    if (bound > maximumIntermediateBound) maximumIntermediateBound = bound;
    return coefficients;
  }

  const coefficients = visit(normalized);
  const matchesSquare = coefficients.length === 3 &&
    coefficients[0] === 0n && coefficients[1] === 0n && coefficients[2] === 1n;

  return Object.freeze({
    schema: 'ngl.candidate-program-proof.v1',
    method: 'exact-integer-polynomial-normal-form',
    inputMin: -MAX_INPUT,
    inputMax: MAX_INPUT,
    limits: Object.freeze({
      maxAstDepth: MAX_DEPTH,
      maxAstNodes: MAX_NODES,
      maxPolynomialDegree: MAX_PROOF_DEGREE,
      maxCoefficientBits: MAX_PROOF_COEFFICIENT_BITS,
      maxSafeInteger: Number.MAX_SAFE_INTEGER
    }),
    coefficients: Object.freeze(coefficients.map(value => value.toString())),
    maxIntermediateAbsoluteBound: maximumIntermediateBound.toString(),
    matchesSquare
  });
}
