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

function dataArray(value) {
  let length;
  let prototype;
  let keys;
  try {
    if (!Array.isArray(value)) invalid();
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    length = descriptor.value;
  } catch {
    invalid();
  }
  if (prototype !== Array.prototype || !Number.isSafeInteger(length) || length < 0 ||
      keys.length !== length + 1 || !keys.includes('length') ||
      keys.some(key => key !== 'length' &&
        (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length))) invalid();

  const result = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result.push(descriptor.value);
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

export function candidateProgramHash(program, version = 'v1', taskSpecification = undefined) {
  if (!['v1', 'v2', 'v3', 'v4', 'v5'].includes(version)) throw new Error('CANDIDATE_PROGRAM_VERSION_INVALID');
  const normalized = validateCandidateProgram(program);
  let identity = 'ngl-experiment-001:candidate-program:' + version + '\n' + JSON.stringify(normalized);
  if (version === 'v5') identity += '\n' + candidateTaskSpecificationDigest(taskSpecification);
  else if (taskSpecification !== undefined) throw new Error('CANDIDATE_TASK_SPEC_NOT_ALLOWED');
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

const PROOF_LIMITS = Object.freeze({
  maxAstDepth: MAX_DEPTH,
  maxAstNodes: MAX_NODES,
  maxPolynomialDegree: MAX_PROOF_DEGREE,
  maxCoefficientBits: MAX_PROOF_COEFFICIENT_BITS,
  maxSafeInteger: Number.MAX_SAFE_INTEGER
});

export function validateCandidateTaskSpecification(specification) {
  try {
    const value = dataObject(specification, [
      'schema', 'id', 'inputMin', 'inputMax', 'proofMethod', 'limits', 'targetCoefficients'
    ]);
    if (value.schema !== 'ngl.candidate-task-spec.v1' ||
        typeof value.id !== 'string' ||
        !/^ngl\.experiment-001\.task:[a-z0-9][a-z0-9._-]{0,63}:v[1-9][0-9]{0,3}$/.test(value.id) ||
        value.inputMin !== -MAX_INPUT ||
        value.inputMax !== MAX_INPUT ||
        value.proofMethod !== 'exact-integer-polynomial-normal-form') {
      throw new Error('CANDIDATE_TASK_SPEC_INVALID');
    }

    const limits = dataObject(value.limits, Object.keys(PROOF_LIMITS));
    if (Object.entries(PROOF_LIMITS).some(([key, expected]) => limits[key] !== expected)) {
      throw new Error('CANDIDATE_TASK_SPEC_INVALID');
    }

    const rawCoefficients = dataArray(value.targetCoefficients);
    if (rawCoefficients.length < 1 || rawCoefficients.length > MAX_PROOF_DEGREE + 1) {
      throw new Error('CANDIDATE_TASK_SPEC_INVALID');
    }
    const coefficients = rawCoefficients.map(coefficient => {
      if (typeof coefficient !== 'string' || coefficient.length > 1235 ||
          !/^(0|-?[1-9]\d*)$/.test(coefficient)) {
        throw new Error('CANDIDATE_TASK_SPEC_INVALID');
      }
      const parsed = BigInt(coefficient);
      if (coefficientBitLength(parsed) > MAX_PROOF_COEFFICIENT_BITS) {
        throw new Error('CANDIDATE_TASK_SPEC_INVALID');
      }
      return parsed;
    });
    if (coefficients.length > 1 && coefficients.at(-1) === 0n) {
      throw new Error('CANDIDATE_TASK_SPEC_INVALID');
    }
    boundedPolynomialMagnitude(coefficients);

    return Object.freeze({
      schema: value.schema,
      id: value.id,
      inputMin: value.inputMin,
      inputMax: value.inputMax,
      proofMethod: value.proofMethod,
      limits: Object.freeze({ ...PROOF_LIMITS }),
      targetCoefficients: Object.freeze(rawCoefficients.slice())
    });
  } catch (error) {
    if (error?.message === 'CANDIDATE_TASK_SPEC_INVALID') throw error;
    throw new Error('CANDIDATE_TASK_SPEC_INVALID');
  }
}

export function candidateTaskSpecificationDigest(specification) {
  const normalized = validateCandidateTaskSpecification(specification);
  const identity = 'ngl-experiment-001:candidate-task-spec:v1\n' + JSON.stringify(normalized);
  return createHash('sha256').update(identity).digest('hex');
}

const QUADRATIC_TARGET = Object.freeze({
  id: 'ngl.experiment-001.target:quadratic-2x2-minus-3x-plus-7:v1',
  coefficients: Object.freeze([7n, -3n, 2n])
});

function analyzeCandidatePolynomial(program) {
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

  return { coefficients: visit(normalized), maximumIntermediateBound };
}

function matchesPolynomial(coefficients, expected) {
  const length = Math.max(coefficients.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    if ((coefficients[index] ?? 0n) !== (expected[index] ?? 0n)) return false;
  }
  return true;
}

/**
 * Prove exact equivalence to x² in the restricted polynomial language.
 * BigInt normal forms avoid floating-point proof arithmetic. A conservative
 * bound is checked at every AST node so runtime intermediates remain safe
 * integers throughout the declared input domain.
 */
export function proveCandidateSquareProgram(program) {
  const { coefficients, maximumIntermediateBound } = analyzeCandidatePolynomial(program);
  return Object.freeze({
    schema: 'ngl.candidate-program-proof.v1',
    method: 'exact-integer-polynomial-normal-form',
    inputMin: -MAX_INPUT,
    inputMax: MAX_INPUT,
    limits: Object.freeze({ ...PROOF_LIMITS }),
    coefficients: Object.freeze(coefficients.map(value => value.toString())),
    maxIntermediateAbsoluteBound: maximumIntermediateBound.toString(),
    matchesSquare: matchesPolynomial(coefficients, [0n, 0n, 1n])
  });
}

/**
 * Prove exact equivalence to the second fixed target, 2x² - 3x + 7.
 * The target is verifier-defined, not supplied by the candidate proposal.
 */
export function proveCandidateQuadraticProgram(program) {
  const { coefficients, maximumIntermediateBound } = analyzeCandidatePolynomial(program);
  return Object.freeze({
    schema: 'ngl.candidate-program-proof.v2',
    target: QUADRATIC_TARGET.id,
    method: 'exact-integer-polynomial-normal-form',
    inputMin: -MAX_INPUT,
    inputMax: MAX_INPUT,
    limits: Object.freeze({ ...PROOF_LIMITS }),
    coefficients: Object.freeze(coefficients.map(value => value.toString())),
    targetCoefficients: Object.freeze(QUADRATIC_TARGET.coefficients.map(value => value.toString())),
    maxIntermediateAbsoluteBound: maximumIntermediateBound.toString(),
    matchesTarget: matchesPolynomial(coefficients, QUADRATIC_TARGET.coefficients)
  });
}


/**
 * Prove exact equivalence to a separately Founder-signed task specification.
 * The target, input interval, proof method, and resource limits are normalized
 * and content-addressed; the candidate program cannot choose its own oracle.
 */
export function proveCandidateTaskProgram(program, taskSpecification) {
  const specification = validateCandidateTaskSpecification(taskSpecification);
  const target = specification.targetCoefficients.map(value => BigInt(value));
  const { coefficients, maximumIntermediateBound } = analyzeCandidatePolynomial(program);
  return Object.freeze({
    schema: 'ngl.candidate-program-proof.v3',
    taskSpecificationId: specification.id,
    taskSpecificationDigest: candidateTaskSpecificationDigest(specification),
    method: specification.proofMethod,
    inputMin: specification.inputMin,
    inputMax: specification.inputMax,
    limits: Object.freeze({ ...PROOF_LIMITS }),
    coefficients: Object.freeze(coefficients.map(value => value.toString())),
    targetCoefficients: Object.freeze(target.map(value => value.toString())),
    maxIntermediateAbsoluteBound: maximumIntermediateBound.toString(),
    matchesTask: matchesPolynomial(coefficients, target)
  });
}


function safeIntegerConstantProgram(value) {
  const base = BigInt(MAX_CONSTANT);
  const negative = value < 0n;
  let magnitude = negative ? -value : value;
  const digits = [];
  do {
    digits.push(Number(magnitude % base));
    magnitude /= base;
  } while (magnitude > 0n);

  let program = { op: 'const', value: digits.at(-1) };
  for (let index = digits.length - 2; index >= 0; index -= 1) {
    program = {
      op: 'add',
      left: {
        op: 'multiply',
        left: program,
        right: { op: 'const', value: MAX_CONSTANT }
      },
      right: { op: 'const', value: digits[index] }
    };
  }
  return negative ? { op: 'negate', arg: program } : program;
}

/**
 * Deterministically synthesize a bounded Horner-form AST for a normalized task.
 * This is a small polynomial compiler, not AI discovery or a general program
 * synthesizer. The returned proof is recomputed from the generated AST.
 */
export function synthesizeCandidateTaskProgram(taskSpecification) {
  const specification = validateCandidateTaskSpecification(taskSpecification);
  const coefficients = specification.targetCoefficients.map(value => BigInt(value));
  let program = safeIntegerConstantProgram(coefficients.at(-1));

  for (let index = coefficients.length - 2; index >= 0; index -= 1) {
    program = {
      op: 'multiply',
      left: program,
      right: { op: 'input' }
    };
    if (coefficients[index] !== 0n) {
      program = {
        op: 'add',
        left: program,
        right: safeIntegerConstantProgram(coefficients[index])
      };
    }
  }

  const normalizedProgram = validateCandidateProgram(program);
  const proof = proveCandidateTaskProgram(normalizedProgram, specification);
  if (!proof.matchesTask) throw new Error('CANDIDATE_SYNTHESIS_PROOF_FAILED');
  return Object.freeze({ program: normalizedProgram, proof });
}
