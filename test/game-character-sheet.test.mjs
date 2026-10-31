import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCharacter} from '../game/character-sheet.mjs';
import {getActiveQuest,getQuestTrail} from '../game/quests.mjs';
import {projectCollaboratorResponseWorldObjects} from '../game/collaborator-world-objects.mjs';

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
    ['maker', 1], ['explorer', 1], ['observer', 1], ['scholar', 0], ['retriever', 0],
    ['challenger', 1], ['researcher', 0], ['experimenter', 0], ['adversary', 0],
    ['questkeeper', 3], ['restorer', 0]
  ]);
  assert.equal(record.xp, 100);
  assert.equal(record.worldXp, 100, 'only the Founder publication with a retained matching event contributes world XP');
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
  assert.deepEqual(record.fieldSatchel, []);
  assert.ok(record.equipment.every(slot => slot.status === 'empty' && slot.source === null),
    'unlinked summary rows cannot fill any field-equipment slot');
  assert.equal(record.fieldSatchelTotal, 0);
  assert.equal(record.fieldSatchelOmittedCount, 0);
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


test('Questkeeper and the active HUD invitation share immutable evidence-backed progress', () => {
  const earlyWorld = {
    xp: 100,
    creations: [publishedCreation('early-questkeeper-place', [t1])],
    events: [publication('early-questkeeper-publication', founder, 'early-questkeeper-place', 1, t1)],
    discoveries: [],
    contributions: [],
    reports: [],
    methods: []
  };
  const earlyBefore = structuredClone(earlyWorld);
  const earlyTrail = getQuestTrail(earlyWorld, founder);
  const earlyCharacter = projectCharacter(earlyWorld, founder);
  assert.equal(
    earlyCharacter.skills.find(skill => skill.id === 'questkeeper').count,
    earlyTrail.filter(milestone => milestone.complete).length
  );
  assert.equal(getActiveQuest(earlyWorld, founder, earlyTrail).id, 'founder-discover',
    'the authored introductory journey remains active before the evidence-backed trail takes over');
  assert.deepEqual(earlyWorld, earlyBefore, 'reading the introduction and character sheet creates no event');

  const matureWorld = {
    xp: 200,
    creations: [
      publishedCreation('questkeeper-first-place', [t1]),
      publishedCreation('questkeeper-second-place', [t2])
    ],
    events: [
      publication('questkeeper-first-publication', founder, 'questkeeper-first-place', 1, t1),
      publication('questkeeper-second-publication', founder, 'questkeeper-second-place', 1, t2),
      event('questkeeper-discovery-event', 'discover', founder, t3, { locationId: 'relay' }),
      event('questkeeper-note-event', 'contribute', founder, t4, {
        creationId: 'questkeeper-first-place', version: 1
      })
    ],
    discoveries: [{
      id: 'questkeeper-discovery-record', actor: founder, locationId: 'relay', at: t3
    }],
    contributions: [{
      id: 'questkeeper-note-record', actor: founder, creationId: 'questkeeper-first-place',
      version: 1, text: 'A source-bound field note.', at: t4
    }],
    reports: [],
    methods: []
  };
  const matureBefore = structuredClone(matureWorld);
  const trail = getQuestTrail(matureWorld, founder);
  const completed = trail.filter(milestone => milestone.complete);
  const next = trail.find(milestone => !milestone.complete);
  assert.ok(next, 'the fixture leaves a real next objective');

  const character = projectCharacter(matureWorld, founder);
  assert.equal(
    character.skills.find(skill => skill.id === 'questkeeper').count,
    completed.length,
    'the character skill is the same completed-objective count shown by the evidence-backed trail'
  );

  const active = getActiveQuest(matureWorld, founder, trail);
  assert.equal(active.id, next.id, 'after the introductory journey, the HUD points to the first unfinished trail objective');
  assert.deepEqual(active.nextAction, next.action);
  assert.deepEqual(matureWorld, matureBefore, 'reading the character sheet and quest invitation creates no world event');

  const reopened = getActiveQuest(matureWorld, founder, trail);
  assert.deepEqual(reopened, active, 'reopening the invitation is deterministic');
  assert.deepEqual(matureWorld, matureBefore, 'navigation never manufactures progress');
});


