import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {projectCharacter} from '../game/character-sheet.mjs';
import { createWorld, applyAction, publicWorld } from '../game/model.mjs';
import {sourceObservationRequestMaterial} from '../game/research-records.mjs';

const founder={id:'f-1',role:'founder'};
const witness={id:'w-1',role:'witness'};
const t1='2026-10-25T12:00:00.000Z';
const t2='2026-10-25T12:01:00.000Z';
const t3='2026-10-25T12:02:00.000Z';
const t4='2026-10-25T12:03:00.000Z';
const t5='2026-10-25T12:04:00.000Z';
const t6='2026-10-25T12:05:00.000Z';
const t7='2026-10-25T12:06:00.000Z';
const t8='2026-10-25T12:07:00.000Z';
const event=(id,type,actor,at=t1,detail={})=>({id,type,actor,at,...detail});
const receipt=(version)=>({algorithm:'sha256',digest:String(version).padStart(2,'0')+'a'.repeat(62),size:100+version});
function publishedCreation(id,times) {
  const versions=times.map((publishedAt,index)=>({
    id,version:index+1,publishedAt,receipt:receipt(index+1)
  }));
  return {...versions.at(-1),versions:versions.slice(0,-1),title:id,kind:'observatory'};
}
const publication=(id,actor,creationId,version,at,extra={})=>
  event(id,'publish',actor,at,{creationId,version,reward:100,...extra});

test('character XP and level derive from unique publications matched to retained versions',()=>{
  const world={
    xp:999,
    creations:[publishedCreation('c1',[t1,t2,t3])],
    events:[
      publication('p1',founder,'c1',1,t1),
      publication('p2',founder,'c1',2,t2),
      publication('p3',founder,'c1',3,t3)
    ]
  };
  const before=structuredClone(world);
  const record=projectCharacter(world,founder);
  assert.deepEqual(
    [record.xp,record.worldXp,record.level,record.levelStartXp,record.xpIntoLevel,record.nextLevelXp],
    [300,300,2,300,0,600]
  );
  assert.equal(record.skills.find(skill=>skill.id==='maker').count,3);
  assert.equal(record.worldXp, 300);
  assert.deepEqual(world,before);
});

test('institution-wide XP never leaks into a Witness character level',()=>{
  const world={
    xp:300,
    creations:[publishedCreation('founder-work',[t1,t2,t3])],
    events:[
      publication('p1',founder,'founder-work',1,t1),
      publication('p2',founder,'founder-work',2,t2),
      publication('p3',founder,'founder-work',3,t3),
      event('w-note','contribute',witness,t3,{creationId:'founder-work',version:3})
    ],
    contributions:[{id:'n1',actor:witness,creationId:'founder-work',version:3,text:'A real note.',at:t3}]
  };
  const record=projectCharacter(world,witness);
  assert.deepEqual([record.xp,record.worldXp,record.level,record.xpIntoLevel],[0,300,1,0]);
  assert.equal(record.skills.find(skill=>skill.id==='observer').count,1);
  assert.equal(record.skills.find(skill=>skill.id==='maker').count,0);
});

test('ambiguous, duplicated, stale, non-Founder, and malformed publication claims earn no XP',()=>{
  const world={
    xp:700,
    creations:[
      publishedCreation('good',[t1]),
      publishedCreation('ambiguous',[t1]),
      publishedCreation('duplicate-a',[t1]),
      publishedCreation('duplicate-b',[t1]),
      publishedCreation('wrong-time',[t1]),
      publishedCreation('wrong-reward',[t1]),
      publishedCreation('non-founder',[t1]),
      publishedCreation('missing-actor-id',[t1]),
      publishedCreation('blank-actor-id',[t1])
    ],
    events:[
      publication('good-event',founder,'good',1,t1),
      publication('ambiguous-a',founder,'ambiguous',1,t1),
      publication('ambiguous-b',founder,'ambiguous',1,t1),
      publication('duplicate-id',founder,'duplicate-a',1,t1),
      publication('duplicate-id',founder,'duplicate-b',1,t1),
      publication('wrong-time-event',founder,'wrong-time',1,t2),
      publication('wrong-reward-event',founder,'wrong-reward',1,t1,{reward:200}),
      publication('non-founder-event',witness,'non-founder',1,t1),
      publication('missing-actor-id-event',{role:'founder'},'missing-actor-id',1,t1),
      publication('blank-actor-id-event',{id:' ',role:'founder'},'blank-actor-id',1,t1),
      publication('stale-version-event',founder,'good',99,t1),
      event('malformed-event','publish',founder,t1,{creationId:'good',version:1,reward:99})
    ]
  };
  const record=projectCharacter(world,founder);
  assert.equal(record.xp,100);
  assert.equal(record.skills.find(skill=>skill.id==='maker').count,1);
  assert.equal(record.worldXp, 100, 'world XP is projected from the one unique retained publication, not the raw summary total');
  assert.deepEqual(record.inventory.map(item => item.id).sort(), ['good', 'wrong-reward'],
    'a single malformed reward does not erase a retained artifact, while ambiguous publication claims remain excluded');
});

test('skills count only activity joined to retained events for the active character', () => {
  const founderCreation = { ...publishedCreation('founder-place', [t1]), kind: 'custom' };
  const world = {
    xp: 200,
    creations: [founderCreation, publishedCreation('witness-place', [t3])],
    events: [
      publication('p1', founder, 'founder-place', 1, t1),
      event('d1', 'discover', founder, t2, { locationId: 'river' }),
      event('n1', 'contribute', founder, t2, { creationId: 'founder-place', version: 1 }),
      event('r1', 'report', founder, t2, { creationId: 'founder-place', version: 1 }),
      publication('p2', witness, 'witness-place', 1, t3)
    ],
    discoveries: [
      { id: 'd-founder', actor: founder, locationId: 'river', at: t2 },
      { id: 'd-witness', actor: witness, locationId: 'relay', at: t3 }
    ],
    contributions: [
      { id: 'n-founder', actor: founder, creationId: 'founder-place', version: 1, text: 'Note.', at: t2 },
      { id: 'n-witness', actor: witness, creationId: 'founder-place', version: 1, text: 'Other note.', at: t3 }
    ],
    reports: [
      { id: 'r-founder', actor: founder, creationId: 'founder-place', version: 1, text: 'Question.', at: t2 }
    ],
    methods: [
      { id: 'm-witness', actor: witness, creationId: 'witness-place', version: 1, title: 'Repair', description: '', at: t3 }
    ]
  };
  const record = projectCharacter(world, founder);
  assert.deepEqual(record.skills.map(skill => [skill.id, skill.count]), [
    ['maker', 1], ['explorer', 1], ['observer', 1], ['speaker', 0], ['scholar', 0], ['source-recorder', 0], ['retriever', 0],
    ['challenger', 1], ['source-responder', 0], ['collaborator', 0], ['council', 0], ['synthesis', 0], ['researcher', 0], ['experimenter', 0], ['adversary', 0],
    ['questkeeper', 3], ['restorer', 0]
  ]);
  assert.equal(record.xp, 100);
  assert.equal(record.worldXp, 100, 'only the Founder publication with a retained matching event contributes world XP');
});

