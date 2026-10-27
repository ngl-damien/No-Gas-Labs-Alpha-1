import { readBoundedRegularFile } from '../bounded-file-reader.mjs';
import { assertNoDuplicateJsonObjectKeys } from '../strict-json.mjs';

export const MAX_INSTITUTION_REPORT_BYTES = 16 * 1024 * 1024;

/**
 * Load the optional operator-supplied report without unbounded allocation or
 * ambiguous JSON semantics. A byte receipt is not proof that report claims are
 * true; this function only establishes safe, deterministic input parsing.
 */
export async function readInstitutionReport(path) {
  const source = await readBoundedRegularFile(
    path,
    MAX_INSTITUTION_REPORT_BYTES,
    'INSTITUTION_REPORT'
  );
  assertNoDuplicateJsonObjectKeys(source, {
    label: 'INSTITUTION_REPORT',
    maxDepth: 128
  });

  let report;
  try {
    report = JSON.parse(source);
  } catch {
    throw new Error('INSTITUTION_REPORT_INVALID_JSON');
  }
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new Error('INSTITUTION_REPORT_INVALID_ROOT');
  }
  return report;
}
