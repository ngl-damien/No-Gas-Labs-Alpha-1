import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createArtifact } from '../game/artifacts.mjs';
import { parseSourceObservatoryExport, sourceObservationRequestMaterial } from '../game/research-records.mjs';

function harness(html) {
  const ids = [
    'observations', 'claim', 'source-kind', 'source', 'falsifier',
    'uncertainty', 'next-test', 'add-observation', 'download', 'backup-file', 'backup-file-label', 'native-file-note', 'preview-restore', 'restore', 'restore-preview', 'status'
  ];
  const elements = new Map(ids.map(id => [id, {
    id, value: id === 'source-kind' ? 'unspecified' : '', files: [], disabled: id === 'restore', hidden: id === 'restore-preview' || id === 'native-file-note',
    textContent: '', className: '', children: [],
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    dispatchEvent(event) { this.lastEvent = event; if (typeof this.onchange === 'function') this.onchange(event); return true; },
    click() { this.clicked = true; }
  }]));
  const document = {
    getElementById(id) { return elements.get(id) || null; },
    createElement(tag) {
      return {
        tag, textContent: '', className: '', children: [],
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        click() { this.clicked = true; }
      };
    },
    documentElement: { dataset: {} }
  };
  let downloaded = null;
  const parentMessages = [];
  const messageListeners = [];
  const parent = {
    postMessage(message, targetOrigin, transfer) {
      parentMessages.push({ message, targetOrigin, transfer: transfer || [] });
    }
  };
  const window = {
    parent,
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
    }
  };
  const bytesOf = part => {
    if (typeof part === 'string') return Buffer.from(part, 'utf8');
    if (part instanceof ArrayBuffer) return Buffer.from(new Uint8Array(part));
    if (ArrayBuffer.isView(part)) return Buffer.from(part.buffer, part.byteOffset, part.byteLength);
    return Buffer.from(String(part), 'utf8');
  };
  class BlobFixture {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options?.type;
      this.bytes = Buffer.concat(parts.map(bytesOf));
      this.size = this.bytes.length;
    }
    async arrayBuffer() {
      return this.bytes.buffer.slice(this.bytes.byteOffset, this.bytes.byteOffset + this.bytes.byteLength);
    }
    async text() { return this.bytes.toString('utf8'); }
  }
  class FileFixture extends BlobFixture {
    constructor(parts, name, options) {
      super(parts, options);
      this.name = name;
    }
  }
  class DataTransferFixture {
    constructor() {
      const files = [];
      this.files = files;
      this.items = { add(file) { files.push(file); } };
    }
  }
  const URLFixture = {
    createObjectURL(blob) { downloaded = blob; return 'blob:observatory-test'; },
    revokeObjectURL() {}
  };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'the recipe must contain its local interaction script');
  runInNewContext(script, {
    document, Blob: BlobFixture, File: FileFixture, DataTransfer: DataTransferFixture,
    URL: URLFixture, window, TextEncoder, ArrayBuffer, Event, setTimeout: () => 0
  });
  async function dispatchParentMessage(data, origin = 'https://appassets.androidplatform.net') {
    await Promise.all(messageListeners.map(listener => listener({ source: parent, origin, data })));
  }
  return { elements, getDownloaded: () => downloaded, parentMessages, dispatchParentMessage };
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
  assert.match(html, /id="preview-restore"/);
  assert.match(html, /id="restore-preview"/);
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
  assert.match(html, /Choose a downloaded notebook/);
  assert.match(html, /Preview reads and validates the backup without changing notes/);
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
  await elements.get('preview-restore').onclick();
  assert.equal(elements.get('restore').disabled, false);
  assert.equal(elements.get('observations').children.length, 1, 'preview must not mutate the notebook');
  elements.get('restore').onclick();

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
  await elements.get('preview-restore').onclick();
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
  await elements.get('preview-restore').onclick();
  assert.equal(elements.get('restore').disabled, false);
  elements.get('restore').onclick();
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
    await elements.get('preview-restore').onclick();
    assert.equal(elements.get('observations').children.length, 1);
    assert.match(elements.get('status').textContent, /schema or assurance is not supported/);
  }
  elements.get('backup-file').files = [{ size: 10, text: async () => '{not json' }];
  await elements.get('preview-restore').onclick();
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
  await elements.get('preview-restore').onclick();
  assert.equal(read, false);
  assert.match(elements.get('status').textContent, /no larger than 2 MiB/);
  const oversizedContent = ' '.repeat(2 * 1024 * 1024 + 1);
  elements.get('backup-file').files = [{ size: 1, text: async () => oversizedContent }];
  await elements.get('preview-restore').onclick();
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
  await elements.get('preview-restore').onclick();
  assert.equal(elements.get('restore').disabled, true, 'an all-duplicate preview must not offer an append action');
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
  await elements.get('preview-restore').onclick();
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
  await elements.get('preview-restore').onclick();
  assert.equal(elements.get('observations').children.length, 1, 'the empty-notebook placeholder remains until explicit append');
  assert.equal(elements.get('restore').disabled, false);
  elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 100);
  assert.match(elements.get('status').textContent, /Added 100 local observation/);
});