test('Collaborator skill counts unique actor-scoped Guild response attempts, including rejected attempts', () => {
  const response = (id, responseId, actor, role, validationStatus = 'valid-for-human-review', validator = 'ngl.collaborator-response.v1') =>
    event(id, 'collaborator-response-recorded', actor, t1, {
      responseId, role, moonshotId: 'moon-1', validationStatus, validator
    });
  const world = {
    xp: 999,
    creations: [],
    events: [
      response('founder-valid', 'founder-valid-response', founder, 'adversary'),
      response('founder-rejected', 'founder-rejected-response', founder, 'archivist', 'rejected'),
      response('duplicate-response-a', 'duplicate-response', founder, 'synthesizer'),
      response('duplicate-response-b', 'duplicate-response', founder, 'tutor'),
      response('unknown-role', 'unknown-role-response', founder, 'oracle'),
      response('invalid-status', 'invalid-status-response', founder, 'tutor', 'approved'),
      response('wrong-validator', 'wrong-validator-response', founder, 'synthesizer', 'valid-for-human-review', 'untrusted-validator'),
      response('duplicate-event', 'duplicate-event-response-a', founder, 'adversary'),
      response('duplicate-event', 'duplicate-event-response-b', founder, 'archivist'),
      response('witness-valid', 'witness-valid-response', witness, 'adversary')
    ],
    discoveries: [], contributions: [], reports: [], methods: []
  };
  const before = structuredClone(world);
  const founderRecord = projectCharacter(world, founder);
  const founderSkill = founderRecord.skills.find(skill => skill.id === 'collaborator');
  assert.equal(founderSkill.count, 2, 'valid and rejected retained attempts count; duplicate or malformed records do not');
  assert.equal(founderSkill.record, 'bounded collaborator-response attempts');
  const founderCouncil = founderRecord.skills.find(skill => skill.id === 'council');
  assert.equal(founderCouncil.count, 2, 'Council counts distinct role slots, not total response attempts');
  assert.equal(founderCouncil.record, 'distinct Guild Hall role attempts');
  assert.match(founderCouncil.basis, /Rejected attempts remain preserved attempts, not endorsements/);
  assert.match(founderCouncil.basis, /not consensus, independent humans, source truth, independent observation, approval, authority, mastery or XP/);
  assert.match(founderSkill.basis, /Rejected responses remain preserved attempts, not endorsements/);
  assert.match(founderSkill.basis, /not provider identity, truth, independent observation, execution, mastery, approval, XP or authority/);
  assert.equal(founderRecord.xp, 0, 'collaborator responses do not award XP');

  const witnessRecord = projectCharacter(world, witness);
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'collaborator').count, 1,
    'another actor’s response is not projected into the Founder character');
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'council').count, 1,
    'Council coverage remains actor-scoped and counts the Witness’s one distinct role');
  assert.equal(witnessRecord.xp, 0);
  assert.deepEqual(world, before, 'the skill is a read-only projection of retained response events');
});

test('Study Cards are actor-scoped collectibles derived only from uniquely linked study attempts', () => {
  const world = {
    xp: 999,
    creations: [publishedCreation('study-source', [t1])],
    events: [
      publication('study-publication', founder, 'study-source', 1, t1),
      event('study-founder', 'study', founder, t2, {
        studyId: 'study-1', creationId: 'study-source', version: 1,
        question: 'What does the source establish?',
        attempt: 'I inspected the exact published version.',
        nextCheck: 'Compare the claim with a separate source.'
      }),
      event('study-witness', 'study', witness, t2, {
        studyId: 'study-2', creationId: 'study-source', version: 1,
        question: 'What remains uncertain?',
        attempt: 'I recorded the unresolved point.',
        nextCheck: 'Inspect another source.'
      }),
      event('study-review', 'study-reviewed', founder, t3, {
        reviewId: 'review-1', studyId: 'study-1', creationId: 'study-source', version: 1,
        response: 'The source supports only the narrow wording.',
        reflection: 'A second source is still needed.'
      })
    ],
    discoveries: [], contributions: [], reports: [], methods: []
  };
  const before = structuredClone(world);
  const founderRecord = projectCharacter(world, founder);
  assert.equal(founderRecord.studyCardTotal, 1);
  assert.equal(founderRecord.studyCardOmittedCount, 0);
  assert.equal(founderRecord.studyCardUnavailableCount, 0);
  assert.deepEqual(founderRecord.studyCards.map(card => [
    card.id, card.sourceEventId, card.reviewStatus, card.reviewEventId
  ]), [['study-card:study-1', 'study-founder', 'reflection-recorded', 'study-review']]);
  assert.equal(founderRecord.studyCards[0].title, 'study-source');
  assert.match(founderRecord.studyCards[0].status, /not mastery, evidence, or XP/);
  assert.deepEqual(founderRecord.studyCards[0].action, {
    type: 'creation', creationId: 'study-source', version: 1
  });
  assert.equal(founderRecord.xp, 100, 'the card adds no XP beyond the retained publication');
  assert.equal(projectCharacter(world, witness).studyCards[0].studyId, 'study-2',
    'another actor’s study card is not projected into the Founder collection');
  assert.equal(projectCharacter(world, witness).xp, 0);
  assert.ok(Object.isFrozen(founderRecord.studyCards));
  assert.ok(Object.isFrozen(founderRecord.studyCards[0]));
  assert.ok(Object.isFrozen(founderRecord.studyCards[0].action));
  assert.deepEqual(world, before, 'Study Cards are read-only projections, not new world events');
});

test('duplicate event identities cannot mint Study Cards or mark reflection recorded', () => {
  const duplicateStudy = (studyId, attempt) => event('duplicate-study-event', 'study', founder, t2, {
    studyId, creationId: 'study-source', version: 1,
    question: 'What is known?', attempt, nextCheck: 'Check another source.'
  });
  const duplicateStudyWorld = {
    creations: [publishedCreation('study-source', [t1])],
    events: [
      publication('study-publication', founder, 'study-source', 1, t1),
      duplicateStudy('study-a', 'First attempt.'),
      duplicateStudy('study-b', 'Second attempt.')
    ],
    discoveries: [], contributions: [], reports: [], methods: []
  };
  const unavailable = projectCharacter(duplicateStudyWorld, founder);
  assert.deepEqual(unavailable.studyCards, []);
  assert.equal(unavailable.studyCardTotal, 0);
  assert.equal(unavailable.studyCardUnavailableCount, 2);

  const study = event('study-event', 'study', founder, t2, {
    studyId: 'study-1', creationId: 'study-source', version: 1,
    question: 'What does the source establish?', attempt: 'I inspected the source.',
    nextCheck: 'Compare a separate source.'
  });
  const duplicateReview = (reviewId, studyId) => event('duplicate-review-event', 'study-reviewed', founder, t3, {
    reviewId, studyId, creationId: 'study-source', version: 1,
    response: 'I compared the source.', reflection: 'The result remains provisional.'
  });
  const reviewWorld = {
    creations: [publishedCreation('study-source', [t1])],
    events: [
      publication('study-publication', founder, 'study-source', 1, t1),
      study,
      duplicateReview('review-1', 'study-1'),
      duplicateReview('review-2', 'study-2')
    ],
    discoveries: [], contributions: [], reports: [], methods: []
  };
  const reviewed = projectCharacter(reviewWorld, founder).studyCards;
  assert.equal(reviewed.length, 1);
  assert.equal(reviewed[0].reviewStatus, 'attempt-recorded');
  assert.equal(reviewed[0].reviewEventId, null);
});

