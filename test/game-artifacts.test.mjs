import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createArtifact } from '../game/artifacts.mjs';

function harness(html) {
  const ids = [
    'observations', 'claim', 'source-kind', 'source', 'falsifier',
    'uncertainty', 'next-test', 'add-observation', 'download', 'backup-file', 'restore', 'status'
  ];
  const elements = new Map(ids.map(id => [id, {
    id, value: id === 'source-kind' ? 'unspecified' : '', files: [], disabled: false,
    textContent: '', className: '', children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    click() { this.clicked = true; }
  }]));
  const document = {
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) {
      return {
        tag, textContent: '', className: '', children: [],
        append(...children) { this.children.push(...children); },
        click() { this.clicked = true; }
      };
    },
    documentElement: { dataset: {} }
  };
  let downloaded = null;
  class BlobFixture {
    constructor(parts, options) { this.parts = parts; this.type = options?.type; this.size = Buffer.byteLength(parts.map(String).join(''), 'utf8'); }
  }
  const URLFixture = {
    createObjectURL(blob) { downloaded = blob; return 'blob:observatory-test'; },
    revokeObjectURL() {}
  };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'the recipe must contain its local interaction script');
  runInNewContext(script, {
    document, Blob: BlobFixture, URL: URLFixture, setTimeout: () => 0
  });
  return { elements, getDownloaded: () => downloaded };
}

test('Source Observatory starts empty rather than inventing a starter observation', () => {
  const { html, checks } = createArtifact({
    kind: 'observatory',
    title: 'The Source Observatory',
    intent: 'Keep a falsifiable claim beside its source and uncertainty.'
  });
  assert.ok(checks.every(check => check.passed));
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /id="falsifier"/);
  assert.match(html, /id="next-test"/);
  assert.match(html, /Model assertion \(lead only; not evidence\)/);
  assert.match(html, /MAX_OBSERVATIONS=100/);
  assert.match(html, /MAX_FIELD_CHARACTERS=500/);
  assert.match(html, /maxlength="1000"/);
  assert.doesNotMatch(html, /\bfetch\s*\(/);
  assert.doesNotMatch(html, /\bXMLHttpRequest\b|\bWebSocket\b|sendBeacon/);

  const { elements } = harness(html);
  const empty = elements.get('observations').children[0];
  assert.match(empty.textContent, /does not invent a starter claim or source/);
});

test('Source Observatory records falsifiers and provenance without upgrading model output to evidence', () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements, getDownloaded } = harness(html);
  elements.get('claim').value = 'The model claim is correct.';
  elements.get('source-kind').value = 'model-assertion';
  elements.get('source').value = 'A model response, not an external source.';
  elements.get('falsifier').value = 'A reproducible counterexample.';
  elements.get('uncertainty').value = 'No independent observation has been made.';
  elements.get('next-test').value = 'Inspect the primary source and attempt reproduction.';
  elements.get('add-observation').onclick();

  const card = elements.get('observations').children[0];
  const rendered = card.children.map(child => child.textContent).join('\n');
  assert.match(rendered, /Possible falsifier: A reproducible counterexample/);
  assert.match(rendered, /Model assertion: lead only, not evidence/);
  assert.match(rendered, /not independently verified/);
  assert.equal(elements.get('status').textContent.includes('No source was fetched'), true);

  elements.get('download').onclick();
  const notes = JSON.parse(getDownloaded().parts[0]);
  assert.equal(notes.schema, 'ngl.source-observatory.v2');
  assert.deepEqual(notes.assurance, {
    sourceRetrieval: 'NOT_PERFORMED',
    independentVerification: 'NOT_PERFORMED',
    modelAssertions: 'LEADS_ONLY',
    execution: 'NOT_EXECUTED'
  });
  assert.equal(notes.observations.length, 1);
  assert.equal(notes.observations[0].sourceKind, 'model-assertion');
  assert.equal(notes.observations[0].falsifier, 'A reproducible counterexample.');
  assert.equal(notes.observations[0].nextTest, 'Inspect the primary source and attempt reproduction.');
});

test('Source Observatory preserves partial unknowns as null and keeps user text inert', () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements, getDownloaded } = harness(html);
  const untrustedClaim = '<img src=x onerror=alert(1)>';
  elements.get('claim').value = untrustedClaim;
  elements.get('source-kind').value = 'unspecified';
  elements.get('source').value = 'User-supplied label';
  elements.get('add-observation').onclick();
  const card = elements.get('observations').children[0];
  assert.equal(card.children[0].textContent, '1. ' + untrustedClaim);
  assert.equal(card.children.some(child => child.tag === 'img'), false);

  elements.get('download').onclick();
  const notes = JSON.parse(getDownloaded().parts[0]);
  assert.equal(notes.observations[0].falsifier, null);
  assert.equal(notes.observations[0].uncertainty, null);
  assert.equal(notes.observations[0].nextTest, null);
});