test('Source Observatory previews exact additions and requires explicit append', async () => {
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
      claim: '<img src=x onerror=alert(1)>',
      source: 'A user-selected backup label.',
      sourceKind: 'model-assertion',
      falsifier: 'A reproducible counterexample.',
      uncertainty: 'No independent verification.',
      nextTest: 'Inspect the primary source.'
    }]
  };
  const raw = JSON.stringify(backup);
  elements.get('backup-file').files = [{
    size: Buffer.byteLength(raw, 'utf8'),
    text: async () => raw
  }];
  elements.get('backup-file').onchange();
  await elements.get('preview-restore').onclick();

  assert.equal(elements.get('observations').children.length, 1, 'preview must leave the empty-notebook placeholder untouched');
  assert.match(elements.get('observations').children[0].textContent, /No observations recorded/);
  assert.equal(elements.get('restore').disabled, false);
  assert.equal(elements.get('restore-preview').hidden, false);
  const previewText = elements.get('restore-preview').children.map(child =>
    [child.textContent, ...(child.children || []).map(item => item.textContent)].join(' ')
  ).join('\n');
  assert.match(previewText, /<img src=x onerror=alert\(1\)>/);
  const previewEntry = elements.get('restore-preview').children[3].children[0];
  assert.equal(previewEntry.tag, 'li');
  assert.equal(previewEntry.children.length, 0, 'untrusted preview text must not create nested elements');
  assert.match(previewText, /user-supplied declarations/);
  assert.match(elements.get('status').textContent, /Preview ready: 1 new note/);

  elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 1);
  assert.equal(elements.get('restore').disabled, true);
  assert.equal(elements.get('restore-preview').hidden, true);
  assert.match(elements.get('observations').children[0].children[0].textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(elements.get('observations').children[0].children.some(child => child.tag === 'img'), false);
  assert.match(elements.get('observations').children[0].children[6].textContent, /Restored from a user-selected backup/);
});

test('Source Observatory invalidates a preview when the notebook or selected backup changes', async () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements } = harness(html);
  const makeBackup = claim => JSON.stringify({
    schema: 'ngl.source-observatory.v2',
    assurance: {
      sourceRetrieval: 'NOT_PERFORMED',
      independentVerification: 'NOT_PERFORMED',
      modelAssertions: 'LEADS_ONLY',
      execution: 'NOT_EXECUTED'
    },
    observations: [{
      claim, source: 'A declared backup source', sourceKind: 'unspecified',
      falsifier: null, uncertainty: null, nextTest: null
    }]
  });
  const firstRaw = makeBackup('First preview');
  elements.get('backup-file').files = [{ size: Buffer.byteLength(firstRaw), text: async () => firstRaw }];
  elements.get('backup-file').onchange();
  await elements.get('preview-restore').onclick();
  assert.equal(elements.get('restore').disabled, false);

  const secondRaw = makeBackup('Second selected backup');
  elements.get('backup-file').files = [{ size: Buffer.byteLength(secondRaw), text: async () => secondRaw }];
  elements.get('backup-file').onchange();
  assert.equal(elements.get('restore').disabled, true, 'changing the selected file invalidates a previously valid preview');
  assert.equal(elements.get('restore-preview').hidden, true);
  assert.match(elements.get('status').textContent, /Backup selection changed/);
  await elements.get('preview-restore').onclick();
  assert.equal(elements.get('restore').disabled, false);
  assert.match(elements.get('restore-preview').children[3].children[0].textContent, /Second selected backup/);

  elements.get('claim').value = 'A note added after preview';
  elements.get('source').value = 'Current open artifact';
  elements.get('add-observation').onclick();
  assert.equal(elements.get('restore').disabled, true);
  assert.equal(elements.get('restore-preview').hidden, true);
  assert.match(elements.get('status').textContent, /previous backup preview was invalidated/);

  await elements.get('preview-restore').onclick();
  assert.equal(elements.get('restore').disabled, false);
  elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 2);
  assert.match(elements.get('observations').children[1].children[0].textContent, /Second selected backup/);
});