test('ambiguous study identities stay in history but cannot manufacture Study Cards', () => {
  const study = (id, attempt) => event(id, 'study', founder, t2, {
    studyId: 'duplicate-study', creationId: 'study-source', version: 1,
    question: 'What is known?', attempt, nextCheck: 'Check a separate source.'
  });
  const world = {
    creations: [publishedCreation('study-source', [t1])],
    events: [
      publication('study-publication', founder, 'study-source', 1, t1),
      study('study-a', 'First attempt.'),
      study('study-b', 'Second ambiguous attempt.')
    ],
    discoveries: [], contributions: [], reports: [], methods: []
  };
  const record = projectCharacter(world, founder);
  assert.deepEqual(record.studyCards, []);
  assert.equal(record.studyCardTotal, 0);
  assert.equal(record.studyCardUnavailableCount, 2);
  assert.equal(record.xp, 100, 'ambiguous cards do not change publication XP');
});

test('Study Card collection is bounded and keeps newest retained attempts in append order', () => {
  const events = [
    publication('study-publication', founder, 'study-source', 1, t1),
    ...Array.from({ length: 101 }, (_, index) => event(
      'study-event-' + index, 'study', founder, t2, {
        studyId: 'study-' + index, creationId: 'study-source', version: 1,
        question: 'Question ' + index, attempt: 'Attempt ' + index,
        nextCheck: 'Check ' + index
      }
    ))
  ];
  const record = projectCharacter({
    creations: [publishedCreation('study-source', [t1])],
    events, discoveries: [], contributions: [], reports: [], methods: []
  }, founder);
  assert.equal(record.studyCardTotal, 101);
  assert.equal(record.studyCards.length, 100);
  assert.equal(record.studyCardOmittedCount, 1);
  assert.equal(record.studyCardUnavailableCount, 0);
  assert.equal(record.studyCards[0].studyId, 'study-100');
  assert.equal(record.studyCards.at(-1).studyId, 'study-1');
});

test('unlinked summary rows cannot manufacture skills, XP, or inventory', () => {
  const world = {
    xp: 900,
    creations: [publishedCreation('spoofed-place', [t1, t2])],
    events: [],
    discoveries: [
      { id: 'fake-discovery', actor: founder, locationId: 'relay', at: t2 }
    ],
    contributions: [
      { id: 'fake-note', actor: founder, creationId: 'spoofed-place', version: 1, text: 'Unlinked note.', at: t2 }
    ],
    reports: [
      { id: 'fake-report', actor: founder, creationId: 'spoofed-place', version: 1, text: 'Unlinked report.', at: t2 }
    ],
    methods: [
      { id: 'fake-method', actor: founder, creationId: 'spoofed-place', version: 2, title: 'Repair', description: 'Unlinked.', at: t2 }
    ]
  };
  const record = projectCharacter(world, founder);
  assert.deepEqual([record.xp, record.worldXp, record.level], [0, 0, 1]);
  assert.deepEqual(record.inventory, []);
  for (const id of ['explorer', 'observer', 'challenger', 'restorer', 'questkeeper']) {
    assert.equal(record.skills.find(skill => skill.id === id).count, 0, id + ' requires retained matching activity');
  }
});

test('a retained publication remains inventory and a valid source even when its XP receipt is invalid', () => {
  const world = {
    xp: 0,
    creations: [publishedCreation('unrewarded-place', [t1])],
    events: [
      event('unrewarded-publication', 'publish', founder, t1, {
        creationId: 'unrewarded-place', version: 1, reward: 0
      }),
      event('note-after-unrewarded-publication', 'contribute', founder, t2, {
        creationId: 'unrewarded-place', version: 1
      })
    ],
    discoveries: [],
    contributions: [{
      id: 'note-record',
      actor: founder,
      creationId: 'unrewarded-place',
      version: 1,
      text: 'The published version can still be inspected.',
      at: t2
    }],
    reports: [],
    methods: []
  };
  const record = projectCharacter(world, founder);
  assert.equal(record.xp, 0);
  assert.equal(record.worldXp, 0);
  assert.equal(record.skills.find(skill => skill.id === 'maker').count, 0);
  assert.equal(record.skills.find(skill => skill.id === 'observer').count, 1);
  assert.deepEqual(record.inventory.map(item => [item.id, item.version]), [['unrewarded-place', 1]]);
});

test('ambiguous activity-to-event joins do not grant Explorer, Observer, or Challenger progress', () => {
  const world = {
    xp: 100,
    creations: [publishedCreation('source-place', [t1])],
    events: [
      publication('p1', founder, 'source-place', 1, t1),
      event('discover-a', 'discover', founder, t2, { locationId: 'relay' }),
      event('discover-b', 'discover', founder, t2, { locationId: 'relay' }),
      event('note-a', 'contribute', founder, t2, { creationId: 'source-place', version: 1 }),
      event('note-b', 'contribute', founder, t2, { creationId: 'source-place', version: 1 }),
      event('report-a', 'report', founder, t2, { creationId: 'source-place', version: 1 }),
      event('report-b', 'report', founder, t2, { creationId: 'source-place', version: 1 })
    ],
    discoveries: [{ id: 'one-discovery', actor: founder, locationId: 'relay', at: t2 }],
    contributions: [{ id: 'one-note', actor: founder, creationId: 'source-place', version: 1, text: 'Note.', at: t2 }],
    reports: [{ id: 'one-report', actor: founder, creationId: 'source-place', version: 1, text: 'Report.', at: t2 }],
    methods: []
  };
  const record = projectCharacter(world, founder);
  assert.equal(record.skills.find(skill => skill.id === 'explorer').count, 0);
  assert.equal(record.skills.find(skill => skill.id === 'observer').count, 0);
  assert.equal(record.skills.find(skill => skill.id === 'challenger').count, 0);
});

test('Restorer requires a unique repair publication matched to its method record', () => {
  const world = {
    xp: 200,
    creations: [publishedCreation('repaired-place', [t1, t3])],
    events: [
      publication('repair-source-v1', founder, 'repaired-place', 1, t1),
      event('repair-action', 'repair', founder, t2, {
        creationId: 'repaired-place', draftId: 'repair-draft', baseVersion: 1
      }),
      publication('repair-source-v2', founder, 'repaired-place', 2, t3)
    ],
    discoveries: [],
    contributions: [],
    reports: [],
    methods: [{
      id: 'repair-method',
      actor: founder,
      creationId: 'repaired-place',
      version: 2,
      title: 'Preserve the earlier version',
      description: 'A checked repair retained version 1.',
      at: t3
    }]
  };
  const record = projectCharacter(world, founder);
  assert.equal(record.skills.find(skill => skill.id === 'restorer').count, 1);
  assert.equal(record.skills.find(skill => skill.id === 'maker').count, 2);
  assert.equal(record.xp, 200);
  assert.equal(record.worldXp, 200);
  assert.equal(record.inventory[0].version, 2);
});