test('Source Observatory enforces required attribution, Unicode bounds and the observation cap', () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements } = harness(html);
  elements.get('claim').value = 'A claim without a source';
  elements.get('add-observation').onclick();
  assert.equal(elements.get('observations').children.length, 1);
  assert.match(elements.get('status').textContent, /claim and its source/);

  elements.get('claim').value = String.fromCodePoint(0x1f600).repeat(501);
  elements.get('source').value = 'source';
  elements.get('add-observation').onclick();
  assert.match(elements.get('status').textContent, /500 Unicode code points/);
  assert.equal(elements.get('observations').children.length, 1);

  for (let index = 0; index < 100; index += 1) {
    elements.get('claim').value = 'Claim ' + index;
    elements.get('source').value = 'Source ' + index;
    elements.get('add-observation').onclick();
  }
  assert.equal(elements.get('observations').children.length, 100);
  elements.get('claim').value = 'One too many';
  elements.get('source').value = 'Source 101';
  elements.get('add-observation').onclick();
  assert.equal(elements.get('observations').children.length, 100);
  assert.match(elements.get('status').textContent, /at most 100 observations/);
});
test('Source Observatory discloses local-only notes and rejects unlisted or prototype source classes', () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  assert.match(html, /Notes remain local to this open artifact/);
  assert.match(html, /Restore a downloaded notebook/);
  assert.match(html, /Restoration appends to the open notebook/);
  const { elements } = harness(html);
  for (const sourceKind of ['constructor', '__proto__', 'toString', 'unexpected']) {
    elements.get('claim').value = 'A bounded claim';
    elements.get('source').value = 'An author-entered source label';
    elements.get('source-kind').value = sourceKind;
    elements.get('add-observation').onclick();
    assert.equal(elements.get('observations').children.length, 1);
    assert.match(elements.get('status').textContent, /Choose a listed source class/);
  }
});

test('Source Observatory accepts 500 supplementary Unicode code points', () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  assert.match(html, /maxlength="1000"/);
  const { elements } = harness(html);
  elements.get('claim').value = String.fromCodePoint(0x1f600).repeat(500);
  elements.get('source').value = 'Primary source label';
  elements.get('add-observation').onclick();
  assert.equal(elements.get('observations').children.length, 1);
  assert.match(elements.get('status').textContent, /Observation added/);
});