test('Questkeeper map rejects reused discovery record IDs across distinct locations', () => {
  const locations = ['relay', 'river', 'overlook', 'ruins'];
  const discoveries = locations.map((locationId, index) => ({
    id: 'reused-discovery-record',
    actor: witness,
    locationId,
    at: new Date(Date.parse(t1) + index * 1000).toISOString()
  }));
  const events = discoveries.map((discovery, index) =>
    event('unique-discovery-event-' + index, 'discover', witness, discovery.at, {
      locationId: discovery.locationId
    })
  );
  const world = { xp: 0, creations: [], events, discoveries };
  const trail = getQuestTrail(world, witness);
  const map = trail.find(item => item.id === 'witness-map-grounds');
  const character = projectCharacter(world, witness);

  assert.equal(map.progress, 0,
    'four distinct event fingerprints cannot turn one reused record identity into four visits');
  assert.equal(map.complete, false);
  assert.equal(character.skills.find(skill => skill.id === 'explorer').count, 0);
  assert.equal(character.skills.find(skill => skill.id === 'questkeeper').count, 0,
    'the Questkeeper projection must agree with the stricter Explorer activity projection');
});

test('Questkeeper map requires every discovery record to carry its own retained identity', () => {
  const locations = ['relay', 'river', 'overlook', 'ruins'];
  const discoveries = locations.map((locationId, index) => ({
    ...(index === 2 ? {} : { id: 'discovery-record-' + index }),
    actor: witness,
    locationId,
    at: new Date(Date.parse(t1) + index * 1000).toISOString()
  }));
  const events = discoveries.map((discovery, index) =>
    event('discovery-event-' + index, 'discover', witness, discovery.at, {
      locationId: discovery.locationId
    })
  );
  const world = { xp: 0, creations: [], events, discoveries };
  const trail = getQuestTrail(world, witness);
  const map = trail.find(item => item.id === 'witness-map-grounds');
  const character = projectCharacter(world, witness);

  assert.equal(map.progress, 3);
  assert.equal(map.complete, false);
  assert.equal(character.skills.find(skill => skill.id === 'explorer').count, 3);
  assert.equal(character.skills.find(skill => skill.id === 'questkeeper').count, 0);
});

test('Questkeeper map rejects matching discovery records with non-canonical timestamps', () => {
  const locations = ['relay', 'river', 'overlook', 'ruins'];
  const discoveries = locations.map((locationId, index) => ({
    id: 'date-only-discovery-' + index,
    actor: witness,
    locationId,
    at: '2026-10-25'
  }));
  const events = discoveries.map((discovery, index) =>
    event('date-only-event-' + index, 'discover', witness, discovery.at, {
      locationId: discovery.locationId
    })
  );
  const world = { xp: 0, creations: [], events, discoveries };
  const trail = getQuestTrail(world, witness);
  const map = trail.find(item => item.id === 'witness-map-grounds');
  const character = projectCharacter(world, witness);

  assert.equal(map.progress, 0);
  assert.equal(map.complete, false);
  assert.equal(character.skills.find(skill => skill.id === 'explorer').count, 0);
  assert.equal(character.skills.find(skill => skill.id === 'questkeeper').count, 0);
});


test('Questkeeper map rejects repeat discovery events even when a record mirrors them', () => {
  const locations = ['relay', 'river', 'overlook', 'ruins'];
  const discoveries = locations.map((locationId, index) => ({
    id: 'discovery-record-' + index,
    actor: witness,
    locationId,
    at: new Date(Date.parse(t1) + index * 1000).toISOString()
  }));
  const events = discoveries.map((discovery, index) =>
    event('discovery-event-' + index, 'discover', witness, discovery.at, {
      locationId: discovery.locationId,
      ...(index === 3 ? { repeat: true } : {})
    })
  );
  const world = { xp: 0, creations: [], events, discoveries };
  const trail = getQuestTrail(world, witness);
  const map = trail.find(item => item.id === 'witness-map-grounds');
  const character = projectCharacter(world, witness);
  const explorer = character.skills.find(skill => skill.id === 'explorer');

  assert.equal(map.progress, 3);
  assert.equal(map.complete, false);
  assert.equal(explorer.count, 3);
  assert.equal(character.skills.find(skill => skill.id === 'questkeeper').count, 0);
  assert.equal(map.progress, explorer.count,
    'quest and character projections share the same first-discovery evidence rule');
});