test('published places are world inventory; drafts and other players’ activity are not added to the character trail', () => {
  const world = {
    xp: 200,
    creations: [{
      ...publishedCreation('c1', [t1, t2]),
      receipt: { algorithm: 'sha256', digest: 'b'.repeat(64), size: 12 }
    }],
    drafts: [{ id: 'd1', title: 'Private draft' }],
    events: [
      publication('p1', founder, 'c1', 1, t1),
      publication('p2', founder, 'c1', 2, t2),
      event('w-note', 'contribute', witness, t3, { creationId: 'c1', version: 2 })
    ],
    contributions: [{
      id: 'w-note-record', actor: witness, creationId: 'c1', version: 2,
      text: 'A Witness note.', at: t3
    }]
  };
  const before = structuredClone(world);
  const record = projectCharacter(world, founder);
  assert.deepEqual(record.inventory, [{
    id: 'c1', title: 'c1', kind: 'observatory', version: 2,
    receipt: { digest: 'b'.repeat(64), size: 12 }
  }]);
  assert.deepEqual(record.recentActivity.map(item => item.type), ['publish', 'publish']);
  assert.equal(record.xp, 200);
  assert.equal(record.worldXp, 200);
  assert.deepEqual(world, before);
});

test('missing or malformed records fail closed to empty activity without inventing XP',()=>{
  const record=projectCharacter({},founder);
  assert.equal(record.level,1);
  assert.equal(record.xp,0);
  assert.equal(record.worldXp,0);
  assert.ok(record.skills.every(skill=>skill.count===0));
  assert.deepEqual(record.inventory,[]);
  assert.deepEqual(record.recentActivity,[]);
});

test('character activity fails closed when actor role is missing or unsupported', () => {
  const sharedId = 'reused-actor-id';
  const founderActor = { id: sharedId, role: 'founder' };
  const witnessActor = { id: sharedId, role: 'witness' };
  const world = {
    xp: 200,
    creations: [
      publishedCreation('founder-work', [t1]),
      publishedCreation('witness-work', [t2])
    ],
    events: [
      publication('founder-pub', founderActor, 'founder-work', 1, t1),
      event('founder-discovery-event', 'discover', founderActor, t2, { locationId: 'river' }),
      event('witness-discovery-event', 'discover', witnessActor, t2, { locationId: 'relay' }),
      event('witness-note', 'contribute', witnessActor, t2, {
        creationId: 'witness-work', version: 1
      })
    ],
    discoveries: [
      { id: 'founder-discovery', actor: founderActor, locationId: 'river', at: t2 },
      { id: 'witness-discovery', actor: witnessActor, locationId: 'relay', at: t2 }
    ]
  };

  const ambiguous = projectCharacter(world, { id: sharedId });
  assert.equal(ambiguous.xp, 0);
  assert.ok(ambiguous.skills.every(skill => skill.count === 0));
  assert.deepEqual(ambiguous.recentActivity, []);

  const unsupported = projectCharacter(world, { id: sharedId, role: 'administrator' });
  assert.equal(unsupported.xp, 0);
  assert.ok(unsupported.skills.every(skill => skill.count === 0));
  assert.deepEqual(unsupported.recentActivity, []);

  const founderRecord = projectCharacter(world, founderActor);
  assert.equal(founderRecord.xp, 100);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'explorer').count, 1);

  const witnessRecord = projectCharacter(world, witnessActor);
  assert.equal(witnessRecord.xp, 0);
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'explorer').count, 1);
});

test('Researcher skill counts attributed falsifiable proposals without awarding XP', () => {
  const founderProposal = event('moonshot-f', 'moonshot-proposed', founder, t1, {
    moonshotId: 'moonshot-1',
    title: 'A bounded question',
    hypothesis: 'The claim holds under stated conditions.',
    falsifier: 'A reproducible counterexample appears.',
    evidenceNeeded: 'Independent observation.',
    sourceCreationId: 'source-1',
    sourceVersion: 2
  });
  const witnessProposal = event('moonshot-w', 'moonshot-proposed', witness, t2, {
    moonshotId: 'moonshot-2',
    title: 'A competing question',
    hypothesis: 'The alternative may explain the record.',
    falsifier: 'The alternative fails to predict the observation.',
    evidenceNeeded: 'A retained source and independent check.'
  });
  const world = { xp: 0, creations: [], events: [founderProposal, witnessProposal] };

  const founderRecord = projectCharacter(world, founder);
  const witnessRecord = projectCharacter(world, witness);
  assert.equal(founderRecord.xp, 0);
  assert.equal(witnessRecord.xp, 0);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'researcher').count, 1);
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'researcher').count, 1);
  assert.deepEqual(
    founderRecord.recentActivity.find(activity => activity.type === 'moonshot-proposed') &&
      [founderRecord.recentActivity.find(activity => activity.type === 'moonshot-proposed').creationId,
       founderRecord.recentActivity.find(activity => activity.type === 'moonshot-proposed').version],
    ['source-1', 2]
  );
});


test('Adversary skill counts unique challenges to another actor’s earlier valid report without awarding XP', () => {
  const proposal = event('moonshot-1', 'moonshot-proposed', witness, t1, {
    moonshotId: 'moonshot-1',
    title: 'A falsifiable question',
    hypothesis: 'The claim holds under the stated conditions.',
    falsifier: 'A reproducible counterexample appears.',
    evidenceNeeded: 'An independent observation.'
  });
  const report = event('report-event-1', 'experiment-reported', witness, t2, {
    reportId: 'report-1',
    moonshotId: 'moonshot-1',
    procedure: 'Compare the claim with the stated condition.',
    observation: 'The comparison contradicted the prediction.',
    reportedOutcome: 'contradicts',
    evidenceCreationId: null,
    evidenceVersion: null
  });
  const challenge = event('challenge-event-1', 'experiment-challenged', founder, t3, {
    challengeId: 'challenge-1',
    reportId: 'report-1',
    moonshotId: 'moonshot-1',
    challengeType: 'methodology',
    challengeText: 'The procedure does not control the stated condition.',
    evidenceCreationId: null,
    evidenceVersion: null
  });
  const world = { xp: 0, creations: [], events: [proposal, report, challenge] };
  const founderRecord = projectCharacter(world, founder);
  const witnessRecord = projectCharacter(world, witness);
  assert.equal(founderRecord.xp, 0);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'adversary').count, 1);
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'adversary').count, 0);

  const duplicateChallenge = { ...challenge, id: 'challenge-event-2', at: '2026-10-25T12:03:00.000Z' };
  const ambiguous = projectCharacter({ ...world, events: [...world.events, duplicateChallenge] }, founder);
  assert.equal(ambiguous.skills.find(skill => skill.id === 'adversary').count, 0,
    'duplicate challenge identities are ambiguous and must not count as skill activity');

  const selfChallenge = event('self-challenge-event', 'experiment-challenged', witness, t3, {
    challengeId: 'self-challenge-1',
    reportId: 'report-1',
    moonshotId: 'moonshot-1',
    challengeType: 'contradiction',
    challengeText: 'This is a self-challenge and cannot count.',
    evidenceCreationId: null,
    evidenceVersion: null
  });
  const selfRecord = projectCharacter({ ...world, events: [...world.events, selfChallenge] }, witness);
  assert.equal(selfRecord.skills.find(skill => skill.id === 'adversary').count, 0);
});

