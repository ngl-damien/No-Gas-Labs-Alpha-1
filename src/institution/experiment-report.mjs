const TRANSFER = 'TRANSFER_OBSERVED_COMPONENT_DELIVERY';
const own = (value, key) => Object.hasOwn(value, key);
const invalid = path => {throw new Error(`Invalid institutional experiment report: ${path}`);};
const record = (value, path) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path);
};
const text = (value, path) => {
  if (typeof value !== 'string' || value.trim().length === 0) invalid(path);
};
const boolean = (value, path) => {if (typeof value !== 'boolean') invalid(path);};
const count = (value, path, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) invalid(path);
};
const duration = (value, path) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(path);
};
const digest = (value, path) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(path);
};
const strings = (value, path) => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) invalid(path);
};

function execution(value, path) {
  record(value, path);
  // Python subprocess return codes are negative when terminated by a signal.
  if (own(value, 'exitCode') && !Number.isSafeInteger(value.exitCode)) invalid(`${path}.exitCode`);
  for (const key of ['passed', 'failed']) if (own(value, key)) boolean(value[key], `${path}.${key}`);
  if (own(value, 'count')) count(value.count, `${path}.count`);
  if (own(value, 'wallMs')) duration(value.wallMs, `${path}.wallMs`);
  for (const key of ['stdoutSHA256', 'stderrSHA256']) if (own(value, key)) digest(value[key], `${path}.${key}`);
  if (own(value, 'command')) {
    strings(value.command, `${path}.command`);
    if (value.command.length === 0 || value.command.some(item => item.trim().length === 0)) invalid(`${path}.command`);
  }
  if (own(value, 'checks')) strings(value.checks, `${path}.checks`);
  if (own(value, 'entryPoint')) text(value.entryPoint, `${path}.entryPoint`);
  if (own(value, 'viewport')) count(value.viewport, `${path}.viewport`, 1);
}

function successful(value, path, requireExit = true) {
  if (value.passed === false || value.failed === true || (own(value, 'exitCode') && value.exitCode !== 0)) invalid(`${path} contradicts acceptance`);
  if (requireExit ? value.exitCode !== 0 : value.passed !== true && value.exitCode !== 0) invalid(`${path} has no passing result`);
}

function outcome(value, requiredFiles, path) {
  record(value, path);
  boolean(value.accepted, `${path}.accepted`);
  boolean(value.integrity, `${path}.integrity`);
  count(value.requiredFiles, `${path}.requiredFiles`, 1);
  if (value.requiredFiles !== requiredFiles) invalid(`${path}.requiredFiles differs from task`);
  count(value.matchedFiles, `${path}.matchedFiles`);
  if (value.matchedFiles > requiredFiles) invalid(`${path}.matchedFiles exceeds requirement`);
  strings(value.errors, `${path}.errors`);
  if (own(value, 'archiveSHA256')) digest(value.archiveSHA256, `${path}.archiveSHA256`);
  if (own(value, 'archiveBytes')) count(value.archiveBytes, `${path}.archiveBytes`);
  if (own(value, 'componentChecks')) text(value.componentChecks, `${path}.componentChecks`);
  for (const key of ['build', 'tests', 'entryPoint', 'kernelSmoke']) if (own(value, key)) execution(value[key], `${path}.${key}`);
  if (!value.accepted) return;
  if (value.integrity !== true || value.errors.length !== 0 || value.matchedFiles !== requiredFiles) invalid(`${path} acceptance lacks integrity or exact coverage`);
  if (!own(value, 'tests')) invalid(`${path}.tests missing`);
  count(value.tests.count, `${path}.tests.count`, 1);
  successful(value.tests, `${path}.tests`);
  if (!own(value, 'entryPoint')) invalid(`${path}.entryPoint missing`);
  successful(value.entryPoint, `${path}.entryPoint`, false);
  for (const key of ['build', 'kernelSmoke']) if (own(value, key)) successful(value[key], `${path}.${key}`);
}

/** Validate retained report consistency only; this does not verify execution. */
export function validateExperimentReport(report) {
  record(report, 'report');
  if (report.schema !== 'ngl.compounding-experiment.v1') invalid('schema');
  text(report.id, 'id');
  if (![TRANSFER, 'INCONCLUSIVE'].includes(report.classification)) invalid('classification');
  boolean(report.sourceIntegrity, 'sourceIntegrity');
  record(report.tasks, 'tasks');
  if (Object.keys(report.tasks).length !== 2 || !own(report.tasks, 'A') || !own(report.tasks, 'B')) invalid('tasks must contain A and B');
  for (const key of ['A', 'B']) {
    const task = report.tasks[key], path = `tasks.${key}`;
    record(task, path);
    text(task.title, `${path}.title`);
    count(task.requiredFiles, `${path}.requiredFiles`, 1);
    if (own(task, 'profileSHA256')) digest(task.profileSHA256, `${path}.profileSHA256`);
    if (own(task, 'artifact')) text(task.artifact, `${path}.artifact`);
    outcome(task.m0, task.requiredFiles, `${path}.m0`);
    outcome(task.m1, task.requiredFiles, `${path}.m1`);
  }
  if (report.classification === TRANSFER && (report.sourceIntegrity !== true || Object.values(report.tasks).some(task => task.m1.accepted !== true || task.m0.accepted !== false || task.m0.integrity !== true))) invalid('TRANSFER classification contradicts outcomes');
  if (!Array.isArray(report.contradictions)) invalid('contradictions');
  for (const [index, contradiction] of report.contradictions.entries()) {
    const path = `contradictions.${index}`;
    record(contradiction, path);
    text(contradiction.statement, `${path}.statement`);
    text(contradiction.disposition, `${path}.disposition`);
    if (own(contradiction, 'evidenceDigest')) digest(contradiction.evidenceDigest, `${path}.evidenceDigest`);
  }
  if (own(report, 'wallMs')) duration(report.wallMs, 'wallMs');
  if (own(report, 'criterion')) text(report.criterion, 'criterion');
  if (own(report, 'recordedAt')) {
    text(report.recordedAt, 'recordedAt');
    if (!Number.isFinite(Date.parse(report.recordedAt))) invalid('recordedAt');
  }
  if (own(report, 'limitations')) strings(report.limitations, 'limitations');
  if (own(report, 'harness')) {
    record(report.harness, 'harness');
    for (const key of ['path', 'python', 'node', 'platform']) if (own(report.harness, key)) text(report.harness[key], `harness.${key}`);
    if (own(report.harness, 'sha256')) digest(report.harness.sha256, 'harness.sha256');
  }
  if (own(report, 'baselineExporterExecution')) execution(report.baselineExporterExecution, 'baselineExporterExecution');
  return report;
}