test('Source Observatory restores a valid backup by appending bounded, still-unverified notes', async () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements, getDownloaded } = harness(html);
  elements.get('claim').value = 'Current unsaved note';
  elements.get('source').value = 'Current author-entered label';
  elements.get('add-observation').onclick();

  const backup = {
    schema: 'ngl.source-observatory.v2',
    assurance: {
      sourceRetrieval: 'NOT_PERFORMED',
      independentVerification: 'NOT_PERFORMED',
      modelAssertions: 'LEADS_ONLY',
      execution: 'NOT_EXECUTED'
    },
    observations: [{
      claim: 'A model suggested this result.',
      source: 'Model response; no external source retrieved.',
      sourceKind: 'model-assertion',
      falsifier: 'A reproducible counterexample.',
      uncertainty: 'Independent observation is absent.',
      nextTest: 'Inspect a primary source.'
    }]
  };
  const raw = JSON.stringify(backup);
  elements.get('backup-file').files = [{
    size: Buffer.byteLength(raw, 'utf8'),
    text: async () => raw
  }];
  await elements.get('restore').onclick();

  assert.equal(elements.get('observations').children.length, 2);
  const imported = elements.get('observations').children[1];
  const rendered = imported.children.map(child => child.textContent).join('\n');
  assert.match(rendered, /A model suggested this result/);
  assert.match(rendered, /Model assertion: lead only, not evidence/);
  assert.match(rendered, /not independently verified/);
  assert.match(elements.get('observations').children[0].children[1].textContent, /selected in this artifact/);
  assert.match(elements.get('observations').children[0].children[6].textContent, /Entered in this open artifact · not independently verified/);
  assert.match(imported.children[1].textContent, /declared in backup; not independently verified/);
  assert.match(imported.children[6].textContent, /Restored from a user-selected backup · original authorship not independently verified/);
  assert.match(elements.get('status').textContent, /NOT_PERFORMED/);
  assert.match(elements.get('status').textContent, /not canonical events, evidence, XP or approval/);

  // Replaying the same backup is idempotent within this open notebook.
  elements.get('backup-file').files = [{
    size: Buffer.byteLength(raw, 'utf8'),
    text: async () => raw
  }];
  await elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 2);
  assert.match(elements.get('status').textContent, /No new notes/);

  // A later backup may overlap earlier content. Append only the one new exact-content entry;
  // duplicates inside the same backup are also skipped because v2 has no per-note ID.
  const newNote = {
    claim: 'New note from a later backup',
    source: 'Second source label',
    sourceKind: 'primary-source',
    falsifier: 'A conflicting primary source.',
    uncertainty: null,
    nextTest: 'Compare the referenced document.'
  };
  const overlapBackup = {
    ...backup,
    observations: [
      ...backup.observations,
      {
        claim: 'Current unsaved note',
        source: 'Current author-entered label',
        sourceKind: 'unspecified',
        falsifier: null,
        uncertainty: null,
        nextTest: null
      },
      newNote,
      { ...newNote }
    ]
  };
  const overlapRaw = JSON.stringify(overlapBackup);
  elements.get('backup-file').files = [{
    size: Buffer.byteLength(overlapRaw, 'utf8'),
    text: async () => overlapRaw
  }];
  await elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 3);
  assert.match(elements.get('status').textContent, /Added 1 local observation\(s\); skipped 3 exact-content duplicate\(s\)/);
  const merged = elements.get('observations').children[2];
  assert.match(merged.children[0].textContent, /New note from a later backup/);
  assert.match(merged.children[6].textContent, /Restored from a user-selected backup/);

  elements.get('download').onclick();
  const exported = JSON.parse(getDownloaded().parts[0]);
  assert.equal(exported.observations.length, 3);
  assert.deepEqual(Object.keys(exported.observations[2]).sort(), [
    'claim', 'falsifier', 'nextTest', 'source', 'sourceKind', 'uncertainty'
  ]);
});

test('Source Observatory rejects forged assurance, unknown fields and malformed backup data without mutation', async () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements } = harness(html);
  elements.get('claim').value = 'Keep this current note';
  elements.get('source').value = 'Existing source label';
  elements.get('add-observation').onclick();
  const valid = {
    schema: 'ngl.source-observatory.v2',
    assurance: {
      sourceRetrieval: 'NOT_PERFORMED',
      independentVerification: 'NOT_PERFORMED',
      modelAssertions: 'LEADS_ONLY',
      execution: 'NOT_EXECUTED'
    },
    observations: [{
      claim: 'Bounded claim', source: 'Author label', sourceKind: 'unspecified',
      falsifier: null, uncertainty: null, nextTest: null
    }]
  };
  const forged = structuredClone(valid);
  forged.assurance.independentVerification = 'VERIFIED';
  const extraField = structuredClone(valid);
  extraField.observations[0].verified = true;
  const malformed = structuredClone(valid);
  malformed.observations[0].claim = '';
  const prototypeClass = structuredClone(valid);
  prototypeClass.observations[0].sourceKind = '__proto__';
  const emptyBackup = structuredClone(valid);
  emptyBackup.observations = [];
  for (const candidate of [forged, extraField, malformed, prototypeClass, emptyBackup]) {
    const raw = JSON.stringify(candidate);
    elements.get('backup-file').files = [{ size: Buffer.byteLength(raw, 'utf8'), text: async () => raw }];
    await elements.get('restore').onclick();
    assert.equal(elements.get('observations').children.length, 1);
    assert.match(elements.get('status').textContent, /schema or assurance is not supported/);
  }
  elements.get('backup-file').files = [{ size: 10, text: async () => '{not json' }];
  await elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 1);
  assert.match(elements.get('status').textContent, /not valid JSON/);
});