test('non-canonical timestamps cannot award publication XP or appear in recent activity', () => {
  const loose = '2026-10-26';
  const world = {
    xp: 0,
    creations: [publishedCreation('loose-time', [loose])],
    events: [publication('loose-publication', founder, 'loose-time', 1, loose)]
  };
  const record = projectCharacter(world, founder);
  assert.equal(record.xp, 0);
  assert.equal(record.skills.find(skill => skill.id === 'maker').count, 0);
  assert.deepEqual(record.recentActivity, []);
});

test('research and adversarial skills require strict timestamps and unique proposal identity', () => {
  const proposal = event('proposal-valid', 'moonshot-proposed', witness, t1, {
    moonshotId: 'moonshot-valid',
    title: 'A bounded question',
    hypothesis: 'The claim holds under stated conditions.',
    falsifier: 'A reproducible counterexample appears.',
    evidenceNeeded: 'An independent observation.'
  });
  const looseProposal = event('proposal-loose', 'moonshot-proposed', founder, '2026-10-26', {
    moonshotId: 'moonshot-loose',
    title: 'A loose-time question',
    hypothesis: 'This must not count.',
    falsifier: 'A strict observation contradicts it.',
    evidenceNeeded: 'A retained source.'
  });
  const duplicateProposal = event('proposal-duplicate', 'moonshot-proposed', founder, t2, {
    moonshotId: 'moonshot-duplicate',
    title: 'Duplicate identity',
    hypothesis: 'This makes the proposal ambiguous.',
    falsifier: 'A counterexample.',
    evidenceNeeded: 'Independent observation.'
  });
  const duplicateProposalSecond = { ...duplicateProposal, id: 'proposal-duplicate-second', at: t3 };
  const looseReport = event('report-loose', 'experiment-reported', witness, '2026-10-27', {
    reportId: 'report-loose',
    moonshotId: 'moonshot-valid',
    procedure: 'Compare a retained claim with a source.',
    observation: 'The result was not reproduced.',
    reportedOutcome: 'failed'
  });
  const validReport = event('report-valid', 'experiment-reported', witness, t2, {
    reportId: 'report-valid',
    moonshotId: 'moonshot-valid',
    procedure: 'Compare the claim with a retained source.',
    observation: 'The source contradicts the prediction.',
    reportedOutcome: 'contradicts'
  });
  const looseChallenge = event('challenge-loose', 'experiment-challenged', founder, '2026-10-28', {
    challengeId: 'challenge-loose',
    reportId: 'report-valid',
    moonshotId: 'moonshot-valid',
    challengeType: 'methodology',
    challengeText: 'The method does not control the stated condition.',
    evidenceCreationId: null,
    evidenceVersion: null
  });
  const world = { xp: 0, creations: [], events: [proposal, looseProposal, duplicateProposal, duplicateProposalSecond, looseReport, validReport, looseChallenge] };
  const founderRecord = projectCharacter(world, founder);
  const witnessRecord = projectCharacter(world, witness);

  assert.equal(founderRecord.skills.find(skill => skill.id === 'researcher').count, 0,
    'malformed and duplicate proposal identities must not count as research activity');
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'researcher').count, 1,
    'only the unique valid proposal counts');
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'experimenter').count, 1,
    'only the strict-timestamp report counts');
  assert.equal(founderRecord.skills.find(skill => skill.id === 'adversary').count, 0,
    'a malformed challenge timestamp cannot count as adversarial activity');
  assert.ok(!founderRecord.recentActivity.some(activity => activity.type === 'moonshot-proposed' && activity.at === '2026-10-26'));
  assert.ok(!witnessRecord.recentActivity.some(activity => activity.type === 'experiment-reported' && activity.at === '2026-10-27'));
});

test('study and retrieval skills reject Date.parse-compatible date-only event times', () => {
  const publicationTime = '2026-10-25T12:00:00.000Z';
  const looseStudyTime = '2026-10-26';
  const world = {
    xp: 0,
    creations: [publishedCreation('study-source', [publicationTime])],
    events: [
      publication('study-source-pub', founder, 'study-source', 1, publicationTime),
      event('study-note-loose', 'study', founder, looseStudyTime, {
        studyId: 'study-loose',
        creationId: 'study-source',
        version: 1,
        question: 'What does the source establish?',
        attempt: 'It establishes only the retained wording.',
        nextCheck: 'Compare the cited passage.'
      }),
      event('study-review-loose', 'study-reviewed', founder, '2026-10-27', {
        reviewId: 'review-loose',
        studyId: 'study-loose',
        creationId: 'study-source',
        version: 1,
        response: 'The source supports only a narrow claim.',
        reflection: 'I need to inspect the exact passage.'
      })
    ]
  };
  const record = projectCharacter(world, founder);
  assert.equal(record.skills.find(skill => skill.id === 'scholar').count, 0);
  assert.equal(record.skills.find(skill => skill.id === 'retriever').count, 0);
  assert.deepEqual(record.recentActivity.map(activity => activity.type), ['publish']);
});


test('character projections preserve challenge and study chronology across a large retained history', () => {
  const unrelated = Array.from({ length: 6000 }, (_, index) =>
    event('unrelated-' + index, 'unrelated', founder, t1)
  );
  const source = publishedCreation('indexed-source', [t1]);
  const proposal = event('indexed-proposal', 'moonshot-proposed', witness, t2, {
    moonshotId: 'indexed-moonshot',
    title: 'A bounded question',
    hypothesis: 'The claim holds under stated conditions.',
    falsifier: 'A reproducible counterexample appears.',
    evidenceNeeded: 'A retained source and independent check.'
  });
  const report = event('indexed-report-event', 'experiment-reported', witness, t3, {
    reportId: 'indexed-report',
    moonshotId: 'indexed-moonshot',
    procedure: 'Compare the claim with the retained source.',
    observation: 'The stated result was not reproduced.',
    reportedOutcome: 'failed',
    evidenceCreationId: null,
    evidenceVersion: null
  });
  const challenge = event('indexed-challenge-event', 'experiment-challenged', founder, '2026-10-25T12:03:00.000Z', {
    challengeId: 'indexed-challenge',
    reportId: 'indexed-report',
    moonshotId: 'indexed-moonshot',
    challengeType: 'methodology',
    challengeText: 'The procedure does not control the stated condition.',
    evidenceCreationId: null,
    evidenceVersion: null
  });
  const study = event('indexed-study-event', 'study', founder, '2026-10-25T12:04:00.000Z', {
    studyId: 'indexed-study',
    creationId: 'indexed-source',
    version: 1,
    question: 'What does the retained source establish?',
    attempt: 'It records a claim but does not independently confirm it.',
    nextCheck: 'Inspect the exact cited passage.'
  });
  const review = event('indexed-review-event', 'study-reviewed', founder, '2026-10-25T12:05:00.000Z', {
    reviewId: 'indexed-review',
    studyId: 'indexed-study',
    creationId: 'indexed-source',
    version: 1,
    response: 'The source establishes only the wording it contains.',
    reflection: 'Independent confirmation remains unknown.'
  });
  const world = {
    xp: 0,
    creations: [source],
    events: [
      ...unrelated,
      publication('indexed-publication', founder, source.id, 1, t1),
      proposal, report, challenge, study, review
    ],
    discoveries: [],
    contributions: [],
    reports: [],
    methods: []
  };
  const before = structuredClone(world);

  const founderRecord = projectCharacter(world, founder);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'adversary').count, 1);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'scholar').count, 1);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'retriever').count, 1);
  assert.equal(founderRecord.xp, 100);

  const witnessRecord = projectCharacter(world, witness);
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'researcher').count, 1);
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'experimenter').count, 1);
  assert.equal(witnessRecord.xp, 0);

  assert.deepEqual(world, before, 'character projection must remain read-only');
});