test('field satchel projects retained work while preserving failed reports and dissent without granting progress', () => {
  const source = publishedCreation('satchel-source', [t1]);
  const publicationEvent = publication('satchel-publication', founder, 'satchel-source', 1, t1);
  const discoveryEvent = event('satchel-discovery-event', 'discover', founder, t2, { locationId: 'river' });
  const noteEvent = event('satchel-note-event', 'contribute', founder, t2, {
    creationId: 'satchel-source', version: 1
  });
  const fieldReportEvent = event('satchel-field-report-event', 'report', founder, t3, {
    creationId: 'satchel-source', version: 1
  });
  const proposal = event('satchel-proposal-event', 'moonshot-proposed', witness, t2, {
    moonshotId: 'satchel-moonshot',
    title: 'A bounded field question',
    hypothesis: 'The stated effect appears under the recorded condition.',
    falsifier: 'A controlled counterexample fails to reproduce the effect.',
    evidenceNeeded: 'A retained source and independent observation.'
  });
  const study = event('satchel-study-event', 'study', founder, t3, {
    studyId: 'satchel-study',
    creationId: 'satchel-source',
    version: 1,
    question: 'What does the retained artifact establish?',
    attempt: 'It establishes only the recorded wording.',
    nextCheck: 'Compare the next retained version.'
  });
  const experiment = event('satchel-experiment-event', 'experiment-reported', witness, t3, {
    reportId: 'satchel-experiment-report',
    moonshotId: 'satchel-moonshot',
    procedure: 'Repeat the bounded comparison.',
    observation: 'The reported effect was not reproduced.',
    reportedOutcome: 'failed',
    evidenceCreationId: null,
    evidenceVersion: null
  });
  const review = event('satchel-review-event', 'study-reviewed', founder, t4, {
    reviewId: 'satchel-review',
    studyId: 'satchel-study',
    creationId: 'satchel-source',
    version: 1,
    response: 'The retained version does not answer the broader question.',
    reflection: 'A second source is needed before changing the claim.'
  });
  const challenge = event('satchel-challenge-event', 'experiment-challenged', founder, t5, {
    challengeId: 'satchel-challenge',
    reportId: 'satchel-experiment-report',
    moonshotId: 'satchel-moonshot',
    challengeType: 'contradiction',
    challengeText: 'The failed report does not include the stated control condition.',
    evidenceCreationId: null,
    evidenceVersion: null
  });
  const world = {
    id: 'satchel-world',
    revision: 9,
    xp: 0,
    creations: [source],
    events: [publicationEvent, discoveryEvent, noteEvent, fieldReportEvent, proposal, study, experiment, review, challenge],
    discoveries: [{ id: 'satchel-discovery-record', actor: founder, locationId: 'river', at: t2 }],
    contributions: [{
      id: 'satchel-note-record', actor: founder, creationId: 'satchel-source',
      version: 1, text: 'The page records a claim but does not supply the cited source.', at: t2
    }],
    reports: [{
      id: 'satchel-field-report-record', actor: founder, creationId: 'satchel-source',
      version: 1, text: 'The cited source is not attached to this version.', at: t3
    }]
  };
  const before = structuredClone(world);
  const founderRecord = projectCharacter(world, founder);
  const witnessRecord = projectCharacter(world, witness);
  const founderKinds = new Set(founderRecord.fieldSatchel.map(item => item.kind));
  const witnessKinds = new Set(witnessRecord.fieldSatchel.map(item => item.kind));

  for (const kind of ['guide-discovery', 'field-note', 'field-report', 'study-note', 'retrieval-review', 'experiment-challenge']) {
    assert.equal(founderKinds.has(kind), true, kind);
  }
  assert.equal(witnessKinds.has('moonshot-proposal'), true);
  assert.equal(witnessKinds.has('experiment-report'), true);
  assert.equal(founderRecord.fieldSatchel.find(item => item.kind === 'experiment-challenge').status,
    'dissent preserved · not adjudicated');
  assert.equal(witnessRecord.fieldSatchel.find(item => item.kind === 'experiment-report').status,
    'self-reported · failed');
  assert.deepEqual(founderRecord.fieldSatchel.find(item => item.kind === 'field-note').action,
    { type: 'creation', id: 'satchel-source', version: 1 });
  assert.deepEqual(founderRecord.fieldSatchel.find(item => item.kind === 'guide-discovery').action,
    { type: 'location', id: 'river' });
  assert.deepEqual(witnessRecord.fieldSatchel.find(item => item.kind === 'moonshot-proposal').action,
    { type: 'moonshot', moonshotId: 'satchel-moonshot' });
  assert.deepEqual(witnessRecord.fieldSatchel.find(item => item.kind === 'experiment-report').action,
    { type: 'moonshot-activity', moonshotId: 'satchel-moonshot', activityId: 'satchel-experiment-report' });
  assert.deepEqual(founderRecord.fieldSatchel.find(item => item.kind === 'experiment-challenge').action,
    { type: 'moonshot-activity', moonshotId: 'satchel-moonshot', activityId: 'satchel-challenge' });
  assert.equal(founderRecord.xp, 100, 'only the retained publication reward contributes XP');
  assert.equal(witnessRecord.xp, 0, 'research and reported failure do not award XP');

  const founderGear = Object.fromEntries(founderRecord.equipment.map(slot => [slot.id, slot]));
  const witnessGear = Object.fromEntries(witnessRecord.equipment.map(slot => [slot.id, slot]));
  assert.equal(founderGear.provenance.source.eventId, 'satchel-publication');
  assert.equal(founderGear.scouting.source.eventId, 'satchel-discovery-event');
  assert.equal(founderGear.observation.source.eventId, 'satchel-field-report-event',
    'the newest append-position report fills the observation slot');
  assert.equal(founderGear.learning.source.eventId, 'satchel-review-event');
  assert.equal(founderGear.adversarial.source.eventId, 'satchel-challenge-event');
  assert.equal(founderGear.adversarial.source.status, 'dissent preserved · not adjudicated');
  assert.equal(founderGear.research.status, 'empty');
  assert.equal(founderGear.collaboration.status, 'empty');
  assert.equal(founderGear.restoration.status, 'empty');
  assert.equal(witnessGear.provenance.status, 'empty',
    'another actor’s publication cannot equip this character');
  assert.equal(witnessGear.research.source.eventId, 'satchel-experiment-event');
  assert.equal(witnessGear.research.source.status, 'self-reported · failed',
    'failed attempts remain visible as field gear sources without becoming success');
  assert.ok(founderRecord.equipment.every(slot => Object.isFrozen(slot)));
  assert.ok(founderRecord.equipment.every(slot => !slot.source || Object.isFrozen(slot.source)));
  assert.deepEqual(world, before, 'field equipment and the satchel are read-only projections');
});

