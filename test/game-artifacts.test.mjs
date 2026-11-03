import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { createArtifact } from '../game/artifacts.mjs';

function harness(html) {
  const ids = [
    'observations', 'claim', 'source-kind', 'source', 'falsifier',
    'uncertainty', 'next-test', 'add-observation', 'download', 'status'
  ];
  const elements = new Map(ids.map(id => [id, {
    id, value: id === 'source-kind' ? 'unspecified' : '',
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
    constructor(parts, options) { this.parts = parts; this.type = options?.type; }
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

  elements.get('claim').value = 'x'.repeat(501);
  elements.get('source').value = 'source';
  elements.get('add-observation').onclick();
  assert.match(elements.get('status').textContent, /500 Unicode characters/);
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