test('Questkeeper skill mirrors completed source-linked Founder objectives without awarding XP', () => {
  const world = {
    xp: 100,
    creations: [publishedCreation('first-place', [t1])],
    events: [publication('publish-first-place', founder, 'first-place', 1, t1)],
    discoveries: [],
    contributions: [],
    reports: [],
    methods: []
  };
  const record = projectCharacter(world, founder);
  const skill = record.skills.find(item => item.id === 'questkeeper');

  assert.ok(skill);
  assert.equal(skill.count, 2, 'the observatory publication completes both the first-place and source-observatory milestones');
  assert.match(skill.basis, /not truth, mastery, correctness, or approval/i);
  assert.equal(record.xp, 100);
  assert.equal(record.skills.find(item => item.id === 'maker').count, 1);
});

test('Questkeeper skill requires all four uniquely matched Witness guide discoveries', () => {
  const locations = ['relay', 'river', 'overlook', 'ruins'];
  const discoveries = locations.map((locationId, index) => ({
    id: 'discovery-' + index,
    actor: witness,
    locationId,
    at: new Date(Date.parse(t1) + index * 1000).toISOString()
  }));
  const events = discoveries.map((discovery, index) => ({
    id: 'event-' + index,
    type: 'discover',
    actor: witness,
    locationId: discovery.locationId,
    at: discovery.at
  }));
  const world = { xp: 0, creations: [], discoveries, events };
  const record = projectCharacter(world, witness);

  assert.equal(record.skills.find(item => item.id === 'explorer').count, 4);
  assert.equal(record.skills.find(item => item.id === 'questkeeper').count, 1);
  assert.equal(record.xp, 0);
});

test('ambiguous discovery history does not count as a completed Questkeeper objective', () => {
  const locations = ['relay', 'river', 'overlook', 'ruins'];
  const discoveries = locations.map((locationId, index) => ({
    id: 'discovery-' + index,
    actor: witness,
    locationId,
    at: new Date(Date.parse(t1) + index * 1000).toISOString()
  }));
  const events = discoveries.map((discovery, index) => ({
    id: 'event-' + index,
    type: 'discover',
    actor: witness,
    locationId: discovery.locationId,
    at: discovery.at
  }));
  events.push({ ...events[0] });
  const record = projectCharacter({ xp: 0, creations: [], discoveries, events }, witness);

  assert.equal(record.skills.find(item => item.id === 'questkeeper').count, 0);
});


test('activity skills require unique one-to-one record/event joins and real guide locations', () => {
  const source = publishedCreation('activity-source', [t1]);
  const world = {
    xp: 100,
    creations: [source],
    events: [
      publication('activity-source-publication', founder, 'activity-source', 1, t1),
      event('discover-valid', 'discover', founder, t2, { locationId: 'relay' }),
      event('discover-unknown', 'discover', founder, t3, { locationId: 'not-a-guide' }),
      event('discover-repeat', 'discover', founder, t4, { locationId: 'river', repeat: true }),
      event('contribute-valid', 'contribute', founder, t5, { creationId: 'activity-source', version: 1 }),
      event('contribute-ambiguous', 'contribute', founder, t6, { creationId: 'activity-source', version: 1 }),
      event('contribute-duplicate-a', 'contribute', founder, t7, { creationId: 'activity-source', version: 1 }),
      event('contribute-duplicate-b', 'contribute', founder, t7, { creationId: 'activity-source', version: 1 }),
      event('report-valid', 'report', founder, t8, { creationId: 'activity-source', version: 1 })
    ],
    discoveries: [
      { id: 'discovery-valid', actor: founder, locationId: 'relay', at: t2 },
      { id: 'discovery-unknown', actor: founder, locationId: 'not-a-guide', at: t3 },
      { id: 'discovery-repeat', actor: founder, locationId: 'river', at: t4 }
    ],
    contributions: [
      { id: 'note-valid', actor: founder, creationId: 'activity-source', version: 1, text: 'A retained note.', at: t5 },
      { id: 'note-orphan', actor: founder, creationId: 'activity-source', version: 1, text: 'No matching event.', at: '2026-10-25T12:09:00.000Z' },
      { id: 'note-ambiguous-a', actor: founder, creationId: 'activity-source', version: 1, text: 'Ambiguous A.', at: t6 },
      { id: 'note-ambiguous-b', actor: founder, creationId: 'activity-source', version: 1, text: 'Ambiguous B.', at: t6 },
      { id: 'note-duplicate-event', actor: founder, creationId: 'activity-source', version: 1, text: 'Two matching events.', at: t7 }
    ],
    reports: [
      { id: 'report-valid', actor: founder, creationId: 'activity-source', version: 1, text: 'A retained report.', at: t8 }
    ],
    methods: []
  };

  const record = projectCharacter(world, founder);
  assert.equal(record.skills.find(skill => skill.id === 'explorer').count, 1,
    'only a unique discovery of an authored guide location counts');
  assert.equal(record.skills.find(skill => skill.id === 'observer').count, 1,
    'orphaned records, duplicate record joins, and duplicate event joins do not count');
  assert.equal(record.skills.find(skill => skill.id === 'challenger').count, 1);
  assert.equal(record.xp, 100);
});