test('field satchel keeps its newest 100 objects and points back to retained append order', () => {
  const discoveryEvent = event('old-discovery-event', 'discover', founder, t1, { locationId: 'river' });
  const proposals = Array.from({ length: 101 }, (_, index) => event(
    'satchel-moonshot-event-' + index,
    'moonshot-proposed',
    founder,
    new Date(Date.parse(t1) + index * 1000).toISOString(),
    {
      moonshotId: 'satchel-moonshot-' + index,
      title: 'Bounded proposal ' + index,
      hypothesis: 'A testable hypothesis.',
      falsifier: 'A reproducible counterexample.',
      evidenceNeeded: 'A retained source and independent check.'
    }
  ));
  const events = [discoveryEvent, ...proposals];
  const world = {
    id: 'bounded-satchel-world',
    revision: events.length,
    creations: [],
    events,
    discoveries: [{ id: 'old-discovery-record', actor: founder, locationId: 'river', at: t1 }]
  };
  const record = projectCharacter(world, founder);

  assert.equal(record.fieldSatchel.length, 100);
  assert.equal(record.fieldSatchelTotal, 102);
  assert.equal(record.fieldSatchelOmittedCount, 2);
  assert.equal(record.fieldSatchel[0].eventId, events.at(-1).id,
    'the newest appended event is first even if other timestamps are backdated');
  assert.equal(record.fieldSatchel.at(-1).eventId, proposals[1].id);
  assert.equal(record.fieldSatchel.some(item => item.kind === 'guide-discovery'), false,
    'the oldest discovery is outside the bounded satchel display');
  assert.equal(record.equipment.find(slot => slot.id === 'scouting').source.eventId,
    discoveryEvent.id,
    'equipment scans the validated source set rather than disappearing when its satchel card is omitted');
});


test('character projection ignores fabricated and foreign precomputed read models', () => {
  const eventRecord = event('forged-folio-event', 'collaborator-response-recorded', founder, t1, {
    responseId: 'forged-response'
  });
  const world = {
    id: 'character-projection-world', revision: 1, creations: [], events: [eventRecord],
    discoveries: [], contributions: [], reports: [], methods: []
  };
  const foreignWorld = { ...world, id: 'foreign-character-world' };
  const forgedTrail = Object.freeze([{ id: 'forged-objective', complete: true, progress: 1, target: 1 }]);
  const forgedFolios = Object.freeze([{
    id: 'forged-folio', eventId: eventRecord.id, responseId: 'forged-response',
    actorId: founder.id, actorRole: founder.role, name: 'Hostile Archivist',
    validationStatus: 'valid-for-human-review'
  }]);
  const foreignTrail = getQuestTrail(foreignWorld, founder);
  const baseline = projectCharacter(world, founder);
  const forged = projectCharacter(world, founder, {
    questTrail: forgedTrail,
    collaboratorResponseObjects: forgedFolios
  });
  const foreign = projectCharacter(world, founder, {
    questTrail: foreignTrail,
    collaboratorResponseObjects: projectCollaboratorResponseWorldObjects(foreignWorld)
  });

  assert.deepEqual(forged, baseline, 'caller-supplied arrays cannot manufacture skills or satchel items');
  assert.deepEqual(foreign, baseline, 'another world snapshot cannot supply this character’s progress');
  assert.equal(forged.skills.find(skill => skill.id === 'questkeeper').count, 0);
  assert.equal(forged.fieldSatchel.some(item => item.kind === 'guild-folio'), false);
});