test('Source Observatory bounds backup bytes and refuses imports beyond the local observation cap', async () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements } = harness(html);
  let read = false;
  elements.get('backup-file').files = [{
    size: 2 * 1024 * 1024 + 1,
    text: async () => { read = true; return '{}'; }
  }];
  await elements.get('restore').onclick();
  assert.equal(read, false);
  assert.match(elements.get('status').textContent, /no larger than 2 MiB/);
  const oversizedContent = ' '.repeat(2 * 1024 * 1024 + 1);
  elements.get('backup-file').files = [{ size: 1, text: async () => oversizedContent }];
  await elements.get('restore').onclick();
  assert.match(elements.get('status').textContent, /content exceeds 2 MiB/);

  for (let index = 0; index < 100; index += 1) {
    elements.get('claim').value = 'Existing claim ' + index;
    elements.get('source').value = 'Existing source ' + index;
    elements.get('add-observation').onclick();
  }
  const duplicateBackup = {
    schema: 'ngl.source-observatory.v2',
    assurance: {
      sourceRetrieval: 'NOT_PERFORMED',
      independentVerification: 'NOT_PERFORMED',
      modelAssertions: 'LEADS_ONLY',
      execution: 'NOT_EXECUTED'
    },
    observations: [{
      claim: 'Existing claim 0', source: 'Existing source 0', sourceKind: 'unspecified',
      falsifier: null, uncertainty: null, nextTest: null
    }]
  };
  const duplicateRaw = JSON.stringify(duplicateBackup);
  elements.get('backup-file').files = [{ size: Buffer.byteLength(duplicateRaw, 'utf8'), text: async () => duplicateRaw }];
  await elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 100);
  assert.match(elements.get('status').textContent, /No new notes/);

  const backup = {
    schema: 'ngl.source-observatory.v2',
    assurance: {
      sourceRetrieval: 'NOT_PERFORMED',
      independentVerification: 'NOT_PERFORMED',
      modelAssertions: 'LEADS_ONLY',
      execution: 'NOT_EXECUTED'
    },
    observations: [{
      claim: 'One more claim', source: 'One more source', sourceKind: 'unspecified',
      falsifier: null, uncertainty: null, nextTest: null
    }]
  };
  const raw = JSON.stringify(backup);
  elements.get('backup-file').files = [{ size: Buffer.byteLength(raw, 'utf8'), text: async () => raw }];
  await elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 100);
  assert.match(elements.get('status').textContent, /exceed the 100-observation limit/);
});


test('Source Observatory restores the full 100-note supplementary-Unicode export within its byte budget', async () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements } = harness(html);
  const maximumField = '😀'.repeat(500);
  const backup = {
    schema: 'ngl.source-observatory.v2',
    assurance: {
      sourceRetrieval: 'NOT_PERFORMED',
      independentVerification: 'NOT_PERFORMED',
      modelAssertions: 'LEADS_ONLY',
      execution: 'NOT_EXECUTED'
    },
    observations: Array.from({ length: 100 }, (_, index) => ({
      claim: String(index).padStart(2, '0') + maximumField.slice(4),
      source: maximumField,
      sourceKind: 'unspecified',
      falsifier: maximumField,
      uncertainty: maximumField,
      nextTest: maximumField
    }))
  };
  const raw = JSON.stringify(backup);
  assert.ok(Buffer.byteLength(raw, 'utf8') < 2 * 1024 * 1024);
  elements.get('backup-file').files = [{
    size: Buffer.byteLength(raw, 'utf8'),
    text: async () => raw
  }];
  await elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 100);
  assert.match(elements.get('status').textContent, /Added 100 local observation/);
});


test('Source Observatory serializes overlapping restore taps and releases the control after read failure', async () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements } = harness(html);
  const backup = {
    schema: 'ngl.source-observatory.v2',
    assurance: {
      sourceRetrieval: 'NOT_PERFORMED',
      independentVerification: 'NOT_PERFORMED',
      modelAssertions: 'LEADS_ONLY',
      execution: 'NOT_EXECUTED'
    },
    observations: [{
      claim: 'A bounded claim',
      source: 'An author-entered label',
      sourceKind: 'unspecified',
      falsifier: null,
      uncertainty: null,
      nextTest: null
    }]
  };
  const raw = JSON.stringify(backup);
  let resolveRead;
  let readCount = 0;
  const pendingRead = new Promise(resolve => { resolveRead = resolve; });
  elements.get('backup-file').files = [{
    size: Buffer.byteLength(raw, 'utf8'),
    text: () => { readCount += 1; return pendingRead; }
  }];
  const restore = elements.get('restore');
  const first = restore.onclick();
  assert.equal(restore.disabled, true);
  const second = restore.onclick();
  assert.equal(readCount, 1, 'a second tap must not start a concurrent file read');
  resolveRead(raw);
  await Promise.all([first, second]);
  assert.equal(readCount, 1);
  assert.equal(elements.get('observations').children.length, 1);
  assert.equal(restore.disabled, false);

  elements.get('backup-file').files = [{
    size: 1,
    text: async () => { throw new Error('simulated read failure'); }
  }];
  await restore.onclick();
  assert.equal(restore.disabled, false, 'the restore control must recover after a read error');
  assert.equal(elements.get('observations').children.length, 1, 'a failed read must not mutate existing notes');
  assert.match(elements.get('status').textContent, /could not be read/);
});