test('Restorer requires one unique earlier repair event joined to the published revision', () => {
  const world = {
    xp: 200,
    creations: [publishedCreation('repaired-source', [t1, t3])],
    events: [
      publication('repair-source-v1', founder, 'repaired-source', 1, t1),
      event('repair-attempt', 'repair', founder, t2, {
        creationId: 'repaired-source', draftId: 'repair-draft-1', baseVersion: 1
      }),
      publication('repair-source-v2', founder, 'repaired-source', 2, t3)
    ],
    discoveries: [],
    contributions: [],
    reports: [],
    methods: [{
      id: 'method-v2', actor: founder, creationId: 'repaired-source', version: 2,
      title: 'Checked repair', description: 'A retained revision.', at: t3
    }]
  };

  const valid = projectCharacter(world, founder);
  assert.equal(valid.skills.find(skill => skill.id === 'restorer').count, 1);

  const ambiguous = structuredClone(world);
  ambiguous.events.splice(2, 0, event('second-repair-attempt', 'repair', founder,
    '2026-10-25T12:01:30.000Z', {
      creationId: 'repaired-source', draftId: 'repair-draft-2', baseVersion: 1
    }));
  const rejected = projectCharacter(ambiguous, founder);
  assert.equal(rejected.skills.find(skill => skill.id === 'restorer').count, 0,
    'two earlier repairs for the same base version make the method-to-publication join ambiguous');
});

test('Source Recorder skill counts only the actor\'s uniquely linked notes and grants no XP', () => {
  const creationId = 'source-observatory-character';
  const creation = publishedCreation(creationId, [t1]);
  const note = {
    claim: 'A model says the bridge is open.',
    sourceKind: 'model-assertion',
    source: 'Model output only; no source retrieved.',
    falsifier: 'A direct inspection finds it closed.',
    uncertainty: 'No independent observation.',
    nextTest: 'Inspect the bridge.'
  };
  const digest = createHash('sha256').update(sourceObservationRequestMaterial({
    actorId: founder.id, actorRole: founder.role, creationId, version: 1, ...note
  })).digest('hex');
  const observation = event('source-observation-event', 'source-observation-recorded', founder, t2, {
    observationId: 'source-observation-' + digest,
    creationId, version: 1, ...note,
    originSchema: 'ngl.source-observatory.v2',
    bindingMode: 'USER_SELECTED',
    sourceRetrieval: 'NOT_PERFORMED',
    independentVerification: 'NOT_PERFORMED',
    modelAssertions: 'LEADS_ONLY',
    execution: 'NOT_EXECUTED',
    normalizedRecordDigest: digest
  });
  const world = {
    xp: 999,
    creations: [creation],
    events: [publication('publish-source-observatory', founder, creationId, 1, t1), observation]
  };
  const founderRecord = projectCharacter(world, founder);
  assert.equal(founderRecord.xp, 100);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'source-recorder').count, 1);
  const witnessRecord = projectCharacter(world, witness);
  assert.equal(witnessRecord.xp, 0);
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'source-recorder').count, 0);
});

test('Challenger skill counts a different actor’s retained Source Observation challenge without awarding XP', () => {
  const creationId = 'observatory-challenge';
  const note = {
    claim: 'The bridge is open.',
    sourceKind: 'model-assertion',
    source: 'A model response; no primary source retrieved.',
    falsifier: 'Direct inspection finds it closed.',
    uncertainty: 'No independent observation.',
    nextTest: 'Inspect the primary source.'
  };
  const digest = createHash('sha256').update(sourceObservationRequestMaterial({
    actorId: founder.id, actorRole: founder.role, creationId, version: 1, ...note
  })).digest('hex');
  const observationId = 'source-observation-' + digest;
  const world = {
    xp: 100,
    creations: [publishedCreation(creationId, [t1])],
    events: [
      publication('challenge-publish', founder, creationId, 1, t1),
      event('challenge-source-note', 'source-observation-recorded', founder, t2, {
        observationId, creationId, version: 1, ...note,
        originSchema: 'ngl.source-observatory.v2', bindingMode: 'USER_SELECTED',
        sourceRetrieval: 'NOT_PERFORMED', independentVerification: 'NOT_PERFORMED',
        modelAssertions: 'LEADS_ONLY', execution: 'NOT_EXECUTED', normalizedRecordDigest: digest
      }),
      event('challenge-source-dissent', 'source-observation-challenged', witness, t3, {
        challengeId: 'source-challenge-1', observationId, creationId, version: 1,
        challengeType: 'missing-evidence',
        challengeText: 'The source is not independently retrievable.'
      }),
      event('challenge-source-response', 'source-observation-challenge-responded', founder, t4, {
        responseId: 'source-response-1', challengeId: 'source-challenge-1', observationId, creationId, version: 1,
        responseText: 'The note is a lead only; source retrieval remains outstanding.'
      })
    ],
    discoveries: [], contributions: [], reports: [], methods: []
  };
  const witnessRecord = projectCharacter(world, witness);
  assert.equal(witnessRecord.xp, 0);
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'challenger').count, 1);
  const founderRecord = projectCharacter(world, founder);
  assert.equal(founderRecord.xp, 100);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'source-recorder').count, 1);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'challenger').count, 0);
  assert.equal(founderRecord.skills.find(skill => skill.id === 'source-responder').count, 1);
  assert.equal(witnessRecord.skills.find(skill => skill.id === 'source-responder').count, 0);
  assert.equal(founderRecord.xp, 100);
  assert.equal(witnessRecord.xp, 0);
});

test('Commons posts become actor-owned field satchel objects with a TownSquare return route, without XP or world mutation', async () => {
  const actor = { id: 'satchel-witness', name: 'Satchel Witness', role: 'witness' };
  const original = createWorld({ id: 'commons-satchel-world', now: t1 });
  const posted = await applyAction(original, {
    type: 'post-message',
    text: 'Carry this conversation back to the Commons.'
  }, actor, { now: t2 });
  const before = structuredClone(posted.world);

  const record = projectCharacter(posted.world, actor);
  assert.equal(record.fieldSatchelTotal, 1);
  assert.equal(record.fieldSatchelOmittedCount, 0);
  assert.equal(record.fieldSatchel.length, 1);
  const [item] = record.fieldSatchel;
  assert.equal(item.kind, 'commons-message');
  assert.equal(item.eventId, posted.world.events[0].id);
  assert.equal(item.messageId, posted.result.messageId);
  assert.equal(item.status, 'retained conversation · not evidence or authority');
  assert.equal(item.summary, posted.world.events[0].text);
  assert.deepEqual(item.action, { type: 'location', id: 'town-square' });
  assert.equal(record.skills.find(skill => skill.id === 'speaker').count, 1);
  assert.equal(record.xp, 0);
  assert.equal(record.worldXp, 0);
  assert.ok(Object.isFrozen(record.fieldSatchel));
  assert.ok(Object.isFrozen(item));
  assert.ok(Object.isFrozen(item.action));
  assert.deepEqual(posted.world, before, 'reading the satchel must not mutate the world');

  const other = projectCharacter(posted.world, {
    id: 'other-satchel-witness', name: 'Other Witness', role: 'witness'
  });
  assert.equal(other.fieldSatchel.length, 0, 'another actor cannot inherit this character’s satchel item');
});