test('Source Observatory serializes overlapping preview taps and releases controls after read failure', async () => {
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
  const preview = elements.get('preview-restore');
  const first = preview.onclick();
  assert.equal(preview.disabled, true);
  assert.equal(elements.get('backup-file').disabled, true);
  const second = preview.onclick();
  assert.equal(readCount, 1, 'a second tap must not start a concurrent file read');
  resolveRead(raw);
  await Promise.all([first, second]);
  assert.equal(readCount, 1);
  assert.equal(elements.get('observations').children.length, 1, 'preview must leave the empty-notebook placeholder untouched');
  assert.equal(preview.disabled, false);
  assert.equal(elements.get('backup-file').disabled, false);
  assert.equal(elements.get('restore').disabled, false);
  elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 1);

  elements.get('backup-file').files = [{
    size: 1,
    text: async () => { throw new Error('simulated read failure'); }
  }];
  await preview.onclick();
  assert.equal(preview.disabled, false, 'the preview control must recover after a read error');
  assert.equal(elements.get('backup-file').disabled, false, 'the file picker must recover after a read error');
  assert.equal(elements.get('observations').children.length, 1, 'a failed read must not mutate existing notes');
  assert.match(elements.get('status').textContent, /could not be read/);
});

const sourceObservationExport = {
  schema: 'ngl.source-observatory.v2',
  assurance: { sourceRetrieval: 'NOT_PERFORMED', independentVerification: 'NOT_PERFORMED', modelAssertions: 'LEADS_ONLY', execution: 'NOT_EXECUTED' },
  observations: [{
    claim: 'The model says the bridge is open.', sourceKind: 'model-assertion',
    source: 'A model response; no external source retrieved.',
    falsifier: 'Independent inspection finds it closed.',
    uncertainty: 'No independent observation yet.',
    nextTest: 'Inspect the primary source directly.'
  }]
};

test('Source Observatory v2 import parser accepts only the exact bounded and explicitly unverified export', () => {
  const parsed = parseSourceObservatoryExport(JSON.stringify(sourceObservationExport));
  assert.equal(parsed.schema, 'ngl.source-observatory.v2');
  assert.equal(parsed.observations.length, 1);
  assert.equal(parsed.observations[0].sourceKind, 'model-assertion');
  assert.equal(parsed.assurance.modelAssertions, 'LEADS_ONLY');
  assert.throws(() => parseSourceObservatoryExport({ ...sourceObservationExport, surprise: true }), /exact/);
  assert.throws(() => parseSourceObservatoryExport({ ...sourceObservationExport, assurance: { ...sourceObservationExport.assurance, independentVerification: 'VERIFIED' } }), /assurance/);
  assert.throws(() => parseSourceObservatoryExport({ ...sourceObservationExport, observations: [{ ...sourceObservationExport.observations[0], sourceKind: 'administrator' }] }), /source class/);
  assert.throws(() => parseSourceObservatoryExport({ ...sourceObservationExport, observations: [{ ...sourceObservationExport.observations[0], claim: 'x'.repeat(501) }] }), /500/);
});

test('normalized Source Observation identity binds actor, role, selected version and note content', () => {
  const input = { actorId: 'witness-1', actorRole: 'witness', creationId: 'observatory-1', version: 1, ...sourceObservationExport.observations[0] };
  const material = sourceObservationRequestMaterial(input);
  assert.equal(material, sourceObservationRequestMaterial({ ...input }));
  assert.notEqual(material, sourceObservationRequestMaterial({ ...input, actorId: 'witness-2' }));
  assert.notEqual(material, sourceObservationRequestMaterial({ ...input, version: 2 }));
  assert.notEqual(material, sourceObservationRequestMaterial({ ...input, claim: 'A different claim.' }));
  assert.throws(() => sourceObservationRequestMaterial({ ...input, actorRole: 'executor' }), /role/);
});