test('a human-hidden Commons post remains in the author satchel with the public redaction', async () => {
  const author = { id: 'satchel-author', name: 'Satchel Author', role: 'witness' };
  const reporter = { id: 'satchel-reporter', name: 'Satchel Reporter', role: 'witness' };
  const founderActor = { id: 'satchel-founder', name: 'Founder', role: 'founder' };
  const original = createWorld({ id: 'commons-hidden-satchel', now: t1 });
  const posted = await applyAction(original, {
    type: 'post-message',
    text: 'This text must be redacted from the Witness field satchel after moderation.'
  }, author, { now: t2 });
  const reported = await applyAction(posted.world, {
    type: 'report-message',
    messageId: posted.result.messageId,
    reason: 'privacy',
    details: 'Please review this message.'
  }, reporter, { now: t3 });
  const hidden = await applyAction(reported.world, {
    type: 'moderate-message',
    messageId: posted.result.messageId,
    disposition: 'hide',
    reason: 'privacy'
  }, founderActor, { now: t4 });
  const before = structuredClone(hidden.world);
  const authorView = publicWorld(hidden.world, author);
  const authorRecord = projectCharacter(authorView, author);
  const founderRecord = projectCharacter(hidden.world, founderActor);

  assert.equal(authorRecord.fieldSatchel.length, 1);
  assert.equal(authorRecord.fieldSatchel[0].eventId, posted.world.events[0].id);
  assert.equal(authorRecord.fieldSatchel[0].summary, '[Message hidden by human moderation.]');
  assert.equal(authorRecord.fieldSatchel[0].status, 'retained conversation · not evidence or authority');
  assert.equal(authorRecord.xp, 0);
  assert.equal(founderRecord.fieldSatchel.length, 0);
  assert.deepEqual(hidden.world, before, 'projection must not alter the retained post or moderation history');
});

test('Commons field satchel keeps the newest 100 unique messages in append order, not timestamp order', () => {
  const events = Array.from({ length: 101 }, (_, index) => ({
    id: 'satchel-event-' + index,
    type: 'message-posted',
    actor: witness,
    at: new Date(Date.parse(t1) + (100 - index) * 1000).toISOString(),
    messageId: 'satchel-message-' + index,
    channel: 'commons',
    text: 'Retained Commons message ' + index
  }));
  const world = {
    id: 'bounded-commons-satchel',
    revision: events.length,
    xp: 0,
    creations: [],
    events,
    discoveries: [],
    contributions: [],
    reports: [],
    methods: []
  };
  const record = projectCharacter(world, witness);

  assert.equal(record.fieldSatchelTotal, 101);
  assert.equal(record.fieldSatchel.length, 100);
  assert.equal(record.fieldSatchelOmittedCount, 1);
  assert.equal(record.fieldSatchel[0].eventId, 'satchel-event-100');
  assert.equal(record.fieldSatchel.at(-1).eventId, 'satchel-event-1');
  assert.equal(record.fieldSatchel.some(item => item.eventId === 'satchel-event-0'), false);
});



test('Synthesis skill counts only multi-source Synthesis Clerk attempts and awards no XP', () => {
  const proposal = event('synthesis-proposal', 'moonshot-proposed', founder, t2, {
    moonshotId: 'moon-synthesis',
    title: 'Test a bounded synthesis claim',
    hypothesis: 'A claim holds under a stated condition.',
    falsifier: 'A repeatable counterexample.',
    evidenceNeeded: 'An independently observed measurement.',
    sourceCreationId: null,
    sourceVersion: null
  });
  const report = event('synthesis-report', 'experiment-reported', witness, t3, {
    moonshotId: 'moon-synthesis',
    reportId: 'synthesis-report-id',
    procedure: 'Run the stated procedure once.',
    observation: 'The expected result did not occur.',
    reportedOutcome: 'failed',
    evidenceCreationId: null,
    evidenceVersion: null
  });
  const response = event('synthesis-response', 'collaborator-response-recorded', witness, t4, {
    responseId: 'synthesis-response-id',
    role: 'synthesizer',
    moonshotId: 'moon-synthesis',
    sourceEventIds: [proposal.id, report.id],
    validationStatus: 'rejected',
    validationReason: 'RESPONSE_SCHEMA_OR_SCOPE_INVALID',
    validator: 'ngl.collaborator-response.v1'
  });
  const world = {
    creations: [],
    events: [proposal, report, response],
    discoveries: [],
    contributions: [],
    reports: [],
    methods: []
  };

  const before = structuredClone(world);
  const record = projectCharacter(world, witness);
  assert.equal(record.xp, 0);
  assert.equal(record.skills.find(skill => skill.id === 'synthesis').count, 1);
  assert.equal(record.skills.find(skill => skill.id === 'collaborator').count, 1);
  assert.match(record.skills.find(skill => skill.id === 'synthesis').basis, /not correctness, consensus, truth/i);
  const other = projectCharacter(world, founder);
  assert.equal(other.skills.find(skill => skill.id === 'synthesis').count, 0);
  assert.deepEqual(world, before, 'skill projection does not mutate canonical history');
});


test('field inventory and Armor Bearer status are unique actor-owned projections, not XP',async()=>{
  const created=createWorld({id:'field-kit-projection',now:t1});
  const discovered=await applyAction(created,{type:'discover',locationId:'river'},witness,{now:t2});
  const source=discovered.world.events.at(-1);
  const forged=await applyAction(discovered.world,{type:'forge-field-item',slotId:'scouting',sourceEventId:source.id},witness,{now:t3});
  const forgeEvent=forged.world.events.at(-1);
  const inventory=projectCharacter(forged.world,witness);
  assert.equal(inventory.fieldInventoryTotal,1);
  assert.equal(inventory.fieldInventory[0].eventId,forgeEvent.id);
  assert.equal(inventory.skills.find(skill=>skill.id==='forger').count,1);
  assert.equal(inventory.skills.find(skill=>skill.id==='armor-bearer').count,0);
  assert.equal(inventory.xp,0);
  assert.equal(projectCharacter(forged.world,founder).fieldInventoryTotal,0);

  const equipped=await applyAction(forged.world,{type:'equip-field-item',slotId:'scouting',sourceEventId:forgeEvent.id},witness,{now:t4});
  const loadout=projectCharacter(equipped.world,witness);
  assert.equal(loadout.equipment.find(slot=>slot.id==='scouting').source.eventId,forgeEvent.id);
  assert.equal(loadout.skills.find(skill=>skill.id==='armor-bearer').count,1);
  assert.equal(loadout.xp,0);

  const ambiguous=structuredClone(equipped.world);
  const duplicate=structuredClone(forgeEvent);
  duplicate.id='duplicate-field-forge-event';
  duplicate.itemId='duplicate-field-item';
  duplicate.at='2026-10-25T12:08:00.000Z';
  ambiguous.events.push(duplicate);
  ambiguous.revision=ambiguous.events.length;
  ambiguous.updatedAt=duplicate.at;
  const rejected=projectCharacter(ambiguous,witness);
  assert.equal(rejected.fieldInventoryTotal,0,'duplicate source use makes both item projections ambiguous');
  assert.equal(rejected.equipment.find(slot=>slot.id==='scouting').source,null);
  assert.equal(rejected.skills.find(skill=>skill.id==='forger').count,0);
  assert.equal(rejected.skills.find(skill=>skill.id==='armor-bearer').count,0);
});