test('Source Observatory native export requires the trusted parent bridge and preserves the unverified schema', async () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  assert.match(html, /data-ngl-native-file-surface="source-observatory-v2"/);
  const { elements, parentMessages, dispatchParentMessage } = harness(html);
  assert.equal(elements.get('download').hidden, false, 'browser downloads remain available before native opt-in');
  await dispatchParentMessage({ type: 'ngl-native-file-bridge-ready' });
  assert.equal(elements.get('download').hidden, true, 'native mode hides the iframe-owned download control');
  assert.equal(elements.get('backup-file').hidden, true, 'native mode routes file selection through the parent');
  assert.equal(elements.get('native-file-note').hidden, false);

  await dispatchParentMessage({ type: 'ngl-native-file-export-request' });
  const start = parentMessages.find(entry => entry.message.type === 'ngl-native-file-export-start');
  const chunks = parentMessages.filter(entry => entry.message.type === 'ngl-native-file-export-chunk');
  const complete = parentMessages.find(entry => entry.message.type === 'ngl-native-file-export-complete');
  assert.ok(start);
  assert.ok(complete);
  assert.equal(start.message.name, 'source-observatory.json');
  assert.equal(start.message.mime, 'application/json');
  assert.ok(start.message.size > 0 && start.message.size <= 2 * 1024 * 1024);
  const exportedBytes = Buffer.concat(chunks.map(entry => Buffer.from(new Uint8Array(entry.message.bytes))));
  assert.equal(exportedBytes.length, start.message.size);
  const exported = JSON.parse(exportedBytes.toString('utf8'));
  assert.equal(exported.schema, 'ngl.source-observatory.v2');
  assert.deepEqual(exported.assurance, {
    sourceRetrieval: 'NOT_PERFORMED',
    independentVerification: 'NOT_PERFORMED',
    modelAssertions: 'LEADS_ONLY',
    execution: 'NOT_EXECUTED'
  });
  assert.equal(exported.observations.length, 0);
});

test('Source Observatory native import only stages bounded bytes for the existing explicit preview and append flow', async () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements, parentMessages, dispatchParentMessage } = harness(html);
  await dispatchParentMessage({ type: 'ngl-native-file-bridge-ready' });
  const raw = JSON.stringify(sourceObservationExport);
  const bytes = new TextEncoder().encode(raw);
  await dispatchParentMessage({ type: 'ngl-native-file-import-start', name: 'source-observatory.json', size: bytes.byteLength });
  for (let offset = 0; offset < bytes.byteLength; offset += 65536) {
    const chunk = bytes.slice(offset, Math.min(offset + 65536, bytes.byteLength)).buffer;
    await dispatchParentMessage({ type: 'ngl-native-file-import-chunk', bytes: chunk });
  }
  await dispatchParentMessage({ type: 'ngl-native-file-import-complete' });

  const received = parentMessages.find(entry => entry.message.type === 'ngl-native-file-import-received');
  assert.equal(received?.message?.type, 'ngl-native-file-import-received');
  assert.equal(received?.message?.name, 'source-observatory.json');
  assert.equal(received?.message?.size, bytes.byteLength);
  assert.equal(elements.get('backup-file').files.length, 1);
  assert.equal(await elements.get('backup-file').files[0].text(), raw);
  assert.equal(elements.get('restore').disabled, true, 'native receipt alone does not append notes');
  await elements.get('preview-restore').onclick();
  assert.equal(elements.get('restore').disabled, false, 'the exact existing parser enables explicit append after preview');
  assert.equal(elements.get('observations').children.length, 1, 'preview does not mutate the notebook');
  elements.get('restore').onclick();
  assert.equal(elements.get('observations').children.length, 1);
  const rendered = elements.get('observations').children[0].children.map(child => child.textContent).join('\\n');
  assert.match(rendered, /The model says the bridge is open/);
  assert.match(rendered, /Model assertion: lead only, not evidence/);
  assert.match(elements.get('status').textContent, /NOT_PERFORMED/);
});

test('Source Observatory native import rejects wrong-origin and oversized transfer messages without staging a file', async () => {
  const { html } = createArtifact({ kind: 'observatory', title: 'The Source Observatory' });
  const { elements, dispatchParentMessage } = harness(html);
  await dispatchParentMessage({ type: 'ngl-native-file-bridge-ready' }, 'https://untrusted.example');
  assert.equal(elements.get('download').hidden, false, 'a different parent origin cannot enable native mode');
  await dispatchParentMessage({ type: 'ngl-native-file-bridge-ready' });
  await dispatchParentMessage({ type: 'ngl-native-file-import-start', name: 'too-large.json', size: 2 * 1024 * 1024 + 1 });
  assert.equal(elements.get('backup-file').files.length, 0);
  assert.match(elements.get('status').textContent, /2 MiB notebook limit/);
});
