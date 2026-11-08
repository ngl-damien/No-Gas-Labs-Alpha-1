import {readPrivatePlayerPosition,writePrivatePlayerPosition} from './player-position.mjs';
import {createWorld,applyAction,publicWorld,validateWorld} from './model.mjs';
import {getActiveQuest,getQuestTrail,getLocationAction,findStudyReview,hasStudyReviewRecord} from './quests.mjs';
import {projectCharacter} from './character-sheet.mjs';
import {PixelWorldView, GUILD_NPCS} from './pixel-world-view.mjs';
import {resolveGuildNpcWorkbench, focusGuildCollaborator} from './guild-npc-workbench.mjs';
import {PLACES,institutionSummaryFromState} from './world-view.mjs';
import {rehearseLaunch,makeLaunchPage} from './launchpad.mjs';
import {renderCharterCodex,renderEvidenceArchive,renderInstitution} from './institution-view.mjs';
import {prepareContradictionReview,formatContradictionReport} from './contradiction-clerk.mjs';
import {projectResearchRecords,parseSourceObservatoryExport,projectSourceObservationRecords,sourceObservationRequestMaterial,sameResearchActor} from './research-records.mjs';
import {isStrictTimestamp} from './timestamps.mjs';
import {projectCollaboratorPackets} from './collaborator-contracts.mjs';
import {validateCollaboratorResponse,validateRetainedCollaboratorResponse} from './collaborator-response.mjs';
import {projectTownSquare,projectPlayerGuilds,projectGuildFieldSatchel,COMMONS_MESSAGE_LIMIT,COMMONS_REASONS,PLAYER_GUILD_NAME_LIMIT,PLAYER_GUILD_CHARTER_LIMIT,PLAYER_GUILD_MEMBER_LIMIT} from './social.mjs';

function registerOfflineShell(){
  const serviceWorker=globalThis.navigator?.serviceWorker;
  const pageLocation=globalThis.location;
  if(!serviceWorker||!pageLocation)return;
  if(pageLocation.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(pageLocation.hostname))return;
  serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
}
registerOfflineShell();
let institutionRequestGeneration=0,evidenceArchiveGeneration=0,pendingSharedActionInFlight=null;let commonsDraftText='';
const COMMONS_MUTED_AUTHORS_KEY='ngl.common-ground.commons-muted-authors.v1';
function readMutedCommonsAuthors(){
  try{
    const storage=globalThis.localStorage;
    if(!storage)return {authors:[],available:false};
    const raw=storage.getItem(COMMONS_MUTED_AUTHORS_KEY);
    if(raw===null)return {authors:[],available:true};
    const parsed=JSON.parse(raw);
    if(!Array.isArray(parsed))return {authors:[],available:false};
    const authors=[],seen=new Set();
    for(const candidate of parsed.slice(0,100)){
      if(!candidate||typeof candidate.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(candidate.id)||
         ['constructor','prototype','__proto__'].includes(candidate.id)||
         !['founder','witness'].includes(candidate.role)||
         typeof candidate.name!=='string'||!candidate.name.trim()||Array.from(candidate.name).length>80)continue;
      const key=JSON.stringify([candidate.id,candidate.role]);
      if(seen.has(key))continue;
      seen.add(key);
      authors.push({id:candidate.id,role:candidate.role,name:candidate.name.trim()});
    }
    return {authors,available:true};
  }catch{return {authors:[],available:false};}
}
function writeMutedCommonsAuthors(authors){
  try{
    if(!Array.isArray(authors)||authors.length>100)throw new Error('Invalid mute list.');
    globalThis.localStorage.setItem(COMMONS_MUTED_AUTHORS_KEY,JSON.stringify(authors));
    return true;
  }catch{
    toast('Device storage could not save this local mute. No shared message or world state was changed.',true);
    return false;
  }
}
async function openInstitution(locationId = null) {
  const contexts = {
    'town-square': ['The institution at work.', 'PROJECTS · EVIDENCE · FOUNDER GATE'],
    guild_hall: ['Guild Hall', 'COUNCIL · CAPABILITIES · EVIDENCE'],
    decision_chamber: ['Decision Chamber', 'HUMAN GATE · DECISIONS'],
  };
  const context = contexts[locationId] || contexts['town-square'];
  const content = showSheet(context[0], context[1]);
  if (mode !== 'shared') {
    content.append(paragraph('Project receipts and authenticated decisions are available in the shared service. Private game progress does not establish institutional work.'));
    return;
  }
  const requestGeneration = ++institutionRequestGeneration;
  const principalId = viewer.id;
  const principalRole = viewer.role;
  const [projects, gate, stateResult, institutionResult] = await Promise.all([
    request('/api/projects'),
    request('/api/decisions'),
    request('/api/state').then(data => ({ data })).catch(() => ({ data: null })),
    request('/api/institution').then(data => ({ data })).catch(() => ({ data: null })),
  ]);
  if (requestGeneration !== institutionRequestGeneration || mode !== 'shared' ||
      viewer.id !== principalId || viewer.role !== principalRole || $('sheet').hidden ||
      content !== $('sheet-content') || $('sheet-kicker').textContent !== context[1]) return;
  renderInstitution(content, projects, gate, {
    founder: viewer.role === 'founder',
    world: stateResult.data?.world,
    kernel: institutionResult.data?.kernel,
    kernelUnavailable: !institutionResult.data?.kernel,
    onOpenArtifact: (id, version) => openCreation(id, version),
    onChoice: guarded(async (decision, action) => {
      await request('/api/decisions/choose', {
        decisionId: decision.id,
        expectedRevision: decision.revision,
        requestId: crypto.randomUUID(),
        action,
      });
      await openInstitution();
    }),
  });
}

function openCommons(){
  commonsDraftText='';
  const content=showSheet('The Commons at TownSquare','PUBLIC CONVERSATION · HUMAN MODERATION');
  activeNoteRenderer=()=>renderCommonsContent(content);
  renderCommonsContent(content,{preserveInputs:false});
}
function renderCommonsContent(content,{preserveInputs=true,clearReportMessageId=null}={}){
  if(content!==$('sheet-content')||$('sheet').hidden)return;
  const preservedValues=new Map();
  let focusedId=null,selectionStart=null,selectionEnd=null;
  if(preserveInputs){
    for(const field of content.querySelectorAll('input,textarea,select')){
      if(field.id)preservedValues.set(field.id,field.value);
    }
    if(document.activeElement&&content.contains(document.activeElement)){
      focusedId=document.activeElement.id||null;
      if(typeof document.activeElement.selectionStart==='number'){
        selectionStart=document.activeElement.selectionStart;
        selectionEnd=document.activeElement.selectionEnd;
      }
    }
    const priorComposer=content.querySelector('#commons-message');
    if(priorComposer)commonsDraftText=priorComposer.value;
  }
  const muteState=readMutedCommonsAuthors();
  const feed=projectTownSquare(world,viewer,{mutedAuthors:muteState.authors});
  content.replaceChildren();
  content.dataset.commonsPanel='true';
  content.append(
    paragraph(mode==='shared'
      ? 'Messages are shared with the current game community. Reports are private to their author and the authenticated Founder.'
      : 'Private-world messages stay on this device. Shared conversation requires the shared service.'),
    paragraph('Conversation is not evidence, truth, approval, authority, verification, or XP. Human moderation can hide public text while preserving the original event in world history. Device-local mutes affect only this browser and never hide content for other players.','form-help'),
    button('Institution records →',()=>openInstitution('town-square'),{class:'secondary-button','data-commons-institution-records':'true'})
  );
  const form=node('form',{id:'commons-compose','aria-label':'Post a Commons message'});
  const textarea=node('textarea',{id:'commons-message',maxlength:String(COMMONS_MESSAGE_LIMIT),rows:'3',placeholder:'A question, useful invitation, absurdity, or field observation.',value:preserveInputs?(preservedValues.get('commons-message')??commonsDraftText):commonsDraftText});
  const count=node('small',{id:'commons-message-count','aria-live':'polite',text:Array.from(textarea.value).length+' / '+COMMONS_MESSAGE_LIMIT});
  textarea.addEventListener('input',()=>{commonsDraftText=textarea.value;count.textContent=Array.from(textarea.value).length+' / '+COMMONS_MESSAGE_LIMIT;});
  const post=button('Post to The Commons',guarded(async()=>{
    const text=textarea.value.trim();
    if(!text)throw new Error('Write a message before posting.');
    await act({type:'post-message',text});
    commonsDraftText='';
    renderCommonsContent(content,{preserveInputs:false});
    toast('Message retained. Conversation only; no XP or authority.');
  }),{class:'primary-button','data-commons-post':'true'});
  form.addEventListener('submit',event=>{event.preventDefault();post.click();});
  form.append(textarea,count,post);
  content.append(node('section',{class:'field-card'},[
    node('div',{class:'eyebrow',text:'WRITE A MESSAGE'}),
    form
  ]));
  content.append(node('h3',{class:'section-title',text:'RECENT MESSAGES · '+feed.totalMessages}));
  if(feed.omittedMessageCount)content.append(paragraph(feed.omittedMessageCount+' earlier messages remain in the Chronicle and are not included in this bounded view.','form-help'));
  if(!muteState.available)content.append(paragraph('Device-local mute preferences could not be read. Messages are shown without local filtering; no shared moderation state was changed.','evidence-warning'));
  if(feed.mutedMessageCount)content.append(paragraph(feed.mutedMessageCount+' recent message'+(feed.mutedMessageCount===1?' is':'s are')+' hidden by device-local mutes. Other players still see their own unfiltered feed.','form-help'));
  if(!feed.messages.length&&feed.mutedMessageCount===0)content.append(paragraph('The Commons is quiet. A first message creates a retained conversation event, not progress or proof.','form-help'));
  else if(!feed.messages.length)content.append(paragraph('No recent messages are visible. Unmute an author below to restore this device’s view.','form-help'));
  if(feed.mutedAuthors.length){
    const mutedPanel=node('details',{id:'commons-muted-authors',class:'field-card'});
    mutedPanel.append(node('summary',{text:'MUTED AUTHORS · THIS DEVICE · '+feed.mutedAuthors.length}));
    for(const author of feed.mutedAuthors){
      mutedPanel.append(node('div',{class:'button-row'},[
        paragraph(author.name+' · '+String(author.role).toUpperCase()),
        button('Unmute →',()=>{
          const next=feed.mutedAuthors.filter(candidate=>candidate.id!==author.id||candidate.role!==author.role);
          if(writeMutedCommonsAuthors(next))renderCommonsContent(content);
        },{class:'secondary-button','data-commons-unmute':author.id,'data-commons-unmute-role':author.role})
      ]));
    }
    content.append(mutedPanel);
  }
  for(const message of feed.messages){
    const card=node('article',{class:'field-card','data-commons-message-id':message.messageId});
    card.append(
      node('div',{class:'eyebrow',text:message.author.name+' · '+String(message.author.role).toUpperCase()}),
      paragraph(new Date(message.at).toLocaleString()),
      paragraph(message.text)
    );
    if(message.canMute&&muteState.available)card.append(button('Mute author on this device',()=>{
      if(feed.mutedAuthors.length>=100){toast('The device-local mute list is full (100 authors).',true);return;}
      const next=[...feed.mutedAuthors,{id:message.author.id,role:message.author.role,name:message.author.name}];
      if(writeMutedCommonsAuthors(next))renderCommonsContent(content);
    },{class:'secondary-button','data-commons-mute':message.messageId}));
    if(message.hidden)card.append(paragraph('Hidden by human moderation. The original message remains retained in history.','form-help'));
    if(message.canReport){
      const report=node('details',{class:'commons-report'});
      report.append(node('summary',{text:'Report this message privately'}));
      const reasonId='commons-report-reason-'+message.messageId;
      const detailsId='commons-report-details-'+message.messageId;
      const reason=node('select',{id:reasonId,'aria-label':'Private report reason'});
      for(const value of COMMONS_REASONS)reason.append(node('option',{value,text:value}));
      if(preserveInputs&&preservedValues.has(reasonId))reason.value=preservedValues.get(reasonId);
      const details=node('textarea',{id:detailsId,rows:'2',maxlength:'500',placeholder:'Why should a human review this message?',value:preserveInputs&&clearReportMessageId!==message.messageId?(preservedValues.get(detailsId)||''):''});
      report.append(reason,details,button('Submit private report',guarded(async()=>{
        await act({type:'report-message',messageId:message.messageId,reason:reason.value,details:details.value.trim()});
        renderCommonsContent(content,{preserveInputs:true,clearReportMessageId:message.messageId});
        toast('Private report retained for human review.');
      }),{class:'secondary-button','data-commons-report':message.messageId}));
      card.append(report);
    }
    if(viewer.role==='founder'&&message.pendingReportCount>0){
      const review=node('div',{class:'button-row'});
      const reasonId='commons-moderation-reason-'+message.messageId;
      const reason=node('select',{id:reasonId,'aria-label':'Human moderation reason'});
      for(const value of COMMONS_REASONS)reason.append(node('option',{value,text:value}));
      if(preserveInputs&&preservedValues.has(reasonId))reason.value=preservedValues.get(reasonId);
      review.append(reason,button('Hide after human review',guarded(async()=>{
        await act({type:'moderate-message',messageId:message.messageId,disposition:'hide',reason:reason.value});
        toast('Message hidden; original history retained.');
      }),{class:'secondary-button','data-commons-hide':message.messageId}));
      card.append(review);
    }
    if(viewer.role==='founder'&&message.hidden){
      const reasonId='commons-restore-reason-'+message.messageId;
      const reason=node('select',{id:reasonId,'aria-label':'Human restoration reason'});
      for(const value of COMMONS_REASONS)reason.append(node('option',{value,text:value}));
      if(preserveInputs&&preservedValues.has(reasonId))reason.value=preservedValues.get(reasonId);
      card.append(node('div',{class:'button-row'},[
        reason,
        button('Restore retained message',guarded(async()=>{
          await act({type:'moderate-message',messageId:message.messageId,disposition:'restore',reason:reason.value});
          toast('Message restored; moderation history retained.');
        }),{class:'secondary-button','data-commons-restore':message.messageId})
      ]));
    }
    content.append(card);
  }
  if(viewer.role==='founder'&&feed.pendingReports.length){
    const panel=node('section',{id:'commons-pending-reports',class:'field-card'});
    panel.append(node('h3',{text:'PENDING PRIVATE REPORTS · '+feed.pendingReportTotal}));
    for(const report of feed.pendingReports){
      const item=node('details');
      item.append(node('summary',{text:report.reason+' · '+report.reporter.name+' → '+report.messageAuthor.name}));
      item.append(paragraph(report.details),paragraph(report.messageText,'form-help'));
      panel.append(item);
    }
    if(feed.omittedPendingReportCount)panel.append(paragraph(feed.omittedPendingReportCount+' older pending reports are omitted from this view.','form-help'));
    content.append(panel);
  }
  if(focusedId){
    const focused=Array.from(content.querySelectorAll('[id]')).find(field=>field.id===focusedId);
    if(focused){
      focused.focus({preventScroll:true});
      if(selectionStart!==null&&typeof focused.setSelectionRange==='function'){
        const end=selectionEnd??selectionStart;
        focused.setSelectionRange(Math.min(selectionStart,focused.value.length),Math.min(end,focused.value.length));
      }
    }
  }
}
function openQuestBoard() {
  const content = showSheet('Quest Board', 'COMMON GROUND · RETAINED OBJECTIVES');
  content.setAttribute('data-quest-board', 'true');
  content.setAttribute('data-actor-role', viewer.role);
  const milestones = getQuestTrail(world, viewer);
  const recorded = milestones.filter(item => item.complete).length;
  const blocked = milestones.filter(item => !item.complete && item.blockedReason).length;
  const unresolved = milestones.length - recorded;
  content.append(
    paragraph(`${viewer.role === 'founder' ? 'Founder' : 'Witness'} objectives are scoped to this character. ${recorded} recorded · ${unresolved} unresolved (${blocked} blocked).`, 'status-line'),
    paragraph('RECORDED means the current objective rule found matching retained events. It does not certify truth, mastery, independent execution, approval, or authority. Opening this board is read-only; use each objective action to visit the institution where the work belongs.', 'form-help')
  );
  const list = node('ol', {
    class: 'quest-trail',
    'data-quest-board-list': 'true',
    'aria-label': 'Actor-scoped objective trail'
  });
  renderQuestTrail(milestones, list);
  content.append(list);
}

function openInstitutionLocation(id) {
  if (id === 'quest_board') return openQuestBoard();
  if (id === 'council_chamber') return openCouncilChamber();
  if (id === 'guild_hall') return openGuildHall();
  if (id === 'forge') return openForge();
  if (id === 'evidence_archive') return openEvidenceArchive();
  if (id === 'source_observatory') return openSourceObservatory();
  if (id === 'town-square') return openCommons();
  if (id === 'decision_chamber') return openInstitution(id);
  if (id === 'academy') return openAcademy();
  if (id === 'moonshot_field') return openMoonshotField();
  if (id === 'publication_house') return openPublicationHouse();
  return openGuide(id);
}

function openGuildNpcInteraction(interaction) {
  const route = resolveGuildNpcWorkbench(interaction);
  if (!route) throw new Error('The NPC role and owning institution do not match a registered Guild Hall guide.');
  if (route.institutionId === 'evidence_archive') return openEvidenceArchive(route.roleId);
  if (route.institutionId === 'academy') return openAcademy(route.roleId);
  if (route.institutionId === 'guild_hall') return openGuildHall(route.roleId);
  throw new Error('This NPC role has no bounded institutional workbench.');
}

function openPlayerProfile(player) {
  const actor = {
    id: typeof player?.id === 'string' ? player.id : '',
    name: typeof player?.name === 'string' ? player.name.trim() : '',
    role: player?.role
  };
  if (!actor.id || actor.id.length > 128 || !actor.name ||
      Array.from(actor.name).length > 80 || !['founder', 'witness'].includes(actor.role)) {
    throw new Error('The nearby player record is incomplete; no profile was opened.');
  }

  const content = showSheet(actor.name, 'NEARBY PLAYER · PUBLIC SESSION CARD');
  content.setAttribute('data-player-profile', 'true');
  content.setAttribute('data-player-role', actor.role);
  content.append(
    paragraph(actor.role.toUpperCase() + ' SESSION · PRESENT IN THE LATEST SHARED SNAPSHOT', 'status-line'),
    paragraph('Presence identifies a session actor, not a distinct human, real-world identity, endorsement, or authority. Inspection is read-only. A guild join below is a separate, explicit self-action.', 'form-help')
  );

  let targetGuild = null;
  let viewerGuildId = null;
  let guildProjectionAvailable = true;
  try {
    const targetProjection = projectPlayerGuilds(world, actor);
    targetGuild = targetProjection.guilds.find(guild => guild.id === targetProjection.viewerGuildId) || null;
    viewerGuildId = projectPlayerGuilds(world, viewer).viewerGuildId;
  } catch {
    guildProjectionAvailable = false;
  }

  content.append(node('h3', { class: 'section-title', text: 'PLAYER GUILD' }));
  if (!guildProjectionAvailable) {
    content.append(paragraph('The retained guild history could not be projected safely. No membership action is offered.', 'evidence-warning'));
  } else if (!targetGuild) {
    content.append(paragraph('No active player-guild membership is retained for this session.', 'empty-note'));
  } else {
    content.append(node('article', { class: 'field-card', 'data-player-profile-guild': targetGuild.id }, [
      node('h3', { text: targetGuild.name }),
      paragraph(targetGuild.charter),
      paragraph('Members ' + targetGuild.memberCount + '/' + PLAYER_GUILD_MEMBER_LIMIT +
        ' · leader ' + targetGuild.leader.name + ' (' + targetGuild.leader.role + ')'),
      paragraph('Self-joined game membership only; not institutional authority, endorsement, or a vote.', 'form-help')
    ]));
    if (sameResearchActor(actor, viewer)) {
      content.append(paragraph('This presence shares your current actor ID and role. It is not a separate actor for guild admission.', 'form-help'));
    } else if (viewerGuildId === targetGuild.id) {
      content.append(paragraph('You are already a member of this guild.', 'status-line'));
    } else if (viewerGuildId) {
      content.append(paragraph('Your current session already belongs to another active guild. Leave that guild through Guild Hall before joining another.', 'form-help'));
    } else if (targetGuild.memberCount >= PLAYER_GUILD_MEMBER_LIMIT) {
      content.append(paragraph('This guild roster is full. No join action is available.', 'evidence-warning'));
    } else {
      content.append(button('Join ' + targetGuild.name, guarded(async () => {
        await act({ type: 'join-guild', guildId: targetGuild.id });
        toast('Joined ' + targetGuild.name + '. This is a retained game membership, not authority or endorsement.');
        openPlayerProfile(player);
      }), {
        class: 'primary-button',
        'data-player-profile-join-guild': targetGuild.id
      }));
    }
  }

  content.append(node('h3', { class: 'section-title', text: 'PUBLIC COMMONS POSTS' }));
  let posts = [];
  try {
    const muted = readMutedCommonsAuthors();
    const feed = projectTownSquare(world, viewer, { mutedAuthors: muted.authors });
    posts = feed.messages.filter(message =>
      message.author?.id === actor.id && message.author?.role === actor.role
    ).slice(0, 5);
  } catch {
    content.append(paragraph('The public Commons projection is unavailable; no retained message was inferred.', 'evidence-warning'));
  }
  if (!posts.length) {
    content.append(paragraph('No recent public Commons posts from this session are available in this view.', 'empty-note'));
  } else {
    for (const message of posts) {
      content.append(node('article', { class: 'field-card', 'data-player-profile-post': message.messageId }, [
        paragraph(message.text),
        paragraph(message.at + (message.hidden ? ' · hidden after human review' : ' · public Commons post'), 'attribution')
      ]));
    }
  }
}

const $=id=>document.getElementById(id);
const STORAGE='ngl.common-ground.v2',BACKUP=STORAGE+'.backup',BACKUP_SCHEMA='ngl.private-backup.v1',ACTOR=STORAGE+'.actor',PENDING_SHARED_ACTION='ngl.common-ground.pending-shared-action.v1';
const recipes={comic:{title:'The First Field Notes',description:'An actual reader for the recovered No_Gas_Labs comic.',intent:'Open the recovered comic pages and let the source speak in its own ink.'},loom:{title:'A Small Unicode Loom',description:'Turn your own Unicode marks into a Web Audio melody.',intent:'Make a small instrument where every character has a voice.'},observatory:{title:'The Source Observatory',description:'Keep observations beside sources and uncertainty.',intent:'Hold a claim beside its evidence and the question that might undo it.'},custom:{title:'A Request Worth Carrying',description:'Sandbox your own HTML, or carry a portable AI work request.',intent:'Prepare a bounded request with evidence, uncertainty and a testable next step.'}};
const guides={relay:{title:'Carry the question.',name:'The Relay',voice:'An authored note from the relay keeper',body:'A relay is useful because something can leave it. Write a request that another person or tool can understand without this conversation. Give it a boundary, the evidence you have, and a way to tell whether it helped.',practice:'Make a portable request. Carry it to a provider you choose. Until a response actually returns, record “not executed”.',recipe:'custom'},river:{title:'The river remembers bytes.',name:'River of Receipts',voice:'An authored note from the river keeper',body:'A receipt can tell you which bytes crossed this bridge. It cannot tell you whether the words inside are true. Keep the source, keep the uncertainty, and leave enough of the trail for someone else to disagree.',practice:'Make an observatory. Put one claim beside a source and one thing that could change your mind.',recipe:'observatory'},overlook:{title:'Make room for another voice.',name:'The Long View',voice:'An authored note from the lookout',body:'From here the buildings look like a plan. Down on the path, each one is an attempt. A useful institution can keep the attempt, hear a contribution, and repair the part that failed without pretending the first version never happened.',practice:'Publish a creation, add a note, then repair it. Version one stays in the archive. A checked repair earns a game method.',recipe:'loom'},ruins:{title:'Unfinished is a useful state.',name:'The Unfinished',voice:'An authored note left among the stones',body:'These stones are not a failed city full of imaginary inhabitants. They are an invitation to make one small thing that works. A readable page. A playable sound. A question with a source. Start with something you can actually open.',practice:'Give the recovered comic a home. Read a page before making a claim about it.',recipe:'comic'}};
let mode=null,world=createWorld(),viewer={id:'private-founder',name:'Damien',role:'founder'},presence=[],institution=null,stream=null,selectedDraft=null,selectedCreation=null,selectedVersion=null,lastFocus=null,toastTimer,launchReport=null,launchHTML=null,busy=false,savingError=false,activeNoteRenderer=null,portalGeneration=0,portalReadyListener=null,portalInteractionListener=null;
const node=(tag,attrs={},children=[])=>{const e=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k==='text')e.textContent=v;else if(k==='class')e.className=v;else if(k==='onClick')e.addEventListener('click',v);else if(k==='value')e.value=v;else if(k==='hidden')e.hidden=v;else e.setAttribute(k,v)}for(const child of Array.isArray(children)?children:[children])if(child!==undefined&&child!==null)e.append(typeof child==='string'?document.createTextNode(child):child);return e};
const paragraph=(text,className)=>node('p',{text,class:className||''});
const button=(text,onClick,attrs={})=>node('button',{type:'button',text,onClick,...attrs});
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?8000:5000)}
function handleError(error){console.error(error);toast(error.message||'That action could not be completed.',true)}
function guarded(fn){return async(...args)=>{try{return await fn(...args)}catch(error){handleError(error)}}}
function download(name,content,type='text/html'){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const link=node('a',{href:url,download:name});document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
async function request(path,body){let response;try{response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},credentials:'same-origin',...(body===undefined?{}:{body:JSON.stringify(body)})})}catch{setConnection(false);throw new Error('The shared world is unreachable. Your role has not changed. Reconnect to continue.')}let data;try{data=await response.json()}catch{throw new Error('The shared service did not return a readable response.')}if(!response.ok)throw Object.assign(new Error(data.error?.message||data.message||data.error||`Request failed (${response.status}).`),{code:data.error?.code||data.code,status:response.status});return data}
function stableActionJSON(value){if(Array.isArray(value))return value.map(stableActionJSON);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>[key,stableActionJSON(value[key])]));return value}
function readPendingSharedAction(){let raw;try{raw=localStorage.getItem(PENDING_SHARED_ACTION)}catch{throw new Error('Device storage is unavailable; shared writes are paused because a retry receipt cannot be checked.')}if(!raw)return null;let pending;try{pending=JSON.parse(raw)}catch{throw new Error('The saved shared-action retry receipt is unreadable. Do not clear it until the uncertain action is reconciled.')}if(!pending||typeof pending.requestId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(pending.requestId)||typeof pending.actorId!=='string'||!['founder','witness'].includes(pending.actorRole)||!pending.action||typeof pending.action.type!=='string')throw new Error('The saved shared-action retry receipt is malformed. Preserve it for reconciliation before starting another shared action.');return pending}
function savePendingSharedAction(pending){try{localStorage.setItem(PENDING_SHARED_ACTION,JSON.stringify(pending))}catch{throw new Error('Device storage could not preserve the retry receipt. The shared action was not sent.')}}
function clearPendingSharedAction(requestId){try{const current=readPendingSharedAction();if(current?.requestId===requestId)localStorage.removeItem(PENDING_SHARED_ACTION);return true}catch{throw new Error('The server result was received, but this device could not clear its retry receipt. Retry only that same action until storage is available.')}}
async function submitPendingSharedAction(pending){
  if(pendingSharedActionInFlight===pending.requestId)throw new Error('This exact shared action is already being submitted. Wait for its result before retrying.');
  pendingSharedActionInFlight=pending.requestId;
  try{
    let dto;
    try{dto=await request('/api/action',{...pending.action,requestId:pending.requestId})}
    catch(error){
      if(error.status&&error.status<500&&error.status!==401&&error.status!==403&&error.code!=='IDEMPOTENCY_CONFLICT')clearPendingSharedAction(pending.requestId);
      throw error;
    }
    acceptState(dto);
    clearPendingSharedAction(pending.requestId);
    const result=dto.result||{};
     return dto.idempotentReplay===true?{...result,idempotentReplay:true}:result;
  }finally{
    if(pendingSharedActionInFlight===pending.requestId)pendingSharedActionInFlight=null;
    refreshRelayRecovery();
  }
}
async function recoverPendingSharedAction(){
  if(mode!=='shared'||pendingSharedActionInFlight)return false;
  let pending;
  try{pending=readPendingSharedAction()}catch(error){handleError(error);return false}
  if(!pending||pending.actorId!==viewer.id||pending.actorRole!==viewer.role)return false;
  try{
    await submitPendingSharedAction(pending);
    toast('The Relay recovered the exact pending action after reconnection.');
    return true;
  }catch(error){
    handleError(error);
    return false;
  }
}
function setConnection(connected){
  const networkAvailable=globalThis.navigator?.onLine!==false;
  const online=mode==='shared'?connected&&networkAvailable:networkAvailable;
  const dot=$('connection-dot');
  dot.classList.toggle('online',online);
  dot.classList.toggle('offline',!online);
  dot.title=online?'Network available':mode==='shared'?'Shared service disconnected; reconnecting':mode==='private'?'Offline; private work remains on this device':'Offline';
  dot.setAttribute('aria-label',dot.title);
  if(mode==='shared'&&!online)$('mode-label').textContent=`Shared · ${viewer.role==='founder'?'Founder':'Witness'} · reconnecting`;
}
globalThis.addEventListener?.('offline',()=>setConnection(false));
globalThis.addEventListener?.('online',()=>{if(mode==='private')setConnection(true);else if(mode==='shared'){void (async()=>{await recoverPendingSharedAction();await reconcileSharedPosition();})();}});
function isPortablePosition(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  let prototype,descriptors;
  try{prototype=Object.getPrototypeOf(value);descriptors=Object.getOwnPropertyDescriptors(value)}catch{return false}
  if(prototype!==Object.prototype&&prototype!==null)return false;
  const keys=Reflect.ownKeys(descriptors);
  if(keys.length!==2||keys.some(key=>key!=='x'&&key!=='y'))return false;
  for(const key of ['x','y']){
    const descriptor=descriptors[key];
    if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable)return false;
  }
  return Number.isFinite(value.x)&&Number.isFinite(value.y)&&value.x>=0&&value.x<=1600&&value.y>=0&&value.y<=1000;
}
function persist(next,backupPosition=readPrivatePlayerPosition()||{x:180,y:640}){try{const existing=localStorage.getItem(STORAGE);if(existing){let previousWorld=null;try{previousWorld=JSON.parse(existing)}catch{/* Preserve the last known-good backup when the current save is unreadable. */}if(previousWorld&&typeof previousWorld==='object'&&!Array.isArray(previousWorld))localStorage.setItem(BACKUP,JSON.stringify({schema:BACKUP_SCHEMA,world:previousWorld,playerPosition:backupPosition}))}localStorage.setItem(STORAGE,JSON.stringify(next));savingError=false}catch{savingError=true;throw new Error('Device storage is full or unavailable. The change was not saved. Export your world from the Journal before clearing space.')}}
async function loadPrivate(){for(const key of [STORAGE,BACKUP]){let raw;try{raw=localStorage.getItem(key)}catch{toast('Device storage is unavailable. Export a copy to keep this session.',true);return createWorld()}if(!raw)continue;try{const parsed=JSON.parse(raw);const backupEnvelope=key===BACKUP&&parsed?.schema===BACKUP_SCHEMA;const candidate=await validateWorld(backupEnvelope?parsed.world:parsed);if(key===BACKUP){const restoredPosition=backupEnvelope?parsed.playerPosition:{x:180,y:640};if(!isPortablePosition(restoredPosition)||!writePrivatePlayerPosition(restoredPosition)){toast('The backup world is valid, but its character position could not be restored. The backup was not opened.',true);continue}try{localStorage.setItem(STORAGE,JSON.stringify(candidate))}catch{toast('The backup is valid but device storage could not restore it. Export a copy.',true)}toast('Recovered the last valid world and character position. Export a copy from the Journal.')}return candidate}catch{toast('The saved copy did not pass its byte checks. Checking the backup.',true)}}return createWorld()}
function privateActor(){let id;try{id=localStorage.getItem(ACTOR);if(!id){id=crypto.randomUUID();localStorage.setItem(ACTOR,id)}}catch{id=crypto.randomUUID()}return {id,name:'Damien',role:'founder'}}
function acceptState(dto,{forcePosition=false}={}){if(!dto?.world||!dto.viewer)throw new Error('Incomplete shared state.');const demoted=viewer.role==='founder'&&dto.viewer.role!=='founder';world=dto.world;viewer=dto.viewer;const player={id:viewer.presenceId||viewer.id};const serverPosition=dto.viewer.position;if(serverPosition&&Number.isFinite(serverPosition.x)&&Number.isFinite(serverPosition.y)&&(forcePosition||(!view.moving&&!view.route?.length))){player.x=serverPosition.x;player.y=serverPosition.y;}view.setPlayer(player);presence=dto.presence||[];institution=institutionSummaryFromState(dto);setConnection(true);if(viewer.role!=='founder'){selectedDraft=null;if(demoted||(!$('portal').hidden&&$('portal-kicker').textContent==='PRIVATE DRAFT')){closePortal();closeSheet();$('sheet-content').replaceChildren();$('sheet-title').textContent='';$('portal-title').textContent='';$('portal-footer').replaceChildren();}}render();if($('sheet-content')?.querySelector('[data-field-kit-root]')||$('sheet-content')?.querySelector('[data-field-forge-root]'))refreshForgePanels();}
async function act(action){const {requestId:suppliedRequestId,...payload}=action;const normalized=JSON.parse(JSON.stringify(payload));if(mode==='shared'){let pending=readPendingSharedAction();if(pending){if(pending.actorId!==viewer.id||pending.actorRole!==viewer.role)throw new Error('A previous shared action has an uncertain outcome under a different session. Re-authenticate as the original actor and resolve it from the Field Journal before starting another shared action.');if(JSON.stringify(stableActionJSON(pending.action))!==JSON.stringify(stableActionJSON(normalized)))throw new Error('A previous shared action has an uncertain outcome. Open the Field Journal and retry that exact action before starting another shared action.');if(suppliedRequestId&&pending.requestId!==suppliedRequestId)throw new Error('The pending Relay receipt uses a different stable request ID; resolve it before importing again.');}else{pending={requestId:suppliedRequestId||crypto.randomUUID(),actorId:viewer.id,actorRole:viewer.role,action:normalized};savePendingSharedAction(pending)}return submitPendingSharedAction(pending)}if(mode!=='private')throw new Error('Enter your world first.');const next=await applyAction(world,normalized,viewer);persist(next.world);world=next.world;render();return next.result;}
const view=new PixelWorldView($('world'),{onInteract:interaction=>{if(mode){if(interaction.type==='player')openPlayerProfile(interaction.player);else if(interaction.type==='research-activity')openMoonshotField(interaction.moonshotId,interaction.activityId);else if(interaction.type==='research-object')openMoonshotField(interaction.id);else if(interaction.type==='workbench')openWorkshop();else if(interaction.type==='creation')openCreation(interaction.id);else if(interaction.type==='institution')guarded(()=>typeof interaction.npcRoleId==='string'
  ? openGuildNpcInteraction(interaction)
  : openInstitutionLocation(interaction.id))();else openGuide(interaction.id)}},onDiscover:guarded(async id=>{if(!mode)return;if(mode==='shared'){try{await submitSharedPosition(view.getPlayer())}catch(error){await reconcileSharedPosition();throw error}}const result=await act({type:'discover',locationId:id});if(result.discovered)toast(guides[id].name+' discovered · a new field note, no XP.')}),onPosition:guarded(async p=>{if(mode==='shared'){try{await submitSharedPosition(p)}catch(error){await reconcileSharedPosition();throw error}}else if(mode==='private')writePrivatePlayerPosition(p)})});
async function submitSharedPosition(position){const result=await request('/api/presence',{x:position.x,y:position.y});if(result.position&&!view.moving&&!view.route.length)view.setPlayer({id:viewer.presenceId||viewer.id,x:result.position.x,y:result.position.y});return result;}
async function reconcileSharedPosition(){if(mode!=='shared')return;try{const dto=await request('/api/state');view.keys.clear();view.setInput({x:0,y:0});view.cancelRoute();acceptState(dto,{forcePosition:true});}catch(error){handleError(error);}}
view.setWorld(world);
function appendStudyCardCollection(target,record,{heading='PERSONAL COLLECTION · STUDY CARDS',maxItems=20}={}){
  const cards=Array.isArray(record.studyCards)?record.studyCards:[];
  const total=Number.isSafeInteger(record.studyCardTotal)?record.studyCardTotal:cards.length;
  const panel=node('section',{class:'field-card','data-study-card-collection':heading.toLowerCase().replaceAll(' ','-')},[
    node('h3',{text:heading+' · '+total}),
    paragraph('Read-only collectibles projected from unique study attempts linked to retained published versions. A reflection is recorded practice, not mastery, truth, evidence, or XP; these cards do not transfer item ownership.','form-help')
  ]);
  const visibleCount=Math.min(cards.length,Math.max(0,Number.isSafeInteger(maxItems)?maxItems:20));
  if(total>visibleCount)panel.append(paragraph('Showing the newest '+visibleCount+' of '+total+' cards. Older cards remain in the Chronicle.','form-help'));
  if(record.studyCardUnavailableCount>0)panel.append(paragraph(record.studyCardUnavailableCount+' study attempt(s) remain in the retained event history but are not shown as cards because their event identity, required note fields, source version, or chronology is missing, malformed, or ambiguous.','form-help'));
  if(!cards.length)panel.append(paragraph(record.studyCardUnavailableCount>0
    ? 'No Study Cards can be projected yet. The underlying attempts remain in retained history; a card requires a unique event identity, complete note fields, and a valid published-version link.'
    : 'No linked study attempts have been recorded for this character yet.','empty-note'));
  for(const card of cards.slice(0,maxItems)){
    const row=node('article',{class:'note-entry','data-study-card':card.id},[
      node('div',{class:'eyebrow',text:card.reviewStatus==='reflection-recorded'?'REFLECTION RECORDED':'ATTEMPT RECORDED'}),
      node('h4',{text:card.title}),
      paragraph('Question: '+card.question),
      paragraph('Attempt: '+card.attempt),
      paragraph('Next check: '+card.nextCheck),
      paragraph(card.status,'form-help')
    ]);
    row.append(button('Return to exact source →',()=>openCreation(card.creationId,card.version),{
      class:'list-button','data-study-card-open':card.id
    }));
    panel.append(row);
  }
  target.append(panel);
}

function openCharacterSheet(){
  const record=projectCharacter(world,viewer);
  const content=showSheet('Character & field record','GAME STATUS · ACTIVITY LEDGER');
  content.append(paragraph('A deterministic, read-only projection of this world’s saved records. These counts are game activity, not proof of real-world competence, external truth, human approval or AI execution.'));
  content.append(node('article',{class:'field-card'},[
    node('h3',{text:'Level '+record.level}),
    paragraph(record.xp+' character XP from retained, version-matched publications · '+record.xpIntoLevel+' / '+record.xpPerLevel+' XP toward level '+(record.level+1)+'. '+record.worldXp+' institution-wide XP across the world.')
  ]));
  content.append(node('h3',{text:'Skills · recorded activity'}));
  for(const skill of record.skills)content.append(node('article',{class:'field-card','data-skill-id':skill.id},[
    node('h3',{text:skill.label}),paragraph(skill.count+' recorded '+skill.record+'.'),paragraph(skill.basis)
  ]));
  appendStudyCardCollection(content,record);
  content.append(buildFieldKitSection({onChange:openCharacterSheet}));
  content.append(node('h3',{text:'World inventory · published places'}));
  if(!record.inventory.length)content.append(paragraph('No published places yet. Private drafts are not in the world inventory.'));
  for(const item of record.inventory){
    const children=[node('h3',{text:item.title}),paragraph(item.kind.toUpperCase()+' · version '+item.version)];
    if(item.receipt)children.push(node('small',{text:'SHA-256 '+item.receipt.digest+' · '+item.receipt.size+' bytes'}));
    content.append(node('article',{class:'field-card'},children));
  }
  content.append(node('h3',{text:'Field satchel · retained Commons activity'}));
  content.append(paragraph('A bounded, read-only index of this character’s own retained TownSquare messages. Each item points back to the Commons. Conversation is not evidence, truth, approval, authority or XP. Human-hidden posts remain in the record with the public redaction.','form-help'));
  if(!record.fieldSatchel.length)content.append(paragraph('No retained Commons messages are recorded for this character yet.'));
  if(record.fieldSatchelOmittedCount>0)content.append(paragraph('Showing the newest '+record.fieldSatchel.length+' of '+record.fieldSatchelTotal+' retained Commons messages. Older messages remain in the Chronicle.','form-help'));
  for(const item of record.fieldSatchel){
    const date=Number.isFinite(Date.parse(item.at))?new Date(item.at).toLocaleString():item.at;
    const details=[item.status,date,'event '+item.eventId,'message '+item.messageId].join(' · ');
    const children=[node('h3',{text:item.title}),paragraph(details)];
    if(item.summary)children.push(paragraph(item.summary));
    if(item.action)children.push(button('Return to TownSquare →',()=>followQuestAction(item.action),{class:'list-button','data-field-satchel-return':item.eventId}));
    content.append(node('article',{class:'field-card','data-field-satchel-item':item.eventId},children));
  }
  content.append(node('h3',{text:'Recent field trail'}));
  if(!record.recentActivity.length)content.append(paragraph('No activity events are recorded for this character yet.'));
  for(const item of record.recentActivity){
    const date=Number.isFinite(Date.parse(item.at))?new Date(item.at).toLocaleString():item.at;
    const details=[item.creationId?'creation '+item.creationId:null,item.version!==null?'version '+item.version:null,item.locationId?'location '+item.locationId:null].filter(Boolean).join(' · ');
    content.append(node('article',{class:'field-card'},[node('h3',{text:item.type.toUpperCase()}),paragraph(date+(details?' · '+details:''))]));
  }
}
function followResearchTarget(object,fallback,targetType){
  if(!object){fallback();return}
  closeSheet();
  view.goTo(object.id,targetType);
  if(view.target!==object.id){fallback();return}
  if(!view.route.length){
    const nearest=view.nearest(object.id,targetType);
    if(nearest?.id===object.id&&nearest.distance<160){view.interact(object.id,targetType);return}
    fallback();
  }
}
function followQuestAction(action){
  if(!action||typeof action.type!=='string')return;
  if(action.type==='quest-route'){
    if(action.action==='workbench'){closeSheet();view.goTo('workbench');return}
    if(action.action==='places'){closeSheet();openPlaces();return}
    if(action.action==='trail'){$('quest-trail')?.scrollIntoView({behavior:'smooth',block:'nearest'});return}
    return;
  }
  if(action.type==='workbench'&&['comic','loom','observatory','custom'].includes(action.recipe)){openWorkshop(action.recipe);return}
  if(action.type==='research-object'&&typeof action.id==='string'&&typeof action.moonshotId==='string'){
    const object=(Array.isArray(view.researchObjects)?view.researchObjects:[]).find(item=>item.id===action.id&&item.moonshotId===action.moonshotId);
    followResearchTarget(object,()=>openMoonshotField(action.moonshotId),'research-object');return;
  }
  if(action.type==='research-activity'&&typeof action.id==='string'&&typeof action.moonshotId==='string'&&typeof action.activityId==='string'){
    const object=(Array.isArray(view.researchActivityObjects)?view.researchActivityObjects:[]).find(item=>item.id===action.id&&item.moonshotId===action.moonshotId&&item.activityId===action.activityId);
    if(object?.mapVisible){followResearchTarget(object,()=>openMoonshotField(action.moonshotId,action.activityId),'research-activity');return}
    openMoonshotField(action.moonshotId,action.activityId);return;
  }
  if(action.type==='location'&&typeof action.id==='string'){
    const npc=GUILD_NPCS.find(candidate=>candidate.id===action.id);
    if(npc){closeSheet();view.goTo(action.id,'npc');return}
    if(PLACES.some(place=>place.id===action.id)){
      closeSheet();view.goTo(action.id);return;
    }
  }
  if(action.type==='creation'&&typeof action.id==='string'&&Number.isInteger(action.version)){openCreation(action.id,action.version)}
}
function renderQuestTrail(milestones,list=$('quest-trail')){if(!list)return;list.replaceChildren();for(const item of milestones){const count=item.evidenceIds.length;const row=node('li',{class:'quest-step '+(item.complete?'is-recorded':'is-open'),'data-objective-id':item.id});row.append(node('span',{class:'quest-step-state',text:item.complete?'RECORDED':'OPEN'}));row.append(node('strong',{text:item.title}));if(typeof item.interpretation==='string')row.append(node('small',{class:'quest-interpretation',text:item.interpretation}));row.append(node('small',{text:item.progress+'/'+item.target+' · '+count+' retained event'+(count===1?'':'s')}));if(!item.complete&&item.action)row.append(button('Go do this →',()=>followQuestAction(item.action),{class:'text-button quest-action'}));else if(!item.complete&&item.blockedReason)row.append(node('small',{class:'quest-blocked',text:item.blockedReason}));if(count){const disclosure=node('details',{class:'quest-evidence'});disclosure.append(node('summary',{text:'Inspect retained evidence'}));const entries=node('ul',{class:'quest-evidence-list'});for(const evidence of (item.evidence||[])){const facts=[evidence.type?evidence.type.toUpperCase():null,evidence.actorId?'actor '+evidence.actorId:null,evidence.locationId?'location '+evidence.locationId:null,evidence.creationId?'creation '+evidence.creationId:null,evidence.version!==null&&evidence.version!==undefined?'version '+evidence.version:null,evidence.collaboratorRole?'role '+evidence.collaboratorRole:null,evidence.validationStatus?'validation '+evidence.validationStatus:null,evidence.itemId?'item '+evidence.itemId:null,evidence.slotId?'slot '+evidence.slotId:null,evidence.sourceEventId?'source event '+evidence.sourceEventId:null,evidence.sourceEventIds?.length?'sources '+evidence.sourceEventIds.join(', '):null,evidence.at?'at '+evidence.at:null].filter(Boolean);const entry=node('li');entry.append(node('span',{text:facts.join(' · ')}));entry.append(node('code',{text:evidence.id}));const retained=world.creations.find(creation=>creation.id===evidence.creationId);if(retained&&Number.isInteger(evidence.version)&&[retained,...(Array.isArray(retained.versions)?retained.versions:[])].some(version=>version.version===evidence.version)){entry.append(button('Open retained version '+evidence.version+' →',()=>openCreation(evidence.creationId,evidence.version),{class:'text-button quest-evidence-open'}));}
const proposalObject=evidence.type==='moonshot-proposed'?view.researchObjects.find(object=>object.eventId===evidence.id):null;
if(proposalObject){
 entry.append(button('Inspect moonshot proposal →',()=>followResearchTarget(proposalObject,()=>openMoonshotField(proposalObject.moonshotId),'research-object'),{class:'text-button quest-evidence-open quest-evidence-world-object'}));
}else if(evidence.type==='experiment-reported'||evidence.type==='experiment-challenged'){
 const activityObject=view.researchActivityObjects.find(object=>object.eventId===evidence.id);
 if(activityObject){
  const label=evidence.type==='experiment-challenged'?'Inspect dissent →':'Inspect attempt →';
  entry.append(button(label,()=>{
   const fallback=()=>openMoonshotField(activityObject.moonshotId,activityObject.activityId);
   if(activityObject.mapVisible)followResearchTarget(activityObject,fallback,'research-activity');
   else fallback();
  },{class:'text-button quest-evidence-open quest-evidence-world-object'}));
 }
}entries.append(entry);}disclosure.append(entries);row.append(disclosure);}list.append(row);}}
function render(){view.setWorld(world,mode==='shared'?institution:null,viewer);view.setPresence(presence.filter(p=>p.id!==(viewer.presenceId||viewer.id)));$('creation-count').textContent=world.creations.length;$('xp-count').textContent=world.xp;const character=projectCharacter(world,viewer);$('character-button').querySelector('.character-level').textContent=String(character.level);$('character-button').title='Level '+character.level+' · '+character.xp+' character XP';$('character-button').setAttribute('aria-label','Open character record: level '+character.level+', '+character.xp+' character XP');$('mode-label').textContent=mode==='shared'?`Shared world · ${viewer.role==='founder'?'Founder':'Witness'}`:mode==='private'?'Private world · saved on this device':'A world waiting to happen';$('login-button').hidden=mode!=='shared'||viewer.role==='founder';$('logout-button').hidden=mode!=='shared'||viewer.role!=='founder';$('make-button').textContent=viewer.role==='founder'?'＋ Make something':'◇ Witness & explore';const questTrail=getQuestTrail(world,viewer);const quest=getActiveQuest(world,viewer,questTrail);const nextQuestAction=quest.nextAction||questTrail.find(item=>!item.complete&&item.action)?.action||null;view.setQuestTarget(nextQuestAction);$('quest-title').textContent=quest.title;$('quest-copy').textContent=quest.copy;$('quest-button').textContent=quest.button;renderQuestTrail(questTrail);if(activeNoteRenderer&&!$('sheet').hidden)activeNoteRenderer();}
async function startPrivate(){stream?.close();stream=null;mode='private';viewer=privateActor();world=await loadPrivate();const savedPosition=readPrivatePlayerPosition();view.setPlayer({id:viewer.id,...(savedPosition||{x:180,y:640})});presence=[];institution=null;selectedDraft=null;$('doorway').hidden=true;$('play-ui').hidden=false;setConnection(true);render();view.canvas.focus({preventScroll:true})}
async function startShared(){const dto=await request('/api/state');stream?.close();mode='shared';acceptState(dto,{forcePosition:true});$('doorway').hidden=true;$('play-ui').hidden=false;selectedDraft=null;stream=new EventSource('/api/events');stream.addEventListener('world',e=>{try{acceptState(JSON.parse(e.data))}catch(error){handleError(error)}});stream.addEventListener('presence',e=>{try{presence=JSON.parse(e.data);view.setPresence(presence.filter(p=>p.id!==(viewer.presenceId||viewer.id)));if($('sheet-content')?.querySelector('[data-field-kit-root]')||$('sheet-content')?.querySelector('[data-field-forge-root]'))refreshForgePanels()}catch{}});stream.onerror=()=>setConnection(false);stream.onopen=()=>setConnection(true);toast('You arrived as '+(viewer.role==='founder'?'Founder.':'Witness. Explore, read, contribute.'));await recoverPendingSharedAction();view.canvas.focus({preventScroll:true})}
function showSheet(title,kicker='FIELD NOTES'){institutionRequestGeneration++;activeNoteRenderer=null;if($('sheet').hidden)lastFocus=document.activeElement;$('sheet-title').textContent=title;$('sheet-kicker').textContent=kicker;$('sheet-content').replaceChildren();$('sheet-backdrop').hidden=false;$('sheet').hidden=false;document.body.classList.add('modal-open');$('sheet').scrollTop=0;$('sheet-close').focus({preventScroll:true});return $('sheet-content')}
function closeSheet(){institutionRequestGeneration++;activeNoteRenderer=null;$('sheet').hidden=true;$('sheet-backdrop').hidden=true;if($('portal').hidden){document.body.classList.remove('modal-open');(lastFocus?.isConnected?lastFocus:$('world')).focus({preventScroll:true})}}
function sandboxDocument(html,bootstrap=''){for(const page of globalThis.NGL_ASSETS?.pages||[])if(page.path&&/^\/assets\/comic\/(cover_a|p3|p4|p5|p10|p13)\.jpg$/.test(page.path)&&typeof page.src==='string'&&page.src.startsWith('data:image/jpeg;base64,'))html=html.split(page.path).join(page.src);const localImages=location.protocol==='http:'||location.protocol==='https:'?['cover_a','p3','p4','p5','p10','p13'].map(p=>`${location.origin}/assets/comic/${p}.jpg`).join(' '):'';const policy=`default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: ${localImages}; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;const trustedHead=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${bootstrap}`;const opening=html.match(/^\s*<!doctype html>\s*<html(?:\s[^>]*)?>\s*<head(?:\s[^>]*)?>/i);return opening?trustedHead+html.slice(opening[0].length):`${trustedHead}</head><body>${html}</body></html>`;}
// Keep the child visible beneath the loading cover while it paints. A parent load
// event does not establish that Chromium has published the child's input surface.
function openPortal({title,html,kicker='A LIVING CREATION',footer=[],stage=false,nativeFileSurface=false,sourceObservationTarget=null}){
  if($('sheet').hidden)lastFocus=document.activeElement;
  if(portalInteractionListener){removeEventListener('message',portalInteractionListener);portalInteractionListener=null;}
  const generation=++portalGeneration,oldFrame=$('artifact-frame'),frame=oldFrame.cloneNode(false);
  oldFrame.onload=null;frame.removeAttribute('srcdoc');
  frame.title=title;frame.setAttribute('tabindex','0');
  frame.style.removeProperty('visibility');frame.style.removeProperty('pointer-events');
  frame.removeAttribute('data-ngl-input-ready');frame.setAttribute('aria-busy','true');$('portal').classList.add('portal-loading');
  $('portal-title').textContent=title;$('portal-kicker').textContent=kicker;
  const nativeControls=[];
  const nativeNotebook=!!nativeFileSurface&&window.__nglNativeFileBridgeInstalled===true;
  const observationTarget=sourceObservationTarget&&nativeFileSurface&&mode==='shared'&&
    typeof sourceObservationTarget.creationId==='string'&&Number.isSafeInteger(sourceObservationTarget.version)&&sourceObservationTarget.version>0
    ?{creationId:sourceObservationTarget.creationId,version:sourceObservationTarget.version}:null;
  const nativeSourceKindLabels=Object.freeze({
    unspecified:'Not classified',
    'direct-observation':'Direct observation',
    'primary-source':'Primary source / document',
    'secondary-source':'Secondary source / analysis',
    'tool-output':'Tool output / execution receipt',
    'user-report':'User-reported',
    'model-assertion':'Model assertion (lead only; not evidence)'
  });
  let nativeReviewPanel=null,nativeReviewPreview=null,nativeReviewSummary=null,nativeReviewList=null,nativeReviewAppend=null,nativeReviewPreviewId=null;
  const sendNativeReviewCommand=(type,extra={})=>{
    if(!nativeNotebook||generation!==portalGeneration||$('artifact-frame')!==frame||$('portal').hidden||!frame.contentWindow)return false;
    try{frame.contentWindow.postMessage({type,generation,...extra},'*');return true}catch{return false}
  };
  if(nativeNotebook){
    frame.addEventListener('load',()=>{
      if(generation!==portalGeneration||$('artifact-frame')!==frame||$('portal').hidden)return;
      frame.contentWindow?.postMessage({type:'ngl-native-file-bridge-ready'},'*');
    },{once:true});
    nativeReviewPanel=node('section',{
      class:'native-observatory-review',
      'data-native-observatory-review':'true',
      role:'region',
      'aria-label':'Local notebook import review',
      hidden:true
    });
    nativeReviewPreview=button('Preview backup',()=>{
      nativeReviewPreview.disabled=true;
      nativeReviewAppend.disabled=true;
      nativeReviewPreviewId=null;
      nativeReviewList.replaceChildren();
      nativeReviewSummary.textContent='Validating the selected backup. No notes have been appended.';
      if(!sendNativeReviewCommand('ngl-native-file-preview-request')){
        nativeReviewPreview.disabled=false;
        nativeReviewSummary.textContent='The notebook is not ready. No notes were appended.';
      }
    },{class:'secondary-button','data-native-observatory-preview':'true'});
    nativeReviewSummary=node('p',{
      class:'native-observatory-review-status',
      role:'status',
      'aria-live':'polite',
      text:'Restore a notebook backup to preview its contents.'
    });
    nativeReviewList=node('ol',{class:'native-observatory-review-list'});
    nativeReviewAppend=button('Append previewed notes',()=>{
      if(!nativeReviewPreviewId)return;
      nativeReviewAppend.disabled=true;
      if(!sendNativeReviewCommand('ngl-native-file-append-request',{previewId:nativeReviewPreviewId})){
        nativeReviewAppend.disabled=false;
        nativeReviewSummary.textContent='The review panel could not reach the notebook. No notes were appended.';
      }
    },{class:'primary-button','data-native-observatory-append':'true',disabled:true});
    nativeReviewPanel.append(
      node('h3',{text:'Review local notebook import'}),
      nativeReviewPreview,
      nativeReviewSummary,
      nativeReviewList,
      nativeReviewAppend,
      paragraph('Imported notes remain local to this device. Source retrieval and independent verification are not performed; no canonical event, evidence, XP or approval is created.','form-help')
    );
    nativeControls.push(
      paragraph('Native notebook transfer · bounded to 2 MiB · restored notes remain local and unverified.','form-help'),
      button('↓ Save notebook backup',()=>{
        if(!window.__nglNativeRequestArtifactExport?.())toast('The native notebook export bridge is not ready.',true);
      },{class:'secondary-button','data-native-observatory-export':'true'}),
      button('↑ Restore notebook backup',()=>{
        if(!window.__nglNativeRequestArtifactImport?.())toast('The native notebook import bridge is not ready.',true);
      },{class:'secondary-button','data-native-observatory-import':'true'}),
      nativeReviewPanel
    );
  }
  if(nativeNotebook||observationTarget){
    const exactKeys=(value,keys)=>Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
    const boundedText=value=>typeof value==='string'&&Array.from(value).length<=500;
    portalInteractionListener=event=>{
      if(generation!==portalGeneration||$('artifact-frame')!==frame||$('portal').hidden||
         event.source!==frame.contentWindow||event.origin!=='null')return;
      const message=event.data;
      if(!message||typeof message!=='object'||Array.isArray(message))return;
      if(nativeNotebook&&message.type==='ngl-native-file-import-received'){
        if(!exactKeys(message,['name','size','type'])||typeof message.name!=='string'||
           message.name.length<1||message.name.length>128||!Number.isSafeInteger(message.size)||
           message.size<1||message.size>2*1024*1024)return;
        nativeReviewPanel.hidden=false;
        nativeReviewPreviewId=null;
        nativeReviewPreview.disabled=false;
        nativeReviewAppend.disabled=true;
        nativeReviewSummary.textContent='Backup received ('+message.size+' bytes). Preview the local notes before appending.';
        nativeReviewList.replaceChildren();
        return;
      }
      if(nativeNotebook&&message.type==='ngl-native-file-preview-result'){
        if(!exactKeys(message,['additions','canAppend','duplicateCount','generation','previewId','status','type'])||
           message.generation!==generation||typeof message.canAppend!=='boolean'||
           typeof message.status!=='string'||Array.from(message.status).length>500||
           !Number.isSafeInteger(message.duplicateCount)||message.duplicateCount<0||message.duplicateCount>100||
           !Array.isArray(message.additions)||message.additions.length>100||
           (message.canAppend
             ?typeof message.previewId!=='string'||!/^[0-9]{1,12}$/.test(message.previewId)||message.additions.length===0
             :message.previewId!==null))return;
        const rows=[];
        for(const item of message.additions){
          if(!item||typeof item!=='object'||Array.isArray(item)||
             !exactKeys(item,['claim','source','sourceKind','falsifier','uncertainty','nextTest'])||
             !boundedText(item.claim)||!item.claim.trim()||!boundedText(item.source)||!item.source.trim()||
             !Object.hasOwn(nativeSourceKindLabels,item.sourceKind)||
             !['falsifier','uncertainty','nextTest'].every(key=>item[key]===null||boundedText(item[key])))return;
          const row=node('li',{class:'native-observatory-review-item'},[
            node('h4',{text:item.claim}),
            paragraph('Source class: '+nativeSourceKindLabels[item.sourceKind]),
            paragraph('Source / attribution: '+item.source),
            paragraph('Possible falsifier: '+(item.falsifier??'Not recorded')),
            paragraph('Uncertainty: '+(item.uncertainty??'Not recorded')),
            paragraph('Next test: '+(item.nextTest??'Not recorded'))
          ]);
          if(item.sourceKind==='model-assertion')row.append(paragraph('Model assertion: lead only, not evidence.','form-help'));
          else if(item.sourceKind==='tool-output')row.append(paragraph('Tool output: attributed output, not independent verification.','form-help'));
          rows.push(row);
        }
        nativeReviewPanel.hidden=false;
        nativeReviewPreview.disabled=false;
        nativeReviewPreviewId=message.canAppend?message.previewId:null;
        nativeReviewAppend.disabled=!message.canAppend;
        nativeReviewSummary.textContent=message.status;
        nativeReviewList.replaceChildren(...rows);
        return;
      }
      if(nativeNotebook&&message.type==='ngl-native-file-append-result'){
        if(!exactKeys(message,['addedCount','duplicateCount','generation','previewId','status','type'])||
           message.generation!==generation||message.previewId!==nativeReviewPreviewId||
           !Number.isSafeInteger(message.addedCount)||message.addedCount<0||message.addedCount>100||
           !Number.isSafeInteger(message.duplicateCount)||message.duplicateCount<0||message.duplicateCount>100||
           typeof message.status!=='string'||Array.from(message.status).length>500)return;
        nativeReviewSummary.textContent=message.status;
        nativeReviewPreviewId=null;
        nativeReviewAppend.disabled=true;
        nativeReviewPreview.disabled=false;
        return;
      }
      if(observationTarget&&mode==='shared'&&selectedCreation===observationTarget.creationId&&
         selectedVersion===observationTarget.version&&message.type==='ngl-source-observation-prepare'){
        if(!exactKeys(message,['backup','type']))return;
        try{
          const parsed=parseSourceObservatoryExport(message.backup);
          if(parsed.observations.length!==1)throw new Error('A single observation is required.');
          closePortal();
          openSourceObservation(observationTarget.creationId,observationTarget.version,parsed.observations[0]);
        }catch{
          toast('The local notebook note was rejected; no shared event was created.',true);
        }
      }
    };
    addEventListener('message',portalInteractionListener);
  }
  if(portalReadyListener)removeEventListener('message',portalReadyListener);
  portalReadyListener=event=>{
    if(generation!==portalGeneration||event.source!==frame.contentWindow||event.data?.type!=='ngl-portal-painted'||event.data.generation!==generation)return;
    const listener=portalReadyListener;removeEventListener('message',listener);portalReadyListener=null;
    requestAnimationFrame(()=>{
      if(generation!==portalGeneration||$('artifact-frame')!==frame)return;
      frame.setAttribute('aria-busy','false');$('portal').classList.remove('portal-loading');
      requestAnimationFrame(()=>{
        if(generation!==portalGeneration||$('artifact-frame')!==frame)return;
        frame.setAttribute('data-ngl-input-ready','true');
      });
    });
  };
  addEventListener('message',portalReadyListener);
  const bootstrap='<script>window.__NGL_PARENT_ORIGIN='+JSON.stringify(location.origin)+';window.__NGL_PORTAL_GENERATION='+generation+';window.__NGL_SOURCE_OBSERVATION_AVAILABLE='+Boolean(observationTarget)+';addEventListener("load",()=>requestAnimationFrame(()=>requestAnimationFrame(()=>parent.postMessage({type:"ngl-portal-painted",generation:'+generation+'},"*"))),{once:true})<\/script>';
  oldFrame.replaceWith(frame);$('portal-footer').replaceChildren(...footer,...nativeControls);$('portal').hidden=false;
  frame.srcdoc=stage?html.replace('</head>',bootstrap+'</head>'):sandboxDocument(html,bootstrap);
  document.body.classList.add('modal-open');$('portal-close').focus({preventScroll:true});
}
function closePortal(){portalGeneration++;if(portalReadyListener){removeEventListener('message',portalReadyListener);portalReadyListener=null;}if(portalInteractionListener){removeEventListener('message',portalInteractionListener);portalInteractionListener=null;}$('portal').hidden=true;$('artifact-frame').onload=null;$('artifact-frame').srcdoc='';if($('sheet').hidden){document.body.classList.remove('modal-open');(lastFocus?.isConnected?lastFocus:$('world')).focus({preventScroll:true})}else $('sheet-close').focus({preventScroll:true})}
function requireFounder(){if(viewer.role==='founder')return true;const content=showSheet('A Witness has a voice.','SHARED WORLD · WITNESS');content.append(paragraph('Explore every published creation, leave a contribution, or report a problem. Only the authenticated Founder can draft, repair and publish here.'),paragraph('A private world is yours to make on this device. Switching mode does not grant authority in the shared world.','form-help'),button('Enter your private world',guarded(async()=>{closeSheet();await startPrivate()}),{class:'primary-button'}),node('div',{class:'button-row'},[button('Founder access',openLogin,{class:'secondary-button'})]));return false}
function field(label,id,input){const fragment=document.createDocumentFragment();fragment.append(node('label',{for:id,text:label}),input);return fragment}
function openWorkshop(recipe='comic',draftId=null){if(!requireFounder())return;selectedDraft=draftId?world.drafts.find(d=>d.id===draftId):null;const content=showSheet(selectedDraft?.creationId?'Make the next version.':'Give an idea a place.','THE MAKING BENCH');content.append(paragraph('Choose an authored recipe. Preview the actual artifact, then publish it into the landscape. Drafts are private.'));
  const form=node('form',{},[]),select=node('select',{id:'recipe-select'});for(const [id,r]of Object.entries(recipes))select.append(node('option',{value:id,text:id==='comic'?'Comic archive':id==='loom'?'Unicode music loom':id==='observatory'?'Source observatory':'Custom HTML / portable AI request'}));select.value=selectedDraft?.kind||recipe;
  const title=node('input',{id:'command-input',maxlength:'80',placeholder:'A name for something useful',value:selectedDraft?.title||'',autocomplete:'off'}),intent=node('textarea',{id:'intent-input',maxlength:'2000',rows:'3',placeholder:recipes[select.value].intent,value:selectedDraft?.intent||''}),html=node('textarea',{id:'custom-html',rows:'6',placeholder:'Optional: paste a small, self-contained HTML experience. Leave empty for a portable AI request.'});
  const customWrap=node('div',{id:'custom-wrap',hidden:select.value!=='custom'},[field('Your HTML · optional, 128 KiB maximum','custom-html',html),paragraph('Runs in an opaque sandbox. Inline interactions work; network requests, embedded frames and form submission are blocked.','form-help')]);
  const description=paragraph(recipes[select.value].description,'form-help');select.onchange=()=>{description.textContent=recipes[select.value].description;intent.placeholder=recipes[select.value].intent;customWrap.hidden=select.value!=='custom';};
  if(selectedDraft){select.disabled=true;title.disabled=true;intent.disabled=true;}
  const draftButton=node('button',{id:'draft-button',class:'primary-button',type:'submit',text:selectedDraft?'Draft is ready':'Create private draft'});
  form.append(field('Choose a recipe','recipe-select',select),description,field('What will you make?','command-input',title),field('What is it for?','intent-input',intent),customWrap,node('div',{class:'button-row'},[draftButton]));content.append(form);
  const draftArea=node('div',{id:'draft-area'});content.append(draftArea,paragraph('Each accepted publication adds 100 WORLD XP to the institution-wide total. The publishing Founder earns 100 character XP when the unique publication event matches a retained version. Notes, discoveries and launch rehearsals earn no XP; neither reward grants institutional authority.','form-help'));
  function showDraft(){draftArea.replaceChildren();if(!selectedDraft)return;draftButton.disabled=true;const d=selectedDraft;const preview=button('Open actual preview',()=>previewDraft(d),{id:'preview-button',class:'secondary-button'}),publish=button(`Publish v${d.version} into the world`,guarded(()=>publishDraft(d)),{id:'publish-button',class:'primary-button'});draftArea.append(node('div',{class:'draft-card'},[node('div',{class:'eyebrow',text:'PRIVATE DRAFT · CHECKED BYTES'}),node('h3',{text:d.title}),paragraph(`${d.checks.filter(c=>c.passed).length}/${d.checks.length} recipe checks · ${d.receipt.size.toLocaleString()} bytes`,'form-help'),node('div',{class:'button-row'},[preview,publish]),paragraph(d.creationId?'The published version remains open. This repair will retain its exact bytes in version history.':'Publication creates an actual building and a playable sandboxed artifact.','form-help')]));}
  form.onsubmit=guarded(async e=>{e.preventDefault();draftButton.disabled=true;try{const result=await act({type:'draft',kind:select.value,title:title.value.trim()||recipes[select.value].title,intent:intent.value.trim()||recipes[select.value].intent,...(select.value==='custom'?{html:html.value}:{})});selectedDraft=world.drafts.find(d=>d.id===result.draftId);showDraft();toast('Private draft created. Preview its real interactions before publishing.')}finally{draftButton.disabled=!!selectedDraft}});showDraft();
}
function previewDraft(draft){openPortal({title:draft.title,html:draft.html,kicker:'PRIVATE DRAFT',footer:[paragraph('Private preview · opaque sandbox · no live AI or network requests.'),button(`Publish v${draft.version}`,guarded(()=>publishDraft(draft)),{id:'portal-publish',class:'primary-button'})]})}
async function publishDraft(draft){if(busy)return;busy=true;try{const result=await act({type:'publish',draftId:draft.id,expectedVersion:draft.baseVersion});selectedDraft=null;closePortal();closeSheet();view.focusCreation(result.creationId);toast(`A new place in the world · v${result.version} · +100 WORLD XP · +100 character XP${result.version>1?' · a method preserved':''}.`)}finally{busy=false}}
function sourceObservationAttributionCopy(){
  return mode==='private'
    ? 'PRIVATE SAVE · LOCAL ATTRIBUTION ONLY. This save stores a device-local actor label, not an authenticated identity. Anyone able to edit the private save can change its actor fields and recompute SHA-256; the digest checks consistency only. It does not prove authorship, an independent witness, or NGL authority.'
    : 'SHARED SESSION · SERVER-BOUND ATTRIBUTION. The shared service binds this note to the authenticated session and role. A session does not prove a distinct human, independent witness, or the truth of the note.';
}
function openSourceObservation(creationId,versionNumber,prefillNote=null){
  const creation=world.creations.find(item=>item.id===creationId);
  const retained=creation?[creation,...(Array.isArray(creation.versions)?creation.versions:[])]:[];
  const version=retained.find(item=>item.version===versionNumber);
  if(!creation||creation.kind!=='observatory'||!version){
    toast('That retained Source Observatory version is unavailable.',true);
    openEvidenceArchive();
    return;
  }
  const importedNote=prefillNote?parseSourceObservatoryExport({
    schema:'ngl.source-observatory.v2',
    assurance:{sourceRetrieval:'NOT_PERFORMED',independentVerification:'NOT_PERFORMED',modelAssertions:'LEADS_ONLY',execution:'NOT_EXECUTED'},
    observations:[{...prefillNote}]
  }).observations[0]:null;
  const content=showSheet('Record a source observation','SOURCE OBSERVATORY · RIVER OF RECEIPTS');
  const attributionDisclosure=paragraph(sourceObservationAttributionCopy(),'evidence-warning');
  attributionDisclosure.dataset.sourceObservationAttributionDisclosure=mode;
  content.append(
    paragraph('Target: '+creation.title+' · retained v'+versionNumber+' · '+version.receipt.size+' bytes.'),
    paragraph('This is an attributed research note, not a truth verdict. The source class is your selection; this form does not fetch a URL, inspect a document, verify a claim, execute a test, award XP, or grant authority. A model assertion is a lead only; tool output is attributed output only.','form-help'),
    attributionDisclosure,
    ...(importedNote?[node('p',{class:'evidence-warning','data-source-observation-local-note-disclosure':'true',text:'This note was supplied by the sandboxed local Source Observatory notebook. The notebook does not establish original authorship or a retained source version. If you submit, the new event uses the current actor label and is bound to the retained target above. The separate attribution notice explains whether that label is local or server-bound. Review or edit every field; nothing is shared until you explicitly submit. No source is fetched or independently verified.'})]:[])
  );
  const form=node('form',{class:'field-card','data-source-observation-form':'true'},[]);
  const claim=node('textarea',{id:'source-observation-claim',maxlength:'1000',rows:'3',placeholder:'State one specific, falsifiable claim.',required:'required'});
  const sourceKind=node('select',{id:'source-observation-kind'},[
    node('option',{value:'unspecified',text:'Not classified · author-selected'}),
    node('option',{value:'direct-observation',text:'Direct observation · author-selected'}),
    node('option',{value:'primary-source',text:'Primary source / document · author-selected'}),
    node('option',{value:'secondary-source',text:'Secondary source / analysis · author-selected'}),
    node('option',{value:'tool-output',text:'Tool output / execution receipt · attributed only'}),
    node('option',{value:'user-report',text:'User-reported · author-selected'}),
    node('option',{value:'model-assertion',text:'Model assertion · lead only, not evidence'})
  ]);
  const source=node('textarea',{id:'source-observation-source',maxlength:'1000',rows:'2',placeholder:'Document, author, URL, page or observation reference',required:'required'});
  const falsifier=node('textarea',{id:'source-observation-falsifier',maxlength:'1000',rows:'2',placeholder:'What observation would weaken or disprove the claim?'});
  const uncertainty=node('textarea',{id:'source-observation-uncertainty',maxlength:'1000',rows:'2',placeholder:'What remains unresolved or disputed?'});
  const nextTest=node('textarea',{id:'source-observation-next-test',maxlength:'1000',rows:'2',placeholder:'What small, observable test could resolve part of this?'});
  const submit=node('button',{id:'source-observation-submit',type:'submit',class:'primary-button',text:importedNote?'Retain as my current-session observation':'Retain source observation'});
  if(importedNote){
    claim.value=importedNote.claim;
    sourceKind.value=importedNote.sourceKind;
    source.value=importedNote.source;
    falsifier.value=importedNote.falsifier??'';
    uncertainty.value=importedNote.uncertainty??'';
    nextTest.value=importedNote.nextTest??'';
  }
  const status=paragraph('The event contract fixes source retrieval and independent verification as NOT_PERFORMED, model assertions as LEADS_ONLY, and execution as NOT_EXECUTED. This records activity only; it awards no XP and does not complete a verification or Founder-approval gate.','form-help');
  status.dataset.sourceObservationStatus='true';
  form.append(
    field('Claim under test · up to 500 Unicode code points','source-observation-claim',claim),
    field('Source class · author-selected','source-observation-kind',sourceKind),
    field('Source / attribution · up to 500 Unicode code points','source-observation-source',source),
    field('Possible falsifier · optional','source-observation-falsifier',falsifier),
    field('Unknowns / uncertainty · optional','source-observation-uncertainty',uncertainty),
    field('Next discriminating test · optional','source-observation-next-test',nextTest),
    status,
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      const note={
        claim:claim.value.trim(),
        sourceKind:sourceKind.value,
        source:source.value.trim(),
        falsifier:falsifier.value.trim()||null,
        uncertainty:uncertainty.value.trim()||null,
        nextTest:nextTest.value.trim()||null
      };
      const material=sourceObservationRequestMaterial({
        actorId:viewer.id,actorRole:viewer.role,creationId,version:versionNumber,...note
      });
      if(!globalThis.crypto?.subtle)throw new Error('Web Crypto SHA-256 is unavailable in this browser context.');
      const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(material));
      const digest=Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
      const observationId='source-observation-'+digest;
      const result=await act({
        type:'record-source-observation',requestId:observationId,observationId,
        creationId,version:versionNumber,...note
      });
      const destination=mode==='shared'?'the shared world · authenticated-session attribution':'this private save · local attribution only';
      toast(result?.duplicate===true||result?.idempotentReplay===true
        ?'That exact source observation is already retained in '+destination+'. No duplicate event or XP was added.'
        :'Source observation retained in '+destination+' · no XP or truth verdict.');
      openCreation(creationId,versionNumber);
    }catch(error){
      status.textContent='No confirmed response was received. If the exact local Relay receipt remains, retry it from The Relay before starting another note. '+(error?.message||'');
      throw error;
    }finally{
      submit.disabled=false;
    }
  });
}
function openCreation(id,requestedVersion=null,focusChallenge=false){const creation=world.creations.find(c=>c.id===id);if(!creation)return;const availableVersions=[creation,...[...creation.versions].reverse()];selectedCreation=id;selectedVersion=availableVersions.some(version=>version.version===requestedVersion)?requestedVersion:creation.version;const content=showSheet(creation.title,'A PLACE SOMEONE MADE');let sourceObservationList=null;function renderSourceObservations(){if(!sourceObservationList)return;sourceObservationList.replaceChildren(node('h3',{class:'section-title',text:'SOURCE OBSERVATIONS · v'+selectedVersion}));const attributionDisclosure=paragraph(sourceObservationAttributionCopy(),'evidence-warning');attributionDisclosure.dataset.sourceObservationAttributionDisclosure=mode;sourceObservationList.append(attributionDisclosure);const records=projectSourceObservationRecords(world.events,world.creations).filter(record=>record.creationId===id&&record.version===selectedVersion);if(!records.length){sourceObservationList.append(paragraph('No source observations are retained against this version. The empty state is intentional.','empty-note'));return;}for(const record of records){const children=[node('h3',{text:record.claim||'Untitled source observation'}),paragraph('Source class: '+(record.sourceKind||'unspecified')+' · author-selected'),paragraph('Source / attribution: '+(record.source||'NOT PROVIDED')),paragraph('Possible falsifier: '+(record.falsifier||'Not recorded')),paragraph('Unknowns / uncertainty: '+(record.uncertainty||'Not recorded')),paragraph('Next discriminating test: '+(record.nextTest||'Not recorded')),paragraph('By '+(record.actor?.name||record.actor?.id||'Unknown actor')+' · '+(record.at||'time unavailable')+' · attributed note, not independent verification.','attribution'),paragraph(record.warning||'This is an author-entered note, not an independently verified claim.','evidence-warning')];if(record.projectionStatus==='linked')children.push(paragraph('Reference: linked to one earlier retained Observatory publication. The selected binding does not prove source origin or truth.','form-help'));else children.push(paragraph('Reference status: '+record.projectionStatus+' · '+(record.projectionReason||'not linked'),'evidence-warning'));children.push(paragraph('Assurance: retrieval '+(record.sourceRetrieval||'UNKNOWN')+'; independent verification '+(record.independentVerification||'UNKNOWN')+'; model assertions '+(record.modelAssertions||'UNKNOWN')+'; execution '+(record.execution||'UNKNOWN')+'.','form-help'));
    for(const challenge of record.challenges||[]){
      const challengeChildren=[
        node('h4',{text:'Challenge · '+challenge.challengeType}),
        paragraph(challenge.challengeText),
        paragraph('By '+(challenge.actor?.name||challenge.actor?.id||'Unknown actor')+' · '+(challenge.at||'time unavailable'),'attribution'),
        paragraph('Preserved dissent. This does not adjudicate the original note or establish a counterclaim.','evidence-warning')
      ];
      if(challenge.responseStatus==='answered'){
        for(const response of challenge.responses||[])challengeChildren.push(node('article',{class:'note-entry','data-source-observation-response':'true','data-response-id':response.responseId},[
          node('h4',{text:'Author response'}),
          paragraph(response.responseText),
          paragraph('By '+(response.actor?.name||response.actor?.id||'Original author')+' · '+(response.at||'time unavailable'),'attribution'),
          paragraph('Attributed reply only. It does not establish independent evidence, adjudication, or truth.','evidence-warning')
        ]));
      }else if(challenge.responseStatus==='ambiguous'){
        challengeChildren.push(paragraph('Response history is ambiguous; no response is selected or counted.','evidence-warning'));
      }else if(record.actor?.id===viewer?.id&&record.actor?.role===viewer?.role){
        const responseText=node('textarea',{maxlength:'1000',rows:'3',placeholder:'Respond to the challenge without erasing it…'});
        const submitResponse=node('button',{type:'submit',class:'secondary-button',text:'Preserve author response'});
        const responseForm=node('form',{class:'source-observation-challenge-fields source-observation-response-fields','data-source-observation-response-form':'true'},[
          node('label',{text:'Author response · up to 1000 Unicode code points'},[responseText]),
          node('div',{class:'button-row'},[submitResponse]),
          paragraph('Only the original observation author can respond. The response preserves their account; it does not resolve the dispute or establish truth.','form-help')
        ]);
        responseForm.onsubmit=guarded(async event=>{
          event.preventDefault();
          submitResponse.disabled=true;
          try{
            await act({type:'respond-source-observation-challenge',challengeId:challenge.challengeId,responseText:responseText.value});
            toast('Author response preserved beside the challenge. No XP or verdict.');
            openCreation(id,selectedVersion);
          }finally{submitResponse.disabled=false;}
        });
        challengeChildren.push(node('details',{class:'source-observation-response-form','data-source-observation-response-details':'true'},[
          node('summary',{text:'Respond to this challenge'}),
          responseForm
        ]));
      }
      children.push(node('article',{class:'note-entry','data-source-observation-challenge':'true','data-challenge-id':challenge.challengeId},challengeChildren));
    }
    if(record.projectionStatus==='linked'&&!sameResearchActor(record.actor,viewer)){
      const challengeType=node('select',{},[
        node('option',{value:'missing-evidence',text:'Missing evidence'}),
        node('option',{value:'methodology',text:'Methodology'}),
        node('option',{value:'contradiction',text:'Contradiction'}),
        node('option',{value:'reproducibility',text:'Reproducibility'}),
        node('option',{value:'scope',text:'Scope'}),
        node('option',{value:'other',text:'Other'})
      ]);
      const challengeText=node('textarea',{maxlength:'1000',rows:'3',placeholder:'What is unsupported, missing, contradictory, or not reproducible?'});
      const submitChallenge=node('button',{type:'submit',class:'secondary-button',text:'Preserve dissent'});
      const challengeForm=node('form',{class:'source-observation-challenge-fields'},[
        node('label',{text:'Challenge type'},[challengeType]),
        node('label',{text:'Challenge text · up to 1000 Unicode code points'},[challengeText]),
        node('div',{class:'button-row'},[submitChallenge]),
        paragraph('A different actor can preserve this challenge. The original note remains intact; this is not a truth verdict, evidence certification, or authority grant.','form-help')
      ]);
      challengeForm.onsubmit=guarded(async event=>{
        event.preventDefault();
        submitChallenge.disabled=true;
        try{
          await act({type:'challenge-source-observation',observationId:record.observationId,challengeType:challengeType.value,challengeText:challengeText.value});
          toast('Dissent preserved against the exact retained source observation. No XP or verdict.');
          openCreation(id,selectedVersion);
        }finally{submitChallenge.disabled=false;}
      });
      children.push(node('details',{class:'source-observation-challenge-form','data-source-observation-challenge-form':'true'},[
        node('summary',{text:'Challenge this observation'}),
        challengeForm
      ]));
    }else{
      children.push(paragraph('Only a different actor can challenge this note. The author can preserve a separate response to each retained challenge without erasing the original.','form-help'));
    }
    sourceObservationList.append(node('article',{class:'field-card','data-source-observation-card':'true','data-observation-id':record.observationId||''},children));  }}content.append(node('span',{class:'pill',text:`${creation.kind} · published v${creation.version}`}),paragraph(creation.intent||'A small, playable creation in the Common Ground.'),node('div',{class:'button-row'},[button('Enter this creation ↗',()=>enterCreation(),{id:'enter-creation',class:'primary-button'})]));
  const version=node('select',{id:'version-select'});for(const v of availableVersions)version.append(node('option',{value:v.version,text:`Version ${v.version}${v.version===creation.version?' · current':' · retained original bytes'}`}));version.value=String(selectedVersion);version.onchange=()=>{selectedVersion=Number(version.value);renderNotes();renderSourceObservations();syncChallengeTarget(true)};content.append(field('Version archive','version-select',version),paragraph('Versions are flat retained documents. A SHA-256 receipt establishes exact bytes, not the truth of any claim inside.','form-help'),node('div',{class:'receipt',text:`SHA-256 ${creation.receipt.digest}\n${creation.receipt.size.toLocaleString()} bytes · v${creation.version}`}));if(creation.kind==='observatory'){content.append(paragraph('Record a falsifiable source note in this version’s Chronicle. The source class is author-selected; retrieval and independent verification remain NOT_PERFORMED.','form-help'),button('Record a source observation →',()=>openSourceObservation(id,selectedVersion),{id:'source-observation-open',class:'secondary-button'}),sourceObservationList=node('div',{id:'source-observations'}));renderSourceObservations();}
  const notes=node('div',{id:'creation-notes'}),contribution=node('textarea',{id:'contribution-text',maxlength:'500',rows:'3',placeholder:'A useful response, question or counterexample…'});content.append(node('h3',{class:'section-title',text:'Leave a useful trace'}),field('Contribution · 500 characters','contribution-text',contribution),node('div',{class:'button-row'},[button('Add your contribution',guarded(async()=>{await act({type:'contribute',creationId:id,version:selectedVersion,text:contribution.value});contribution.value='';renderNotes();toast('Contribution preserved with your attribution. No XP awarded.')}),{id:'contribute-button',class:'secondary-button'})]),notes);
  const report=node('textarea',{id:'report-text',maxlength:'1000',rows:'2',placeholder:'What failed, what is unsupported, or what needs care?'});const reportDetails=node('details',{},[node('summary',{text:'Report a problem or unsupported claim'}),field('Report · 1000 characters','report-text',report),node('div',{class:'button-row'},[button('Preserve this report',guarded(async()=>{await act({type:'report',creationId:id,version:selectedVersion,text:report.value});report.value='';renderNotes();toast('Report preserved against that exact version.')}),{id:'report-button',class:'secondary-button'})])]);content.append(reportDetails);
  const challengeDetails=node('details',{id:'contradiction-clerk'},[node('summary',{text:'Ask the Contradiction Clerk to challenge this version'})]);
  challengeDetails.append(paragraph('A fixed local checklist, not an AI collaborator or independent witness. It can preserve a report; it cannot decide truth, authorize work, or award XP.','form-help'));
  const challengeTarget=paragraph('','form-help');
  challengeDetails.append(challengeTarget);
  const challengeForm=node('form',{id:'contradiction-form'});
  const challengeInputs={};
  for(const prompt of prepareContradictionReview(creation,selectedVersion).prompts){
    const input=node('textarea',{id:'contradiction-'+prompt.id,maxlength:String(prompt.maxLength),rows:'2',placeholder:prompt.placeholder});
    challengeInputs[prompt.id]=input;
    challengeForm.append(field(prompt.label,input.id,input),paragraph(prompt.prompt,'form-help'));
  }
  const challengeSubmit=node('button',{id:'contradiction-submit',type:'submit',class:'secondary-button',text:'Preserve structured challenge'});
  challengeForm.append(node('div',{class:'button-row'},[challengeSubmit]));
  challengeForm.onsubmit=guarded(async e=>{
    e.preventDefault();
    const targetVersion=selectedVersion;
    const reportText=formatContradictionReport(creation,targetVersion,Object.fromEntries(Object.entries(challengeInputs).map(([key,input])=>[key,input.value])));
    challengeSubmit.disabled=true;
    try{
      await act({type:'report',creationId:id,version:targetVersion,text:reportText});
      for(const input of Object.values(challengeInputs))input.value='';
      renderNotes();
      toast('Structured challenge preserved against v'+targetVersion+'. It is a report, not a verdict.');
    }finally{challengeSubmit.disabled=false;}
  });
  challengeDetails.append(challengeForm);
  function syncChallengeTarget(clear=false){
    const review=prepareContradictionReview(creation,selectedVersion);
    challengeTarget.textContent='Target: '+review.target.title+' · retained v'+review.target.version+'. The Clerk has no authority and issues no verdict.';
    if(clear)for(const input of Object.values(challengeInputs))input.value='';
  }
  syncChallengeTarget();
  content.append(challengeDetails);
  if(focusChallenge){challengeDetails.open=true;challengeDetails.querySelector('summary')?.focus();}
  if(viewer.role==='founder')content.append(node('h3',{class:'section-title',text:'Keep the old. Make the next.'}),paragraph('A repair drafts the next checked version. The current building stays open until you publish; previous bytes stay in the archive.','form-help'),node('div',{class:'button-row'},[button('Repair → draft the next version',guarded(async()=>{const result=await act({type:'repair',creationId:id,expectedVersion:world.creations.find(c=>c.id===id).version});openWorkshop(creation.kind,result.draftId)}),{id:'repair-button',class:'secondary-button'})]));
  function renderNotes(){notes.replaceChildren(node('h3',{class:'section-title',text:`Notes on v${selectedVersion}`}));const entries=[...world.contributions.filter(n=>n.creationId===id&&n.version===selectedVersion).map(n=>({...n,type:'Contribution'})),...world.reports.filter(n=>n.creationId===id&&n.version===selectedVersion).map(n=>({...n,type:'Report'}))];if(!entries.length)notes.append(paragraph('A place for the first real response.','empty-note'));for(const n of entries)notes.append(node('article',{class:'note-entry'},[paragraph(n.text),paragraph(`${n.type} · ${n.actor.name} · ${new Date(n.at).toLocaleDateString()}`,'attribution')]));}activeNoteRenderer=()=>{renderNotes();renderSourceObservations()};renderNotes();renderSourceObservations();
}
function enterCreation(){const c=world.creations.find(c=>c.id===selectedCreation);if(!c)return;const version=selectedVersion===c.version?c:c.versions.find(v=>v.version===selectedVersion);if(!version)return;const nativeFileSurface=c.kind==='observatory'&&version.html.includes('data-ngl-native-file-surface="source-observatory-v2"');const sourceObservationTarget=mode==='shared'&&nativeFileSurface?{creationId:c.id,version:version.version}:null;openPortal({title:`${c.title} · v${version.version}`,html:version.html,nativeFileSurface,sourceObservationTarget,footer:[paragraph(`Published v${version.version} · ${version.receipt.size.toLocaleString()} checked bytes · interactions inside the frame are local to this open artifact.`),button('↓ Save artifact',()=>download(`${c.kind}-v${version.version}.html`,version.html),{id:'download-artifact',class:'secondary-button'})]})}
function appendRelayRecovery(content){
  const section=node('section',{class:'field-card',id:'relay-pending-action'},[
    node('h3',{text:'Courier receipt · shared action recovery'}),
    paragraph('The Relay automatically retries an uncertain shared write with its original request ID when the browser reconnects or you re-enter the shared world, but only under the same actor ID and role. You can still retry manually. This local receipt is not a canonical event and does not prove that the server accepted the action.')
  ]);
  let pending;
  try{pending=readPendingSharedAction()}catch(error){
    section.append(paragraph(error.message,'evidence-warning'));
    content.append(section);
    return;
  }
  if(!pending){
    section.append(paragraph('No unresolved shared-action receipt is saved on this device.','empty-note'));
    content.append(section);
    return;
  }
  if(pendingSharedActionInFlight===pending.requestId){
    section.append(
      node('span',{class:'pill',text:'SUBMISSION IN FLIGHT'}),
      paragraph('This exact action is already being sent. Wait for the response; The Relay blocks a concurrent retry.','form-help')
    );
    content.append(section);
    return;
  }
  section.append(
    node('span',{class:'pill',text:'LOCAL RECEIPT · OUTCOME MAY BE UNKNOWN'}),
    paragraph('Pending action · '+pending.action.type.toUpperCase()),
    paragraph('Request ID · '+pending.requestId),
    paragraph('Original actor · '+pending.actorId+' ('+pending.actorRole+')'),
    paragraph('Retry reuses the exact action and request ID. Do not edit the receipt or replay it under another identity.','form-help')
  );
  if(pending.actorId===viewer.id&&pending.actorRole===viewer.role){
    section.append(button('Retry the exact pending action safely',guarded(async()=>{
      await submitPendingSharedAction(pending);
      closeSheet();
      toast('Shared action outcome recovered. The same request ID was reused; no duplicate was created.');
    }),{class:'primary-button',id:'relay-retry-pending-shared-action'}));
  }else{
    section.append(paragraph('This session does not match the original actor. The Relay will not replay this action under a different identity or role. Re-authenticate as the original actor to recover it.','evidence-warning'));
  }
  content.append(section);
}
function refreshRelayRecovery(){
  const section=$('relay-pending-action');
  if(!section||section.parentElement!==$('sheet-content')||$('sheet').hidden)return;
  const content=section.parentElement;
  section.remove();
  appendRelayRecovery(content);
}
function openGuide(id){
  const g=guides[id];
  if(!g)return;
  const action=getLocationAction(id,world,viewer);
  const content=showSheet(g.title,g.name);
  content.append(
    paragraph(g.voice,'attribution'),
    paragraph(g.body),
    node('div',{class:'field-card'},[
      node('div',{class:'eyebrow',text:'A PRACTICE TO TRY'}),
      paragraph(g.practice)
    ]),
    paragraph('This guide is authored text, not an executing AI agent. Shared visits require a server-checked walkable path and proximity; private visits remain local and self-attested. Neither is GPS evidence or proof of a claim. Its next action is chosen from the published world state and your role; it cannot grant publishing authority or certify a claim.','form-help'),
    paragraph(action?.explanation||'No activity is available for this location yet.','form-help'),
    node('div',{class:'button-row'},[
      button(action?.label||'Explore another guide →',()=>{
        if(action?.type==='workbench')openWorkshop(action.recipe);
        else if(action?.type==='inspect')openCreation(action.creationId);
        else openPlaces();
      },{class:'primary-button'})
    ])
  );
  if(id==='relay'&&mode==='shared')appendRelayRecovery(content);
}
function openPlaces(){const content=showSheet('Find your way.','PLACES IN THE COMMON GROUND');content.append(paragraph('Choose a destination to walk there. The route uses the bridges and goes around buildings. You can also open any creation from its card.'));for(const place of PLACES)content.append(button('',()=>{closeSheet();view.goTo(place.id)},{class:'list-button','aria-label':`Walk to ${place.id==='town-square'?'The Commons at TownSquare':place.name}`,...{}}));const buttons=content.querySelectorAll('.list-button');PLACES.forEach((p,i)=>buttons[i].append(node('span',{},[node('strong',{text:p.id==='town-square'?'The Commons at TownSquare':p.name}),node('small',{text:p.id==='town-square'?'Public conversation, private reports and retained human moderation.':p.type==='workbench'?'Make a private draft, then publish.':p.type==='institution'?(p.purpose||'Institutional function.'):guides[p.id]?.voice||'Walk to this authored guide.'})]),node('span',{class:'arrow',text:'↗'})));if(world.creations.length)content.append(node('h3',{class:'section-title',text:'CREATIONS THAT BECAME PLACES'}));for(const c of world.creations)content.append(button('',()=>openCreation(c.id),{class:'list-button','aria-label':`Open ${c.title}`}));const creationButtons=Array.from(content.querySelectorAll('.list-button')).slice(PLACES.length);world.creations.forEach((c,i)=>creationButtons[i].append(node('span',{},[node('strong',{text:c.title}),node('small',{text:`${c.kind} · v${c.version} · enter, contribute, inspect history`})]),node('span',{class:'arrow',text:'→'})));const researchObjects=Array.isArray(view.researchObjects)?view.researchObjects:[];if(researchObjects.length){content.append(paragraph('Map counters use R for retained attempt reports and C for retained challenges. These are attributed records, not verification or adjudication.','form-help'));content.append(node('h3',{class:'section-title',text:'MOONSHOT PROPOSALS · WORLD OBJECTS'}));for(const object of researchObjects){const row=button('',()=>{closeSheet();view.goTo(object.id)},{class:'list-button','aria-label':`Walk to moonshot proposal: ${object.title}`});row.append(node('span',{},[node('strong',{text:object.title}),node('small',{text:`RESEARCH QUESTION · ${object.attemptCount} retained ${object.attemptCount===1?'attempt report':'attempt reports'} · ${object.challengeCount} retained ${object.challengeCount===1?'challenge':'challenges'} · not adjudicated · ${object.actorRole} ${object.actorId}`})]),node('span',{class:'arrow',text:'↗'}));content.append(row);}}const activityObjects=Array.isArray(view.researchActivityObjects)?view.researchActivityObjects:[];if(activityObjects.length){content.append(paragraph('Each attempt and challenge is a separately retained, attributed record. A map pin routes you to inspect it; it is not a verdict.','form-help'));content.append(node('h3',{class:'section-title',text:'RESEARCH TRAIL · ATTEMPTS & DISSENT'}));for(const object of activityObjects){const kind=object.recordType==='experiment-reported'?'ATTEMPT · SELF-REPORTED':'DISSENT · NOT ADJUDICATED';const row=button('',()=>{closeSheet();if(object.mapVisible)view.goTo(object.id);else openMoonshotField(object.moonshotId,object.activityId);},{class:'list-button','aria-label':`Inspect research record: ${object.title}`});row.append(node('span',{},[node('strong',{text:object.title}),node('small',{text:`${kind} · ${object.actorRole} ${object.actorId} · ${object.mapVisible?'walk to map object':'open record directly'}`}),node('small',{text:String(object.summary||'').slice(0,100)})]),node('span',{class:'arrow',text:'↗'}));content.append(row);}}}
function appendContradictionClerk(content){
  const clerk=node('article',{class:'field-card',id:'contradiction-clerk-npc'},[
    node('h3',{text:'The Contradiction Clerk'}),
    paragraph('BOUNDED ADVERSARY · FIXED LOCAL PROTOCOL'),
    paragraph('The Clerk asks for a falsifiable claim, an inspectable source or direct observation, a possible falsifier, and an unknown or next test. No AI/provider call occurs. The Clerk issues no verdict, certifies no truth, grants no authority, and awards no XP; the resulting report is your attributed submission.')
  ]);
  content.append(clerk);
  const creations=Array.isArray(world?.creations)?world.creations.filter(creation=>
    creation&&typeof creation.id==='string'&&creation.id&&Number.isInteger(creation.version)&&creation.version>0
  ):[];
  if(!creations.length){
    clerk.append(paragraph('No published artifact is available to challenge yet. The Clerk will not invent a target; publish real work at the Forge and return.','empty-note'));
    return;
  }
  clerk.append(paragraph('Choose a real published place. The challenge opens against its exact current version; use the version archive to target an earlier retained version.','form-help'));
  for(const creation of [...creations].reverse()){
    clerk.append(button('Challenge '+creation.title+' · v'+creation.version+' →',()=>openCreation(creation.id,creation.version,true),{class:'list-button'}));
  }
}
function appendCollaboratorContracts(content, sourceWorld, roleIds = null, heading = 'BOUNDED COLLABORATOR CONTRACTS'){
  content.append(node('h3',{class:'section-title',text:heading}));
  content.append(paragraph('Prepare source-bound work packets for an external AI collaborator. Preparing or copying does not call a model or change the world. Only the explicit archive action appends an attributed record. Pasted text remains untrusted even after structural validation; archiving preserves its exact bytes and source packet without endorsing claims.','form-help'));
  const allowedRoles=Array.isArray(roleIds)?new Set(roleIds):null;
  const packets=projectCollaboratorPackets(sourceWorld).filter(packet=>!allowedRoles||allowedRoles.has(packet.id));
  for(const packet of packets){
    const card=node('article',{class:'field-card','data-collaborator-role':packet.id,tabindex:'-1'},[
      node('h3',{text:packet.name}),
      paragraph(packet.objective),
      paragraph(packet.available?'Inputs: '+packet.inputRefs.join(' · '):packet.reason,packet.available?'form-help':'empty-note'),
      paragraph(packet.sourceSnapshot?.status==='identified'
        ? `Source snapshot marker (not independent evidence): world ${packet.sourceSnapshot.worldId} · revision ${packet.sourceSnapshot.revision} · ${packet.sourceSnapshot.suppliedEventCount} event records supplied to this view.`
        : 'Source snapshot metadata incomplete; no snapshot identity is asserted.','form-help')
    ]);
    if(packet.available){
      const details=node('details',{class:'collaborator-packet'},[
        node('summary',{text:'Inspect hand-off packet'}),
        node('textarea',{readonly:'',rows:'8','aria-label':packet.name+' hand-off packet',value:packet.prompt})
      ]);
      card.append(details);
      card.append(button('Copy hand-off packet',guarded(async()=>{
        try{
          await navigator.clipboard.writeText(packet.prompt);
          toast('Bounded packet copied. No model was called and no world state changed.');
        }catch{
          const field=details.querySelector('textarea');
          field.focus();field.select();
          toast('Packet selected. Use your device’s Copy action.');
        }
      }),{class:'secondary-button','data-copy-collaborator':packet.id}));
      const responseDetails=node('details',{class:'collaborator-response'},[
        node('summary',{text:'Validate returned response'})
      ]);
      const responseField=node('textarea',{rows:'8','aria-label':packet.name+' response JSON',placeholder:'Paste the external collaborator JSON response.'});
      responseDetails.append(responseField);
      const responseStatus=paragraph('Pasted output remains untrusted. Validation checks structure and packet references only.','form-help');
      responseStatus.setAttribute('data-collaborator-response-status',packet.id);
      const responsePreview=node('pre',{class:'collaborator-response-preview','data-collaborator-response-preview':packet.id});
      card.append(responseDetails);
      card.append(button('Validate response for review',()=>{
        const result=validateCollaboratorResponse(packet,responseField.value);
        responseStatus.textContent=result.valid
          ? 'STRUCTURE VALID · FOR HUMAN REVIEW ONLY. No claim, execution, world change, XP, or authority was verified.'
          : 'Response rejected: '+result.reason;
        responseStatus.className=result.valid?'form-help':'empty-note';
        responsePreview.textContent=result.valid?JSON.stringify(result.response,null,2):'';
      },{class:'secondary-button','data-validate-collaborator':packet.id}));
      card.append(responseStatus,responsePreview);
      const archiveButton=button('Archive exact response as untrusted history →',guarded(async()=>{
        const result=await act({type:'record-collaborator-response',role:packet.id,moonshotId:packet.moonshotId,packetJson:packet.packetJson,sourceEventIds:[...packet.inputRefs],responseText:responseField.value});
        responseStatus.textContent=result.validationStatus==='valid-for-human-review'
          ? 'ARCHIVED · STRUCTURE VALID FOR HUMAN REVIEW ONLY. No claim, evidence, execution, approval, mastery, XP, or authority was verified.'
          : 'ARCHIVED · REJECTED RESPONSE PRESERVED. '+String(result.validationStatus||'rejected')+'; inspect the exact text and packet in the Evidence Archive.';
        responseStatus.className=result.validationStatus==='valid-for-human-review'?'form-help':'empty-note';
        responseStatus.dataset.responseId=result.responseId;
        responseField.disabled=true;
        archiveButton.disabled=true;
        archiveButton.textContent='Response archived';
        toast('Untrusted collaborator response preserved in world history · no XP or authority awarded.');
      }),{class:'secondary-button','data-archive-collaborator':packet.id});
      card.append(archiveButton);
      card.append(button('Open related Moonshot →',()=>openMoonshotField(packet.moonshotId),{class:'list-button'}));
    }else{
      card.append(button('Visit Moonshot Field →',()=>openMoonshotField(),{class:'list-button'}));
    }

    // Rehydrate prior work from retained events for this session actor. This is
    // a read-only projection: opening the NPC cannot archive, retry, or approve.
    const eventHistory=Array.isArray(sourceWorld?.events)?sourceWorld.events:null;
    const allRetainedAttempts=eventHistory
      ? eventHistory.filter(event=>event?.type==='collaborator-response-recorded'&&
          event?.role===packet.id&&event?.actor?.id===viewer?.id&&event?.actor?.role===viewer?.role)
      : null;
    const retainedAttempts=allRetainedAttempts?allRetainedAttempts.slice(-4).reverse():[];
    const retainedHistory=node('section',{
      class:'retained-collaborator-history',
      'data-retained-collaborator-history':packet.id
    },[
      node('h4',{class:'section-title',text:'YOUR RETAINED ATTEMPTS'}),
      paragraph('Earlier responses are read from append-only world history for this session actor. They remain untrusted; reopening this NPC does not archive or retry anything.','form-help')
    ]);
    if(!allRetainedAttempts){
      retainedHistory.append(paragraph('Retained event history is unavailable in this view. Inspect the Evidence Archive; no zero count is inferred.','empty-note'));
    }else if(!allRetainedAttempts.length){
      retainedHistory.append(paragraph('No retained attempts by this actor for this role are present in the current world snapshot.','empty-note'));
    }else{
      if(allRetainedAttempts.length>retainedAttempts.length){
        retainedHistory.append(paragraph('Showing the latest '+retainedAttempts.length+' of '+allRetainedAttempts.length+' retained attempts. Earlier attempts remain in the Chronicle.','form-help'));
      }
      for(const attempt of retainedAttempts){
        const review=validateRetainedCollaboratorResponse(sourceWorld,attempt.id,viewer);
        const reviewStatus=typeof review?.status==='string'?review.status:'unavailable';
        const statusLabel=reviewStatus==='valid-for-human-review'
          ? 'STRUCTURE VALID · HUMAN REVIEW ONLY'
          : reviewStatus==='rejected'
            ? 'REJECTED · PRESERVED ATTEMPT'
            : 'RETAINED · REVALIDATION UNAVAILABLE';
        const sourceIds=Array.isArray(attempt.sourceEventIds)?attempt.sourceEventIds.join(' · '):'unavailable';
        const attemptCard=node('article',{
          class:'field-card',
          'data-retained-collaborator-response':'true',
          'data-retained-collaborator-event-id':String(attempt.id||''),
          'data-retained-collaborator-response-id':String(attempt.responseId||''),
          'data-retained-collaborator-status':reviewStatus
        },[
          node('h4',{text:statusLabel}),
          paragraph('Event '+String(attempt.id||'unavailable')+' · response '+String(attempt.responseId||'unavailable')+
            ' · '+String(attempt.at||'time unavailable'),'attribution'),
          paragraph('Original source events: '+sourceIds,'form-help')
        ]);
        if(reviewStatus==='valid-for-human-review'){
          attemptCard.append(paragraph('Structural validation only. Provider identity, source truth, execution, independent observation, approval, mastery, XP and authority remain unverified.','form-help'));
        }else if(reviewStatus==='rejected'){
          attemptCard.append(paragraph('Rejected attempt preserved. Structural validator reason: '+String(review.reason||'unavailable')+'. This is not an endorsement.','empty-note'));
        }else{
          attemptCard.append(paragraph('The retained bytes remain visible, but this view could not revalidate the exact packet and response. No structured summary is inferred. '+String(review.reason||''),'empty-note'));
        }
        const responseDetails=node('details',{class:'collaborator-response'},[
          node('summary',{text:'Inspect exact retained response'}),
          node('textarea',{
            readonly:'',rows:'8','aria-label':'Retained '+packet.name+' response',
            value:typeof attempt.responseText==='string'?attempt.responseText:'Exact response text unavailable.'
          })
        ]);
        attemptCard.append(responseDetails);
        retainedHistory.append(attemptCard);
      }
    }
    card.append(retainedHistory);
    content.append(card);
  }
}


function renderPlayerGuildBoard(board, sourceWorld){
  if(!board?.isConnected||$('sheet').hidden)return;
  const active=document.activeElement;
  const activeId=board.contains(active)?active.id:null;
  const activeValue=activeId&&'value' in active?active.value:undefined;
  const selectionStart=activeId&&typeof active.selectionStart==='number'?active.selectionStart:null;
  const selectionEnd=activeId&&typeof active.selectionEnd==='number'?active.selectionEnd:null;
  const nameValue=board.querySelector('#player-guild-name')?.value||'';
  const charterValue=board.querySelector('#player-guild-charter')?.value||'';
  const projection=projectPlayerGuilds(sourceWorld,viewer);
  board.replaceChildren();
  board.append(node('h3',{class:'section-title',text:'PLAYER GUILDS'}));
  board.append(paragraph(mode==='shared'
    ? 'Open, shared groups in this server-authoritative world. One active guild per session identity; up to '+PLAYER_GUILD_MEMBER_LIMIT+' members. A session identity is not proof of a distinct human. Membership grants no Founder authority, moderation rights, XP, evidence status, or item ownership.'
    : 'Private-mode guilds are local to this device and cannot be seen by other players. Use Shared World for shared membership. These records grant no Founder authority, moderation rights, XP, evidence status, or item ownership.','form-help'));
  if(!projection.guilds.length){
    board.append(paragraph('No open player guilds are retained yet. Founding one creates a public group with an append-only membership history.','empty-note'));
  }
  for(const guild of projection.guilds){
    const card=node('article',{class:'field-card','data-player-guild-id':guild.id});
    card.append(
      node('h3',{text:guild.name}),
      node('span',{class:'pill',text:'MEMBERS '+guild.memberCount+'/'+PLAYER_GUILD_MEMBER_LIMIT}),
      paragraph(guild.charter),
      paragraph('Leader: '+guild.leader.name+' · Members: '+guild.members.map(member=>member.name).join(', '),'form-help')
    );
    if(projection.viewerGuildId===guild.id){
      card.append(node('span',{class:'pill',text:projection.viewerIsLeader?'GUILD LEADER':'GUILD MEMBER'}));
      const offer=guild.leadershipTransferOffer;
      const viewerIsRecipient=Boolean(offer&&offer.recipient.id===viewer.id&&offer.recipient.role===viewer.role);
      if(offer){
        if(projection.viewerIsLeader){
          card.append(paragraph('Leadership offer pending for '+offer.recipient.name+'. You remain the in-game leader until that member accepts.','form-help'));
          if(mode==='shared')card.append(button('Cancel leadership offer',guarded(async()=>{
            await act({type:'cancel-guild-leadership-transfer',guildId:guild.id,offerId:offer.offerId});
            toast('Leadership offer cancelled. The current in-game leader remains in place.');
          }),{class:'secondary-button','data-player-guild-leadership-cancel':guild.id}));
        }else if(viewerIsRecipient){
          card.append(paragraph(offer.fromLeader.name+' offered you the in-game guild leader role. Nothing changes unless you explicitly accept.','form-help'));
          if(mode==='shared'){
            card.append(button('Accept leadership offer',guarded(async()=>{
              await act({type:'accept-guild-leadership-transfer',guildId:guild.id,offerId:offer.offerId});
              toast('You accepted the in-game guild leader role. No NGL institutional authority was granted.');
            }),{class:'primary-button','data-player-guild-leadership-accept':guild.id}));
            card.append(button('Decline leadership offer',guarded(async()=>{
              await act({type:'decline-guild-leadership-transfer',guildId:guild.id,offerId:offer.offerId});
              toast('Leadership offer declined. Your membership remains unchanged.');
            }),{class:'secondary-button','data-player-guild-leadership-decline':guild.id}));
          }else{
            card.append(paragraph('Accepting or declining a handoff requires the shared authoritative world.','form-help'));
          }
        }else{
          card.append(paragraph('Leadership handoff pending for '+offer.recipient.name+'. The current leader remains '+guild.leader.name+' until acceptance.','form-help'));
        }
      }else if(projection.viewerIsLeader){
        if(guild.memberCount===1){
          card.append(button('Disband this guild',guarded(async()=>{
            await act({type:'disband-guild',guildId:guild.id});
            toast('Guild closed. Its founding, membership and leadership history remain in the Chronicle.');
          }),{class:'secondary-button','data-player-guild-disband':guild.id}));
        }else if(mode==='shared'){
          const targetId='player-guild-leadership-target-'+guild.id;
          const targetSelect=node('select',{id:targetId,'data-player-guild-leadership-target':guild.id});
          targetSelect.append(node('option',{value:'',text:'Choose a current member'}));
          for(const member of guild.members){
            if(member.id===guild.leader.id&&member.role===guild.leader.role)continue;
            targetSelect.append(node('option',{
              value:JSON.stringify([member.id,member.role]),
              text:member.name+' · '+member.role.toUpperCase()
            }));
          }
          card.append(field('Offer leadership to a current member',targetId,targetSelect));
          card.append(button('Offer leadership transfer',guarded(async()=>{
            let recipient;
            try{recipient=JSON.parse(targetSelect.value);}catch{recipient=null;}
            if(!Array.isArray(recipient)||recipient.length!==2||typeof recipient[0]!=='string'||typeof recipient[1]!=='string'){
              toast('Choose a current member before offering leadership.',true);
              return;
            }
            await act({type:'offer-guild-leadership-transfer',guildId:guild.id,recipientId:recipient[0],recipientRole:recipient[1]});
            toast('Leadership offer retained. The recipient must accept before the in-game leader changes.');
          }),{class:'primary-button','data-player-guild-leadership-offer':guild.id}));
          card.append(paragraph('The selected member must have an active shared event stream when the offer is made. This handoff changes only the in-game guild role; it does not grant NGL institutional authority.','form-help'));
        }else{
          card.append(paragraph('Guild leadership handoffs are available only in the shared authoritative world.','form-help'));
        }
      }else{
        card.append(button('Leave this guild',guarded(async()=>{
          await act({type:'leave-guild',guildId:guild.id});
          toast('Membership ended. The departure remains in the Chronicle.');
        }),{class:'secondary-button','data-player-guild-leave':guild.id}));
      }
      const satchel=projectGuildFieldSatchel(sourceWorld,viewer);
      const panel=node('section',{class:'field-card','data-guild-field-satchel':guild.id},[
        node('h3',{text:'GUILD FIELD SATCHEL · '+(satchel.available?satchel.total:'UNAVAILABLE')}),
        paragraph('Read-only index of public retained work by current members. Entries link back to their originating institution; they do not transfer ownership or grant evidence status, approval, authority, XP, or progress.','form-help')
      ]);
      if(!satchel.available){
        panel.append(paragraph('Guild membership history is ambiguous or unavailable. No shared work items are projected.','evidence-warning'));
      }else if(!satchel.items.length){
        panel.append(paragraph('No public retained work from current members is available yet. Private drafts and private reports are not listed.','empty-note'));
      }else{
        const visibleCount=Math.min(20,satchel.items.length);
        const hiddenCount=Math.max(0,satchel.total-visibleCount);
        if(hiddenCount)panel.append(paragraph('Showing the newest '+visibleCount+' of '+satchel.total+' retained items; '+hiddenCount+' older items are not displayed in this panel.','form-help'));
        for(const item of satchel.items.slice(0,20)){
          const row=node('article',{class:'note-entry','data-guild-field-item':item.eventId},[
            node('div',{class:'eyebrow',text:item.kind.toUpperCase().replaceAll('-',' ')}),
            node('h4',{text:item.title}),
            paragraph(item.summary),
            paragraph(item.actor.name+' · '+String(item.actor.role).toUpperCase()+' · '+new Date(item.at).toLocaleString(),'attribution')
          ]);
          row.append(button('Inspect retained record →',()=>{
            const action=item.action;
            if(action.type==='creation')openCreation(action.creationId,action.version);
            else if(action.type==='commons')openCommons();
            else if(action.type==='moonshot')openMoonshotField(action.moonshotId);
            else if(action.type==='archive')openEvidenceArchive();
          },{class:'list-button','data-guild-field-open':item.eventId}));
          panel.append(row);
        }
      }
      card.append(panel);
      appendStudyCardCollection(card,projectCharacter(sourceWorld,viewer),{heading:'YOUR STUDY CARDS',maxItems:8});
    }else if(!projection.viewerGuildId){
      if(guild.memberCount>=PLAYER_GUILD_MEMBER_LIMIT){
        card.append(paragraph('This guild is full.','empty-note'));
      }else{
        card.append(button('Join guild',guarded(async()=>{
          await act({type:'join-guild',guildId:guild.id});
          toast('Joined '+guild.name+'. No XP or institutional authority was granted.');
        }),{class:'secondary-button','data-player-guild-join':guild.id}));
      }
    }else{
      card.append(paragraph('You already belong to another guild. One active guild per session identity.','form-help'));
    }
    board.append(card);
  }
  if(!projection.viewerGuildId){
    const nameInput=node('input',{id:'player-guild-name',maxlength:String(PLAYER_GUILD_NAME_LIMIT),placeholder:'e.g. Field Researchers',autocomplete:'off',value:nameValue});
    const charterInput=node('textarea',{id:'player-guild-charter',maxlength:String(PLAYER_GUILD_CHARTER_LIMIT),rows:'3',placeholder:'What will this guild do?',value:charterValue});
    board.append(node('article',{class:'field-card','data-player-guild-create':'true'},[
      node('h3',{text:'Found a player guild'}),
      field('Guild name · '+PLAYER_GUILD_NAME_LIMIT+' characters maximum','player-guild-name',nameInput),
      field('Charter · '+PLAYER_GUILD_CHARTER_LIMIT+' characters maximum','player-guild-charter',charterInput),
      button('Create guild',guarded(async()=>{
        await act({type:'create-guild',name:nameInput.value,charter:charterInput.value});
        toast('Guild founded. Its public history is retained; no XP or institutional authority was granted.');
      }),{id:'player-guild-create',class:'primary-button'})
    ]));
  }
  board.append(paragraph('Guild leadership handoffs require the current leader’s offer and the designated member’s acceptance. They change only this in-game guild role, not NGL institutional authority, moderation rights, evidence, XP or approval. Forge item transfers are separate. Closed guilds remain in the Chronicle.','form-help'));
  if(activeId){
    const next=[...board.querySelectorAll('[id]')].find(element=>element.id===activeId);
    if(next){
      next.focus({preventScroll:true});
      if(activeValue!==undefined)next.value=activeValue;
      if(selectionStart!==null&&selectionEnd!==null&&typeof next.setSelectionRange==='function')
        next.setSelectionRange(selectionStart,selectionEnd);
    }
  }
}
function attachPlayerGuildBoard(content){
  const board=node('section',{id:'player-guild-board'});
  content.append(board);
  const previous=activeNoteRenderer;
  activeNoteRenderer=()=>{if(previous)previous();renderPlayerGuildBoard(board,world);};
  renderPlayerGuildBoard(board,world);
}

async function openGuildHall(focusRoleId = null){
  if(mode==='shared'){
    await openInstitution('guild_hall');
    if(!$('sheet').hidden&&$('sheet-title').textContent==='Guild Hall'&&$('sheet-kicker').textContent==='COUNCIL · CAPABILITIES · EVIDENCE'){
      $('sheet-content').append(button('Enter Council Chamber →',()=>openCouncilChamber(),{class:'list-button','data-enter-council-chamber':'true'}));
      appendContradictionClerk($('sheet-content'));
      appendCollaboratorContracts($('sheet-content'),world,focusRoleId?[focusRoleId]:null,
        focusRoleId?'SYNTHESIS CLERK · BOUNDED COLLABORATOR':'BOUNDED COLLABORATOR CONTRACTS');
      attachPlayerGuildBoard($('sheet-content'));
      if(focusRoleId)focusGuildCollaborator($('sheet-content'),focusRoleId);
    }
    return;
  }
  const content=showSheet('Guild Hall','BOUNDED COLLABORATORS · PROPOSALS');
  content.append(paragraph('These guide voices are authored prompts, not executing AI agents. They cannot authorize work, certify evidence, or award progress. Use their prompts to frame a concrete next action.'));
  content.append(button('Enter Council Chamber →',()=>openCouncilChamber(),{class:'list-button','data-enter-council-chamber':'true'}));
  appendContradictionClerk(content);
  appendCollaboratorContracts(content,world,focusRoleId?[focusRoleId]:null,
    focusRoleId?'SYNTHESIS CLERK · BOUNDED COLLABORATOR':'BOUNDED COLLABORATOR CONTRACTS');
  attachPlayerGuildBoard(content);
  if(focusRoleId)focusGuildCollaborator(content,focusRoleId);
  for(const [id,guide] of Object.entries(guides))content.append(node('article',{class:'field-card'},[node('h3',{text:guide.name}),paragraph(guide.practice),button('Open guide →',()=>openGuide(id),{class:'list-button'})]));
}
function councilReviewExcerpt(value,maximum=420){
  if(typeof value!=='string')return '';
  const characters=Array.from(value);
  return characters.length>maximum?characters.slice(0,maximum).join('')+' …[excerpt]':value;
}
function appendCouncilReviewText(details,label,value){
  if(typeof value!=='string'||!value.trim())return;
  details.append(node('section',{class:'council-review-field'},[
    node('h4',{text:label}),
    paragraph(councilReviewExcerpt(value),'form-help')
  ]));
}
function appendCouncilReviewList(details,label,values){
  if(!Array.isArray(values)||!values.length)return;
  const list=node('ul',{class:'council-review-list'});
  for(const value of values.slice(0,4))
    if(typeof value==='string')list.append(node('li',{text:councilReviewExcerpt(value)}));
  if(values.length>4)list.append(node('li',{text:(values.length-4)+' additional entries; inspect the exact retained response.'}));
  details.append(node('section',{class:'council-review-field'},[node('h4',{text:label}),list]));
}
function appendCouncilReviewStatements(details,label,values){
  if(!Array.isArray(values)||!values.length)return;
  const list=node('ul',{class:'council-review-list'});
  for(const item of values.slice(0,4)){
    if(!item||typeof item.statement!=='string'||!Array.isArray(item.sourceEventIds))continue;
    const entry=node('li');
    entry.append(paragraph(councilReviewExcerpt(item.statement)));
    entry.append(node('small',{text:'Source events: '+item.sourceEventIds.join(' · ')}));
    list.append(entry);
  }
  if(values.length>4)list.append(node('li',{text:(values.length-4)+' additional statements; inspect the exact retained response.'}));
  details.append(node('section',{class:'council-review-field'},[node('h4',{text:label}),list]));
}
function appendCouncilReviewSummary(card,response,review=validateRetainedCollaboratorResponse(world,response.id,viewer)){
  if(review.status==='unavailable'){
    card.append(paragraph('Review notes withheld: the retained packet/response could not be revalidated from this snapshot ('+review.reason+'). Inspect the exact archive entry; no summary is inferred.','empty-note'));
    return;
  }
  if(review.status==='rejected'){
    card.append(paragraph('Rejected collaborator attempt preserved. No structured summary is shown. Validator reason: '+review.reason+'.','form-help'));
    return;
  }
  const details=node('details',{
    class:'council-review-details',
    'data-council-review-summary':response.role,
    'data-council-review-status':review.status
  },[
    node('summary',{text:'Open bounded review notes · untrusted collaborator output'}),
    paragraph('The exact retained packet and response passed structural/scope revalidation for human review only. These are collaborator assertions—not independent evidence, truth, execution, endorsement, consensus, approval or authority. Excerpts are bounded; inspect the archive for exact bytes.','form-help')
  ]);
  const scope=review.packetScope;
  details.append(paragraph(
    'Packet scope: '+scope.includedEventIds.length+' included source record(s); '+scope.omittedCount+
    ' eligible record(s) omitted. Omitted-ID list '+(scope.omittedEventIdListTruncated?'truncated':'not truncated')+'.',
    'form-help'
  ));
  details.append(paragraph(
    'Included source IDs: '+scope.includedEventIds.slice(0,8).join(' · ')+
    (scope.includedEventIds.length>8?' · '+(scope.includedEventIds.length-8)+' more in packet':''),
    'attribution'
  ));
  if(scope.omittedEventIds.length)details.append(paragraph(
    'Disclosed omitted IDs: '+scope.omittedEventIds.slice(0,8).join(' · ')+
    (scope.omittedEventIds.length>8?' · '+(scope.omittedEventIds.length-8)+' more disclosed':''),
    'form-help'
  ));
  const data=review.response;
  if(response.role==='adversary'){
    appendCouncilReviewText(details,'Challenge draft · not adjudicated',data.challengeDraft);
    appendCouncilReviewText(details,'Counterexample to consider',data.counterexample);
    appendCouncilReviewList(details,'Evidence requested',data.evidenceNeeded);
    appendCouncilReviewList(details,'Unknowns',data.unknowns);
  }else if(response.role==='archivist'){
    appendCouncilReviewList(details,'Event-chain findings',data.eventChainFindings);
    appendCouncilReviewList(details,'Claims · unverified',data.claims);
    appendCouncilReviewList(details,'Linkage issues',data.linkageIssues);
    appendCouncilReviewList(details,'Unknowns',data.unknowns);
    appendCouncilReviewList(details,'Next checks',data.nextChecks);
  }else if(response.role==='synthesizer'){
    appendCouncilReviewStatements(details,'Recorded support · collaborator claims',data.recordedSupport);
    appendCouncilReviewStatements(details,'Contradictions · dissent retained',data.contradictions);
    appendCouncilReviewList(details,'Dissent event IDs preserved',data.dissentPreserved);
    appendCouncilReviewList(details,'Unknowns',data.unknowns);
    if(data.nextDiscriminatingExperiment)details.append(node('section',{class:'council-review-field'},[
      node('h4',{text:'Suggested next experiment · not run or approved'}),
      paragraph('Procedure: '+councilReviewExcerpt(data.nextDiscriminatingExperiment.procedure)),
      paragraph('Outcome to compare: '+councilReviewExcerpt(data.nextDiscriminatingExperiment.outcome))
    ]));
  }else if(response.role==='tutor'){
    appendCouncilReviewList(details,'Concepts',data.concepts);
    appendCouncilReviewList(details,'Prerequisites',data.prerequisites);
    appendCouncilReviewText(details,'Explanation · general instruction, not mastery',data.explanation);
    appendCouncilReviewList(details,'Retrieval questions',data.questions);
    appendCouncilReviewList(details,'Answer key · study aid, not mastery',data.answerKey);
    appendCouncilReviewList(details,'What remains unproven',data.whatRemainsUnproven);
  }
  card.append(details);
}

function openCouncilChamber(){
  const coverageId=viewer.role==='founder'?'founder-guild-council-coverage':'witness-guild-council-coverage';
  const coverage=getQuestTrail(world,viewer).find(item=>item.id===coverageId);
  const content=showSheet('Council Chamber','GUILD HALL · ROLE COVERAGE · DELIBERATION ONLY');
  content.dataset.councilChamber='true';
  content.append(paragraph(
    (mode==='shared'?'Currently loaded shared-world snapshot':'Private world snapshot')+
    ' · actor '+(viewer.name||viewer.id||'Unknown actor')+' ('+viewer.role+'). This room is read-only; while disconnected, a shared snapshot may be stale.',
    'form-help'
  ));
  if(!coverage){
    content.append(paragraph('No actor-scoped Guild role-coverage projection is available. No progress is inferred.','empty-note'));
    return;
  }
  const progress=Number.isSafeInteger(coverage.progress)&&coverage.progress>=0?coverage.progress:0;
  const target=Number.isSafeInteger(coverage.target)&&coverage.target>0?coverage.target:GUILD_NPCS.length;
  const evidence=Array.isArray(coverage.evidence)?coverage.evidence:[];
  const evidenceByRole=new Map();
  for(const item of evidence){
    if(typeof item?.collaboratorRole==='string'&&!evidenceByRole.has(item.collaboratorRole))
      evidenceByRole.set(item.collaboratorRole,item);
  }
  const events=Array.isArray(world?.events)?world.events:[];
  content.append(node('article',{class:'field-card','data-council-coverage-progress':progress+'/'+target},[
    node('h3',{text:progress+'/'+target+' role attempts retained'}),
    paragraph('The four roles are bounded work categories, not four independent humans, votes, or endorsements.','form-help')
  ]));
  if(coverage.action?.type==='location'&&typeof coverage.action.id==='string'){
    content.append(button('Go to next available role →',()=>followQuestAction(coverage.action),{
      class:'primary-button','data-council-next-role':coverage.action.id
    }));
  }
  if(typeof coverage.blockedReason==='string'&&coverage.blockedReason)
    content.append(paragraph(coverage.blockedReason,'empty-note'));
  for(const npc of GUILD_NPCS){
    const item=evidenceByRole.get(npc.roleId)||null;
    const sameSourceIds=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&
      left.every((id,index)=>id===right[index]);
    const matches=item?events.filter(event=>event?.id===item.id&&event?.type==='collaborator-response-recorded'&&
      event?.role===npc.roleId&&event?.actor?.id===viewer.id&&event?.actor?.role===viewer.role&&
      event?.responseId===item.responseId&&event?.validator===item.validator&&
      event?.validationStatus===item.validationStatus&&event?.validationReason===item.validationReason&&
      sameSourceIds(event?.sourceEventIds,item.sourceEventIds)) : [];
    const response=matches.length===1?matches[0]:null;
    const review=response?validateRetainedCollaboratorResponse(world,response.id,viewer):null;
    const status=!item?'awaiting':!response||review?.status==='unavailable'?'link-unavailable':
      review?.status==='rejected'?'rejected':'human-review';
    const labels={
      awaiting:'AWAITING RESPONSE',
      'link-unavailable':'PROJECTION PRESENT · EXACT LINK UNAVAILABLE',
      rejected:'REJECTED · PRESERVED ATTEMPT',
      'human-review':'STRUCTURE VALID · HUMAN REVIEW ONLY'
    };
    const card=node('article',{
      class:'field-card','data-council-role':npc.roleId,'data-council-status':status,
      ...(response?{'data-council-event-id':response.id,'data-council-response-id':response.responseId}:{})
    },[
      node('h3',{text:npc.name}),
      node('span',{class:'pill',text:labels[status]}),
      paragraph(npc.objective),
      response
        ? paragraph('Retained by '+(response.actor?.name||response.actor?.id||'Unknown actor')+' · '+response.at+' · event '+response.id,'attribution')
        : paragraph(item
          ? 'The quest projection includes this role, but the exact actor-bound event could not be uniquely reopened from this snapshot. Inspect the archive before relying on this card.'
          : 'No response is retained for this role in your actor-scoped trail.','empty-note')
    ]);
    if(response){
      card.append(paragraph('Source events: '+(Array.isArray(response.sourceEventIds)?response.sourceEventIds.join(' · '):'unavailable'),'form-help'));
      appendCouncilReviewSummary(card,response,review);
      if(response.validationReason)card.append(paragraph('Structural validator note: '+response.validationReason,'form-help'));
      card.append(button('Inspect exact retained response →',()=>openEvidenceArchive(npc.roleId,response.responseId),{
        class:'list-button','data-council-inspect-response':npc.roleId
      }));
    }
    content.append(card);
  }
  if(progress>=target)
    content.append(paragraph('All four role slots have one retained attempt.','form-help'));
  content.append(paragraph(
    'Role coverage is not consensus, endorsement, adjudication, or approval. A structurally valid response is still untrusted input for human review. Rejected responses remain preserved attempts, not endorsements. This chamber creates no vote, event, XP, mastery, evidence status, truth verdict, or authority. Consequential decisions remain in the human-gated Decision Chamber.',
    'form-help'
  ));
}
function refreshForgePanels(){
  const content=$('sheet-content');
  if(!content)return;
  const forgeRoot=content.querySelector('[data-field-forge-root]');
  const kitRoot=content.querySelector('[data-field-kit-root]');
  if(forgeRoot)forgeRoot.replaceWith(buildFieldForgeSection());
  if(kitRoot)kitRoot.replaceWith(buildFieldKitSection({onChange:refreshForgePanels}));
}
function buildFieldKitSection({onChange=()=>openCharacterSheet()}={}){
  const record=projectCharacter(world,viewer);
  const section=node('section',{'data-field-kit-root':'true'});
  section.append(node('h3',{class:'section-title',text:'FIELD KIT · EQUIPMENT AND INVENTORY'}));
  section.append(paragraph('Equip only items currently owned by this actor. Unequipped items can be offered to one active shared-world recipient; only that recipient can accept. Accepted events change current ownership without rewriting original creator/source provenance. Transfers grant no XP, combat statistics or authority.','form-help'));
  const armorBearer=record.skills.find(skill=>skill.id==='armor-bearer');
  if(armorBearer)section.append(paragraph(armorBearer.count+' equipped slot'+(armorBearer.count===1?'':'s')+' · Armor-Bearer field kit. This is not combat power or mastery.','form-help'));
  for(const slot of record.equipment){
    const card=node('article',{class:'field-card','data-equipment-slot':slot.id},[
      node('h3',{text:slot.label}),
      paragraph(slot.source?'Equipped · '+slot.source.title+' · source event '+slot.source.sourceEventId:'Empty equipment slot.')
    ]);
    if(slot.source)card.append(button('Unequip',guarded(async()=>{
      await act({type:'unequip-field-item',slotId:slot.id});
      toast('Field item unequipped. Its forge history remains; no XP changed.');
      onChange();
    }),{class:'list-button','data-unequip-field-item':slot.id}));
    section.append(card);
  }
  const incoming=record.fieldItemTransferOffers.filter(offer=>
    offer.recipientId===viewer.id&&offer.recipientRole===viewer.role&&offer.status==='offered');
  if(incoming.length){
    const offersSection=node('section',{'data-incoming-field-transfers':'true'});
    offersSection.append(node('h3',{class:'section-title',text:'INCOMING FIELD-ITEM OFFERS'}));
    for(const offer of incoming){
      const sender=presence.find(player=>player.actorId===offer.fromActorId&&player.role===offer.fromActorRole);
      const item=offer.item;
      const card=node('article',{class:'field-card','data-field-transfer-offer':offer.offerId},[
        node('h3',{text:item?.title||'Field item'}),
        paragraph('Offered by '+(sender?.name||offer.fromActorId)+' ('+offer.fromActorRole+'). Only this recipient session can accept.'),
        paragraph('Original creator '+(item?.creatorId||'unknown')+' · source event '+(item?.sourceEventId||offer.itemEventId)),
        button('Accept transfer',guarded(async()=>{
          await act({type:'accept-field-item-transfer',offerId:offer.offerId});
          toast('Accepted transfer retained. Current ownership changed; no XP changed.');
          onChange();
        }),{class:'list-button','data-accept-field-item-transfer':offer.offerId})
      ]);
      offersSection.append(card);
    }
    section.append(offersSection);
  }
  section.append(node('h3',{class:'section-title',text:'PERSONAL FIELD INVENTORY'}));
  section.append(paragraph('Inventory is projected from the original forge event plus retained accepted transfers. Creator and source remain immutable; current owner follows the event chain. Actor IDs are pseudonymous sessions, not proof of distinct humans.','form-help'));
  if(!record.fieldInventory.length)section.append(paragraph('No personal field items currently owned. Use the Forge above after recording eligible activity, or accept an incoming offer.','empty-note'));
  if(record.fieldInventoryOmittedCount>0)section.append(paragraph('Showing '+record.fieldInventory.length+' of '+record.fieldInventoryTotal+' currently owned items; '+record.fieldInventoryOmittedCount+' older items remain in retained history.','form-help'));
  const recipientMap=new Map();
  for(const player of presence){
    if(!player||typeof player.actorId!=='string'||!['founder','witness'].includes(player.role)||
      (player.actorId===viewer.id&&player.role===viewer.role))continue;
    const key=JSON.stringify([player.actorId,player.role]);
    if(!recipientMap.has(key))recipientMap.set(key,player);
  }
  const recipients=[...recipientMap.values()].sort((left,right)=>
    String(left.name).localeCompare(String(right.name))||left.actorId.localeCompare(right.actorId));
  for(const item of record.fieldInventory){
    const equipped=record.equipment.find(slot=>slot.id===item.slotId)?.source?.eventId===item.eventId;
    const children=[
      node('h3',{text:item.title}),
      paragraph(item.slotLabel+' · '+item.status+' · current owner '+item.ownerId+' ('+item.ownerRole+')'),
      paragraph('Original creator '+item.creatorId+' ('+item.creatorRole+') · source type '+item.sourceKind+' · retained source event '+item.sourceEventId)
    ];
    if(item.receipt)children.push(node('small',{text:'Source SHA-256 '+item.receipt.digest+' · '+item.receipt.size+' bytes'}));
    if(item.action)children.push(button('Inspect source →',()=>followQuestAction(item.action),{class:'list-button'}));
    if(equipped)children.push(paragraph('Equipped in '+item.slotLabel+'. Unequip before creating a transfer offer.','form-help'));
    else if(item.transferOffer?.status==='offered'){
      const recipient=presence.find(player=>player.actorId===item.transferOffer.recipientId&&player.role===item.transferOffer.recipientRole);
      children.push(paragraph('Transfer offer pending to '+(recipient?.name||item.transferOffer.recipientId)+' ('+item.transferOffer.recipientRole+').','form-help'));
      children.push(button('Cancel offer',guarded(async()=>{
        await act({type:'cancel-field-item-transfer',offerId:item.transferOffer.offerId});
        toast('Transfer offer cancelled; current ownership did not change.');
        onChange();
      }),{class:'list-button','data-cancel-field-item-transfer':item.transferOffer.offerId}));
    }else{
      children.push(button('Equip item',guarded(async()=>{
        await act({type:'equip-field-item',slotId:item.slotId,sourceEventId:item.eventId});
        toast('Forged item equipped in its matching slot. No XP or authority changed.');
        onChange();
      }),{class:'list-button','data-equip-forged-item':item.itemId}));
      if(mode==='shared'&&recipients.length){
        const selector=node('select',{
          'aria-label':'Transfer recipient for '+item.title,
          'data-transfer-recipient':item.itemId
        },[
          node('option',{value:'',text:'Choose active player…'}),
          ...recipients.map(player=>node('option',{
            value:player.actorId,'data-role':player.role,
            text:player.name+' · '+player.role
          }))
        ]);
        children.push(selector);
        children.push(button('Offer transfer',guarded(async()=>{
          const selected=selector.selectedOptions?.[0];
          const recipientId=selector.value,recipientRole=selected?.getAttribute('data-role');
          if(!recipientId||!['founder','witness'].includes(recipientRole))throw new Error('Choose an active shared-world recipient first.');
          await act({type:'offer-field-item-transfer',itemEventId:item.eventId,recipientId,recipientRole});
          toast('Transfer offer retained. Only the designated recipient can accept; no XP changed.');
          onChange();
        }),{class:'list-button','data-offer-field-item':item.itemId}));
      }else if(mode==='shared'){
        children.push(paragraph('No other active shared player is currently available to receive an offer.','form-help'));
      }else{
        children.push(paragraph('Player-to-player transfer is available only in the shared authoritative world. Private saves cannot assign another actor’s identity.','form-help'));
      }
    }
    section.append(node('article',{class:'field-card','data-field-item-id':item.itemId},children));
  }
  return section;
}
function buildFieldForgeSection(){
  const section=node('section',{'data-field-forge-root':'true'});
  const record=projectCharacter(world,viewer);
  const forgedSources=new Set(record.forgedSourceEventIds||[]);
  section.append(node('h3',{class:'section-title',text:'PLAYER FIELD FORGE'}));
  section.append(paragraph('Turn one of your own earlier retained activity records into a personal field item. Each source can be forged once. Accepted offers can change the current owner only after recipient acceptance; original creator/source provenance remains unchanged. Items are not consumed and transfers grant no XP, combat statistics or authority.','form-help'));
  for(const slot of record.equipment){
    const eligible=(record.fieldItemSources?.[slot.id]||[]).filter(item=>!forgedSources.has(item.eventId));
    const omitted=record.fieldItemSourceOmittedCounts?.[slot.id]||0;
    const sourceChoiceCount=(record.fieldItemSources?.[slot.id]||[]).length;
    const card=node('article',{class:'field-card','data-forge-slot':slot.id},[
      node('h3',{text:slot.label}),paragraph(slot.description)
    ]);
    if(omitted>0)card.append(paragraph('Showing the newest '+sourceChoiceCount+' eligible source choices; '+omitted+' older source records remain in history.','form-help'));
    if(!eligible.length){
      card.append(paragraph('No un-forged source is available for this slot. Record qualifying activity first, or use a different slot.','empty-note'));
    }else{
      const selector=node('select',{
        id:'forge-source-'+slot.id,
        'aria-label':'Retained source for '+slot.label,
        'data-forge-choice':slot.id
      },eligible.map(item=>node('option',{value:item.eventId,text:item.title+' · '+item.eventId})));
      card.append(field('Retained source','forge-source-'+slot.id,selector));
      card.append(button('Forge item',guarded(async()=>{
        const sourceEventId=selector.value;
        if(!sourceEventId)throw new Error('Choose a retained source first.');
        await act({type:'forge-field-item',slotId:slot.id,sourceEventId});
        toast('Personal field item forged from your own retained activity. No XP or authority changed.');
        refreshForgePanels();
      }),{class:'primary-button','data-forge-item':slot.id}));
    }
    section.append(card);
  }
  if(record.fieldInventory.length)section.append(paragraph(
    record.fieldInventory.length+' personal field item'+(record.fieldInventory.length===1?' is':'s are')+' already forged. Equip or unequip them in the Field Kit below; Character Record shows the same projection.','form-help'
  ));
  return section;
}
function openForge(){
  if(viewer.role==='founder'){
    openWorkshop();
    $('sheet-title').textContent='Forge';
    $('sheet-kicker').textContent='FOUNDER-GATED MAKING · PLAYER FIELD KIT';
    const content=$('sheet-content');
    if(content){
      content.append(buildFieldForgeSection());
      content.append(buildFieldKitSection({onChange:refreshForgePanels}));
    }
    return;
  }
  const content=showSheet('Forge','PLAYER FIELD KIT · FOUNDER-GATED PUBLICATION');
  content.append(paragraph('The Forge makes personal field items from your own earlier retained activity. Artifact drafting, repair and publication remain Founder-gated; Witnesses can still forge, equip and unequip their own field items here.'));
  content.append(buildFieldForgeSection());
  content.append(buildFieldKitSection({onChange:refreshForgePanels}));
  content.append(button('Browse published work →',()=>openPublicationHouse(),{class:'list-button'}));
}
function retainedSourceObservatoryTargets(){
  const events=Array.isArray(world.events)?world.events:[];
  const creations=Array.isArray(world.creations)?world.creations:[];
  const sourceTargets=[];
  const sourceTargetKeys=new Set();
  for(const creation of creations){
    if(creation?.kind!=='observatory'||typeof creation.id!=='string')continue;
    for(const version of [...(Array.isArray(creation.versions)?creation.versions:[]),creation]){
      if((version.kind??creation.kind)!=='observatory'||!Number.isSafeInteger(version.version)||version.version<1||!isStrictTimestamp(version.publishedAt))continue;
      const key=JSON.stringify([creation.id,version.version]);
      if(sourceTargetKeys.has(key))continue;
      const publications=events.filter(event=>event?.type==='publish'&&event.creationId===creation.id&&event.version===version.version);
      if(publications.length!==1||publications[0].at!==version.publishedAt)continue;
      sourceTargetKeys.add(key);
      sourceTargets.push({creationId:creation.id,version:version.version,title:version.title||creation.title||creation.id,publishedAt:version.publishedAt});
    }
  }
  return sourceTargets;
}
function openSourceObservatory(){
  const targets=retainedSourceObservatoryTargets();
  const content=showSheet('Source Observatory','RESEARCH WORKBENCH · RIVER OF RECEIPTS');
  content.setAttribute('data-source-observatory','true');
  content.setAttribute('role','region');
  content.setAttribute('aria-label','Source Observatory research workbench');
  content.append(
    paragraph('This is the working room for falsifiable, actor-attributed research notes. Select one exact retained publication, record what you think it says, name a possible falsifier, and leave the uncertainty visible.','form-help'),
    paragraph('Opening this room is read-only. It does not fetch a source, verify a claim, execute a test, award XP, or grant approval or authority. The Evidence Archive preserves the resulting notes, challenges, responses and dissent.','form-help')
  );
  if(!targets.length){
    content.append(paragraph('No uniquely retained, published Source Observatory version is available yet. The workbench will not invent a target.','empty-note'));
    if(viewer.role==='founder')content.append(button('Create a Source Observatory →',()=>openWorkshop('observatory'),{class:'primary-button','data-source-observatory-create':'true'}));
    else content.append(paragraph('Wait for the Founder to publish a Source Observatory before recording a version-bound note.','form-help'));
  }else{
    let records=null;
    try{records=projectSourceObservationRecords(world.events,world.creations)}catch{}
    if(!records){
      content.append(paragraph('The retained Source Observation projection is unavailable. No record action is offered; inspect the Chronicle or Evidence Archive instead.','evidence-warning'));
    }else{
      for(const target of targets){
        const key=target.creationId+'@'+target.version;
        const linkedCount=records.filter(record=>record.projectionStatus==='linked'&&record.creationId===target.creationId&&record.version===target.version).length;
        const card=node('article',{class:'field-card','data-source-observatory-target':key});
        card.append(
          node('h3',{text:target.title+' · v'+target.version}),
          paragraph('Published '+target.publishedAt+' · '+linkedCount+' uniquely linked note(s). This count is navigation, not verification.','form-help'),
          button('Record a source observation →',()=>openSourceObservation(target.creationId,target.version),{class:'primary-button','data-source-observatory-record':key}),
          button('Inspect retained research history →',()=>openCreation(target.creationId,target.version),{class:'list-button','data-source-observatory-open':key})
        );
        content.append(card);
      }
    }
  }
  content.append(button('Review retained records and dissent →',()=>openEvidenceArchive(),{class:'list-button','data-source-observatory-archive':'true'}));
}
function openEvidenceArchive(focusRoleId = null, focusResponseId = null){
  const kicker='REPORTS · CONTRIBUTIONS · RESEARCH RECORDS';
  const content=showSheet('Evidence Archive',kicker);
  content.append(paragraph('This archive preserves attributed notes, Moonshot proposals, self-reported experiment attempts, challenges, exact hand-off packets and pasted collaborator responses. Receipts identify bytes; they do not establish truth. Research records and collaborator output remain claims, reports, or dissent—not independent verification, approval, or verdicts.','form-help'));
  content.append(button('Enter Council Chamber →',()=>openCouncilChamber(),{class:'list-button','data-enter-council-chamber':'true'}));
  appendCollaboratorContracts(content,world,focusRoleId?[focusRoleId]:['archivist','adversary'],
    'EVIDENCE REVIEW · BOUNDED COLLABORATORS');
  if(focusRoleId)focusGuildCollaborator(content,focusRoleId);
  const events=Array.isArray(world.events)?world.events:[];
  const creations=Array.isArray(world.creations)?world.creations:[];
  const sourceTargets=retainedSourceObservatoryTargets();
  const importer=node('section',{class:'field-card','data-source-observation-import':'true'});
  importer.append(node('h3',{text:'Import Source Observatory notes'}));
  importer.append(paragraph('Choose a retained, published Observatory version, then select its ngl.source-observatory.v2 JSON export. The version binding is your selection; the file does not prove its own origin. No source is fetched, independently verified or executed. Recording a note grants no XP, approval or truth status.','form-help'));
  const targetSelect=node('select',{class:'form-input','aria-label':'Retained Source Observatory version'});
  targetSelect.dataset.sourceObservationImportTarget='true';
  targetSelect.append(node('option',{value:'',text:sourceTargets.length?'Choose a published version…':'No published Source Observatory version is retained'}));
  for(const target of sourceTargets){
    const value=JSON.stringify({creationId:target.creationId,version:target.version});
    targetSelect.append(node('option',{value,text:target.title+' · v'+target.version+' · '+target.publishedAt}));
  }
  if(!sourceTargets.length)targetSelect.disabled=true;
  importer.append(node('label',{class:'form-label',text:'Source version selected by importer'}));
  importer.append(targetSelect);
  const fileInput=node('input',{type:'file',accept:'application/json,.json',hidden:true});
  fileInput.dataset.sourceObservationImportFile='true';
  importer.append(fileInput);
  importer.append(button('Choose notebook export JSON →',()=>fileInput.click(),{class:'list-button'}));
  const preview=node('div',{class:'evidence-import-preview'});
  preview.dataset.sourceObservationImportPreview='true';
  importer.append(preview);
  const status=paragraph('Imports become append-only, actor-attributed notes. Re-importing the same note for the same actor and selected version is idempotent.','form-help');
  status.dataset.sourceObservationImportStatus='true';
  importer.append(status);
  let parsedExport=null,previewTarget='';
  const confirmButton=button('Record notes in Evidence Archive →',async()=>{
    if(!parsedExport||!targetSelect.value||targetSelect.value!==previewTarget)return;
    confirmButton.disabled=true;
    const beforeIds=new Set(projectSourceObservationRecords(world.events,world.creations).map(record=>record.observationId));
    let processed=0;
    try{
      const target=JSON.parse(targetSelect.value);
      for(const note of parsedExport.observations){
        if(!globalThis.crypto?.subtle)throw new Error('Web Crypto is unavailable in this browser context.');
        const material=sourceObservationRequestMaterial({
          actorId:viewer.id,actorRole:viewer.role,creationId:target.creationId,version:target.version,...note
        });
        const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(material));
        const digest=Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
        const observationId='source-observation-'+digest;
        await act({
          type:'record-source-observation',requestId:observationId,observationId,
          creationId:target.creationId,version:target.version,...note
        });
        processed++;
      }
      const afterIds=new Set(projectSourceObservationRecords(world.events,world.creations).map(record=>record.observationId));
      const added=[...afterIds].filter(id=>!beforeIds.has(id)).length;
      toast('Processed '+processed+' source note(s); '+added+' new retained event(s). No verification or XP was granted.');
      parsedExport=null;
      fileInput.value='';
      openEvidenceArchive();
    }catch(error){
      status.textContent='Stopped after '+processed+' of '+(parsedExport?.observations.length||0)+' note(s): '+(error?.message||'Import failed')+'. Earlier accepted notes remain. In shared mode, retry this same file after reconnecting; Relay keeps the exact pending request.';
      confirmButton.disabled=false;
    }
  },{class:'primary-button'});
  confirmButton.dataset.sourceObservationImportConfirm='true';
  confirmButton.disabled=true;
  importer.append(confirmButton);
  targetSelect.addEventListener('change',()=>{
    if(parsedExport){
      parsedExport=null;previewTarget='';preview.replaceChildren();confirmButton.disabled=true;
      status.textContent='The selected version changed. Choose the export again so the binding remains explicit.';
    }
  });
  fileInput.addEventListener('change',async()=>{
    parsedExport=null;previewTarget='';preview.replaceChildren();confirmButton.disabled=true;
    const file=fileInput.files?.[0];
    if(!file)return;
    if(file.size>512*1024){status.textContent='Export exceeds the 512 KiB import limit.';return;}
    if(!targetSelect.value){status.textContent='Select one retained, published Source Observatory version first.';return;}
    try{
      parsedExport=parseSourceObservatoryExport(await file.text());
      previewTarget=targetSelect.value;
      preview.append(node('strong',{text:file.name+' · '+parsedExport.observations.length+' observation(s)'}));
      for(const note of parsedExport.observations){
        preview.append(node('article',{class:'field-card'},[
          node('strong',{text:note.claim}),
          paragraph('Self-classified source kind: '+note.sourceKind),
          paragraph('Source/attribution: '+note.source)
        ]));
      }
      confirmButton.disabled=false;
      status.textContent='Ready to record as '+viewer.name+' ('+viewer.role+'). The source class and note are attributed inputs, not verified findings.';
    }catch(error){
      status.textContent=error?.message||'The export could not be read.';
    }
  });
  content.append(importer);
  const entries=[
    ...(Array.isArray(world.reports)?world.reports:[]).map(entry=>({...entry,kind:'Report'})),
    ...(Array.isArray(world.contributions)?world.contributions:[]).map(entry=>({...entry,kind:'Contribution'}))
  ].sort((a,b)=>String(b.at).localeCompare(String(a.at)));
  if(!entries.length)content.append(paragraph('No artifact-bound reports or contributions have been retained yet. The empty section is an honest state, not a failed claim.','empty-note'));
  for(const entry of entries){
    const creation=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===entry.creationId);
    content.append(node('article',{class:'field-card'},[
      node('h3',{text:entry.kind+' · '+(creation?.title||entry.creationId)+' · v'+entry.version}),
      paragraph(entry.text),
      paragraph('By '+(entry.actor?.name||entry.actor?.id||'Unknown actor')+' · '+entry.at+' · retained record, not a verdict.','attribution'),
      button('Inspect referenced version →',()=>openCreation(entry.creationId,entry.version),{class:'list-button'})
    ]));
  }

  const researchEvents=projectResearchRecords(events,creations);
  const sourceObservationRecords=projectSourceObservationRecords(events,creations);
  content.append(node('h3',{class:'section-title',text:'SOURCE OBSERVATIONS'}));
  if(!sourceObservationRecords.length)content.append(paragraph('No source observations have been retained in this world yet.','empty-note'));
  for(const record of sourceObservationRecords){
    const card=node('article',{class:'field-card','data-source-observation-card':'true','data-observation-id':record.observationId});
    card.append(node('h3',{text:record.claim}));
    card.append(paragraph('Self-classified source kind: '+record.sourceKind+' · '+record.warning));
    card.append(paragraph('Source/attribution: '+record.source));
    card.append(paragraph('Falsifier: '+(record.falsifier||'NOT PROVIDED')+' · Uncertainty: '+(record.uncertainty||'NOT PROVIDED')));
    card.append(paragraph('Next test: '+(record.nextTest||'NOT PROVIDED')));
    card.append(paragraph('Recorded by '+(record.actor?.name||record.actor?.id||'unknown actor')+' ('+record.actor?.role+') · '+record.at));
    card.append(paragraph('Selected target: '+(record.targetTitle||record.creationId)+' · v'+record.version+' · binding '+record.bindingMode));
    card.append(paragraph('Assurance: source retrieval '+record.sourceRetrieval+'; independent verification '+record.independentVerification+'; model assertions '+record.modelAssertions+'; execution '+record.execution+'.','form-help'));
    for(const challenge of record.challenges||[]){
      card.append(paragraph('Challenge · '+challenge.challengeType+': '+challenge.challengeText,'form-help'));
      if(challenge.responseStatus==='answered')for(const response of challenge.responses||[])card.append(paragraph('Author response · '+response.responseText));
      else if(challenge.responseStatus==='ambiguous')card.append(paragraph('Response history is ambiguous; no reply is selected.','evidence-warning'));
    }
    card.append(paragraph(record.projectionStatus==='linked'?'Linked to one earlier retained Source Observatory publication. This reference does not prove that the export originated from that version.':'Reference status: '+record.projectionStatus+' · '+(record.projectionReason||'not linked'),'evidence-warning'));
    content.append(card);
  }
  content.append(node('h3',{class:'section-title',text:'MOONSHOT RECORDS'}));
  if(!researchEvents.length)content.append(paragraph('No Moonshot proposals, experiment attempts, or challenges have been retained yet.','empty-note'));

  const artifactLinkReason=status=>({
    invalid:'the artifact reference is incomplete or malformed',
    unavailable:'no matching publication is retained in this history',
    ambiguous:'the publication reference is ambiguous',
    'not-earlier':'the publication appears after this record in retained history',
    'timestamp-conflict':'publication and record timestamps conflict'
  }[status]||'the artifact link could not be verified');
  const hasArtifactReference=entry=>(entry?.evidenceCreationId!==undefined&&entry?.evidenceCreationId!==null)||
    (entry?.evidenceVersion!==undefined&&entry?.evidenceVersion!==null);
  const appendVersionLink=(card,creationId,version,label,projection)=>{
    if(!projection?.eventIdUnique){
      card.append(paragraph('This event ID is missing or duplicated; no artifact link is activated from this record.','evidence-warning'));
      return;
    }
    if(typeof creationId!=='string'||!creationId||!Number.isSafeInteger(version)||version<1){
      card.append(paragraph('The '+label+' reference is incomplete; no artifact target is inferred.','evidence-warning'));
      return;
    }
    const creation=creations.find(item=>item?.id===creationId);
    const retained=creation&&[creation,...(Array.isArray(creation.versions)?creation.versions:[])].some(item=>item?.version===version);
    if(retained)card.append(button('Inspect '+label+' v'+version+' →',()=>openCreation(creationId,version),{class:'list-button'}));
    else card.append(paragraph('The linked '+label+' version is unavailable in this snapshot; no substitute is inferred.','evidence-warning'));
  };

  for(const entry of researchEvents){
    const projection=entry._projection;
    const proposal=entry.type==='moonshot-proposed'?entry:projection?.proposal;
    const proposalTitle=proposal?.title||entry.moonshotId||'Unknown moonshot';
    const actor=entry.actor?.name||entry.actor?.id||'Unknown actor';
    const at=typeof entry.at==='string'?entry.at:'time unavailable';
    const type=entry.type.toUpperCase().replaceAll('-','_');
    const card=node('article',{class:'field-card','data-research-record-type':type,'data-event-id':typeof entry.id==='string'?entry.id:''},[]);
    if(!projection?.eventIdUnique)card.append(paragraph('AMBIGUOUS EVENT ID · CONTEXT LINKS DISABLED','evidence-warning'));
    if(entry.type==='moonshot-proposed'&&projection?.proposalStatus!=='unique')card.append(paragraph('AMBIGUOUS OR INVALID MOONSHOT ID · NOT LINKED','evidence-warning'));
    if(entry.type!=='moonshot-proposed'&&projection?.proposalStatus!=='linked')card.append(paragraph('Proposal context is '+(projection?.proposalStatus||'unavailable')+'; no proposal is inferred.','evidence-warning'));
    if(entry.type==='moonshot-proposed'){
      card.append(
        node('h3',{text:'Moonshot proposal · '+(entry.title||'Untitled proposal')}),
        node('span',{class:'pill',text:'PROPOSED · NOT EXECUTED'}),
        paragraph('Hypothesis: '+(entry.hypothesis||'not recorded')),
        paragraph('Falsification condition: '+(entry.falsifier||'not recorded')),
        paragraph('Evidence required: '+(entry.evidenceNeeded||'not recorded'))
      );
      if(entry.sourceCreationId||(entry.sourceVersion!==undefined&&entry.sourceVersion!==null)){
        if(projection?.proposalStatus==='unique'&&projection?.sourceStatus==='linked'){
          appendVersionLink(card,entry.sourceCreationId,entry.sourceVersion,'source',projection);
        }else{
          const reason=projection?.proposalStatus!=='unique'
            ?'the proposal identity is ambiguous or invalid'
            :artifactLinkReason(projection?.sourceStatus);
          card.append(paragraph('Source link is not activated: '+reason+'.','evidence-warning'));
        }
      }else card.append(paragraph('No source artifact is linked to this proposal.','form-help'));
    }else if(entry.type==='experiment-reported'){
      card.append(
        node('h3',{text:'Experiment report · '+proposalTitle}),
        node('span',{class:'pill',text:'SELF-REPORTED · NOT ADJUDICATED'}),
        paragraph('Procedure: '+(entry.procedure||'not recorded')),
        paragraph('Observation: '+(entry.observation||'not recorded')),
        paragraph('Reported outcome: '+(entry.reportedOutcome||'not supplied'))
      );
      if(hasArtifactReference(entry)){
        if(projection?.eventIdUnique&&projection?.evidenceStatus==='linked')appendVersionLink(card,entry.evidenceCreationId,entry.evidenceVersion,'evidence',projection);
        else card.append(paragraph('Evidence link is not activated: '+artifactLinkReason(projection?.evidenceStatus)+'.','evidence-warning'));
      }else card.append(paragraph('No retained artifact is linked to this attempt; the report remains self-reported.','evidence-warning'));
    }else{
      const targetReport=projection?.targetReport||null;
      card.append(
        node('h3',{text:'Experiment challenge · '+proposalTitle}),
        node('span',{class:'pill',text:'DISSENT · NOT ADJUDICATED'}),
        paragraph('Target report: '+(entry.reportId||'unavailable'))
      );
      if(targetReport){
        card.append(
          paragraph('Target procedure: '+(targetReport.procedure||'not recorded')),
          paragraph('Target observation: '+(targetReport.observation||'not recorded')),
          paragraph('Target outcome (self-reported): '+(targetReport.reportedOutcome||'not supplied'))
        );
      }else card.append(paragraph('The challenged report is unavailable or ambiguous ('+(projection?.targetReportStatus||'unknown')+'); no target is inferred.','evidence-warning'));
      card.append(
        paragraph('Challenge category: '+String(entry.challengeType||'other').replaceAll('-',' ')),
        paragraph('Counterargument: '+(entry.challengeText||'not recorded'))
      );
      if(hasArtifactReference(entry)){
        if(projection?.eventIdUnique&&projection?.evidenceStatus==='linked')appendVersionLink(card,entry.evidenceCreationId,entry.evidenceVersion,'challenge evidence',projection);
        else card.append(paragraph('Challenge evidence link is not activated: '+artifactLinkReason(projection?.evidenceStatus)+'.','evidence-warning'));
      }else card.append(paragraph('No retained artifact is linked to this challenge.','evidence-warning'));
    }
    card.append(paragraph('By '+actor+' · '+at+' · attributed event, not independent verification.','attribution'));
    card.append(node('code',{text:typeof entry.id==='string'&&entry.id?entry.id:'missing event ID'}));
    if(projection?.eventIdUnique && ['unique','linked'].includes(projection.proposalStatus) &&
        typeof entry.moonshotId==='string' && entry.moonshotId.trim()){
      card.append(button('Open Moonshot Field →',()=>openMoonshotField(entry.moonshotId),{class:'list-button'}));
    }
    content.append(card);
  }

const collaboratorResponses=events.filter(event=>event?.type==='collaborator-response-recorded').slice().reverse();
  content.append(node('h3',{class:'section-title',text:'BOUNDED COLLABORATOR RESPONSES'}));
  if(!collaboratorResponses.length)content.append(paragraph('No external collaborator responses have been preserved yet. A returned answer remains untrusted until a human explicitly archives it; archiving does not endorse its claims.','empty-note'));
  const collaboratorNames={archivist:'Hostile Archivist',adversary:'Adversary',synthesizer:'Synthesis Clerk',tutor:'Polymath Tutor'};
  const focusMatches=typeof focusResponseId==='string'&&focusResponseId
    ? collaboratorResponses.filter(entry=>entry?.responseId===focusResponseId) : [];
  for(const entry of collaboratorResponses){
    const valid=entry.validationStatus==='valid-for-human-review';
    const focusThisResponse=focusMatches.length===1&&entry===focusMatches[0];
    const card=node('article',{
      class:'field-card','data-collaborator-response-id':entry.responseId,
      ...(focusThisResponse?{'data-council-response-focus':'true',tabindex:'-1'}:{})
    },[
      node('h3',{text:(collaboratorNames[entry.role]||entry.role)+' · '+(valid?'STRUCTURE VALID · HUMAN REVIEW ONLY':'REJECTED · PRESERVED')}),
      paragraph('Moonshot '+entry.moonshotId+' · actor '+(entry.actor?.name||entry.actor?.id||'Unknown actor')+' · '+entry.at,'attribution'),
      paragraph('Source events: '+entry.sourceEventIds.join(' · ')),
      paragraph('Packet SHA-256 '+entry.packetReceipt.digest+' · '+entry.packetReceipt.size+' bytes'),
      paragraph('Response SHA-256 '+entry.responseReceipt.digest+' · '+entry.responseReceipt.size+' bytes'),
      paragraph(entry.validationReason?'Structural validator result: '+entry.validationReason:'Structural validator result: valid for human review only; no truth or authority was verified.','form-help')
    ]);
    const packetDetails=node('details',{class:'collaborator-packet'},[
      node('summary',{text:'Inspect exact archived packet'}),
      node('textarea',{readonly:'',rows:'8','aria-label':'Archived collaborator packet',value:entry.packetJson})
    ]);
    const responseDetails=node('details',{class:'collaborator-response'},[
      node('summary',{text:'Inspect exact pasted response'}),
      node('textarea',{readonly:'',rows:'8','aria-label':'Archived collaborator response',value:entry.responseText})
    ]);
    card.append(packetDetails,responseDetails,button('Open related Moonshot →',()=>openMoonshotField(entry.moonshotId),{class:'list-button'}));
    content.append(card);
    if(focusThisResponse){
      card.focus({preventScroll:true});
      card.scrollIntoView?.({block:'nearest'});
    }
  }

  const history=node('section',{class:'evidence-history'});
  content.append(history);
  const generation=++evidenceArchiveGeneration;
  const principalId=viewer.id;
  const principalRole=viewer.role;
  const stillCurrent=()=>generation===evidenceArchiveGeneration&&mode==='shared'&&viewer.id===principalId&&viewer.role===principalRole&&!$('sheet').hidden&&content===$('sheet-content')&&$('sheet-kicker').textContent===kicker;
  const renderHistory=(kernel,kernelUnavailable=false)=>renderEvidenceArchive(history,{
    world,kernel,kernelUnavailable,shared:mode==='shared',
    onOpenArtifact:(id,version)=>openCreation(id,version)
  });
  if(mode!=='shared'){
    renderHistory(null,false);
    return;
  }
  history.append(paragraph('Loading canonical institutional history…','form-help'));
  request('/api/institution').then(result=>{
    if(!stillCurrent())return;
    history.replaceChildren();
    renderHistory(result?.kernel||null,!result?.kernel);
  }).catch(()=>{
    if(!stillCurrent())return;
    history.replaceChildren();
    renderHistory(null,true);
  });
}

function openAcademy(focusRoleId = null){
  const content=showSheet('Polymath Academy','FUNDAMENTAL KNOWLEDGE · STUDY');
  content.append(paragraph('Study published work and compare its claims with its retained sources. A study note records your question, your own explanation, and the next check. It is activity evidence, not proof of correctness or mastery; it awards no XP.'));
  renderCharterCodex(content,{world,viewer,onOpenAction:followQuestAction});
  appendCollaboratorContracts(content,world,['tutor'],'POLYMATH TUTOR · BOUNDED COLLABORATOR');
  if(focusRoleId)focusGuildCollaborator(content,focusRoleId);
  appendStudyCardCollection(content,projectCharacter(world,viewer),{heading:'ACADEMY STUDY SHELF',maxItems:8});
  const works=[...(Array.isArray(world.creations)?world.creations:[])].reverse();
  if(!works.length){
    content.append(paragraph('No published study objects are available yet. The Founder can make the first artifact at the Forge.','empty-note'));
    if(viewer.role==='founder')content.append(button('Visit the Forge →',()=>{closeSheet();view.goTo('forge')},{class:'list-button'}));
  }
  for(const creation of works)content.append(node('article',{class:'field-card'},[
    node('h3',{text:creation.title}),
    paragraph(creation.kind+' · published v'+creation.version+' · '+creation.receipt.size+' retained bytes'),
    button('Open source →',()=>openCreation(creation.id,creation.version),{class:'list-button'}),
    button('Record study note →',()=>openStudyNote(creation.id,creation.version),{class:'list-button'})
  ]));
  const notes=(Array.isArray(world.events)?world.events:[]).filter(event=>event?.type==='study').slice().reverse().slice(0,8);
  content.append(node('h3',{class:'section-title',text:'RETAINED STUDY NOTES'}));
  if(!notes.length)content.append(paragraph('No study notes retained yet. The first note should identify an exact source version and what remains to check.','empty-note'));
  const allReviews=(Array.isArray(world.events)?world.events:[]).filter(event=>event?.type==='study-reviewed');
  const reviews=allReviews.slice().reverse().slice(0,8);
  for(const note of notes){
    const source=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===note.creationId);
    const review=findStudyReview(note,world.events);
    const children=[
      node('h3',{text:(source?.title||'Source unavailable')+' · v'+note.version}),
      paragraph('Question: '+note.question),
      paragraph('Attempt: '+note.attempt),
      paragraph('Next check: '+note.nextCheck),
      paragraph((note.actor?.name||'Unknown actor')+' · '+note.at+' · recorded practice, not mastery.','attribution')
    ];
    const unresolvedReview=hasStudyReviewRecord(note,world.events)&&!review;
    if(unresolvedReview)
      children.push(paragraph('A review record exists, but it does not uniquely match this retained note and source version. No completion is credited; inspect the retained history rather than creating a duplicate.','evidence-warning'));
    else if(note.actor?.id===viewer.id&&note.actor?.role===viewer.role&&!review)
      children.push(button('Review next check →',()=>openStudyReview(note),{class:'list-button'}));
    if(review)children.push(paragraph('A retrieval review is retained for this note; its response remains self-reported.','form-help'));
    children.push(button('Inspect retained source version →',()=>openCreation(note.creationId,note.version),{class:'list-button'}));
    content.append(node('article',{class:'field-card'},children));
  }
  content.append(node('h3',{class:'section-title',text:'RETAINED RETRIEVAL REVIEWS'}));
  if(!reviews.length)content.append(paragraph('No retrieval reviews retained yet. A review must follow your own source-bound study note.','empty-note'));
  for(const review of reviews){
    const source=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===review.creationId);
    content.append(node('article',{class:'field-card'},[
      node('h3',{text:(source?.title||'Source unavailable')+' · v'+review.version}),
      paragraph('Response: '+review.response),
      paragraph('Reflection: '+review.reflection),
      paragraph((review.actor?.name||'Unknown actor')+' · '+review.at+' · self-reported retrieval practice, not mastery.','attribution'),
      button('Inspect reviewed source version →',()=>openCreation(review.creationId,review.version),{class:'list-button'})
    ]));
  }
}
function openStudyNote(creationId,versionNumber){
  const creation=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===creationId);
  const version=creation&&(creation.version===versionNumber?creation:(Array.isArray(creation.versions)?creation.versions:[]).find(item=>item.version===versionNumber));
  if(!creation||!version){toast('That published study version is unavailable. Refresh the world before recording a note.',true);openAcademy();return;}
  const content=showSheet('Record a study note','POLYMATH ACADEMY · SOURCE-BOUND PRACTICE');
  content.append(paragraph('Source: '+creation.title+' · v'+versionNumber+' · '+version.receipt.size+' retained bytes.'));
  content.append(paragraph('Write what you are trying to understand, your own explanation, and the next check that could expose a gap. This record is self-authored; it does not certify mastery, correctness, or external knowledge.'));
  const form=node('form',{class:'field-card'},[]);
  const question=node('textarea',{id:'academy-study-question',maxlength:'500',rows:'3',placeholder:'What question are you studying?',required:'required'});
  const attempt=node('textarea',{id:'academy-study-attempt',maxlength:'1000',rows:'4',placeholder:'Explain the idea in your own words. Mark uncertainty instead of bluffing.',required:'required'});
  const nextCheck=node('textarea',{id:'academy-study-next-check',maxlength:'500',rows:'3',placeholder:'What source, counterexample, exercise, or observation would test your explanation?',required:'required'});
  const submit=node('button',{id:'academy-study-submit',class:'primary-button',type:'submit',text:'Retain study note'});
  form.append(
    field('Study question','academy-study-question',question),
    field('Your explanation · uncertainty allowed','academy-study-attempt',attempt),
    field('Next check','academy-study-next-check',nextCheck),
    paragraph('A retained note counts as Scholar activity only. It awards no XP and cannot certify skill or truth.','form-help'),
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      await act({
        type:'study',creationId,version:versionNumber,
        question:question.value.trim(),attempt:attempt.value.trim(),nextCheck:nextCheck.value.trim()
      });
      toast('Study note retained · exact source version bound · Scholar activity only · no XP or mastery awarded.');
      openAcademy();
    }finally{submit.disabled=false;}
  });
}
function openStudyReview(note){
  const content=showSheet('Review your next check','POLYMATH ACADEMY · RETRIEVAL PRACTICE');
  content.append(paragraph('Return to the next check you wrote for this earlier note. Answer from memory first if useful, then record what remains uncertain. This is a later self-report, not a correctness score, external observation, or mastery certificate.'));
  content.append(paragraph('Original next check: '+note.nextCheck,'field-card'));
  content.append(paragraph('Source: '+note.creationId+' · retained v'+note.version+'.'));
  const form=node('form',{class:'field-card'},[]);
  const response=node('textarea',{id:'academy-review-response',maxlength:'1000',rows:'4',placeholder:'Your response to the earlier next check',required:'required'});
  const reflection=node('textarea',{id:'academy-review-reflection',maxlength:'1000',rows:'3',placeholder:'What changed, what was missing, or what remains uncertain?',required:'required'});
  const submit=node('button',{id:'academy-review-submit',class:'primary-button',type:'submit',text:'Retain retrieval review'});
  form.append(
    field('Response to the next check','academy-review-response',response),
    field('Reflection and remaining uncertainty','academy-review-reflection',reflection),
    paragraph('One review is allowed per study note. Start a new source-bound study note for another practice cycle. No XP or mastery is awarded.','form-help'),
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      await act({type:'review-study',studyId:note.studyId,response:response.value.trim(),reflection:reflection.value.trim()});
      toast('Retrieval review retained · source-bound · self-reported · no XP or mastery awarded.');
      openAcademy();
    }finally{submit.disabled=false;}
  });
}
function openExperimentReport(proposal){
  const content=showSheet('Record an attempt.','MOONSHOT FIELD · EXPERIMENT REPORT');
  content.append(paragraph('Retain what was tried and what was observed. The outcome is your report, not an adjudication. Failed attempts and contradictions stay visible. A linked artifact identifies retained bytes only; this form does not verify execution, truth, or success.'));
  const form=node('form',{class:'field-card'},[]);
  const procedure=node('textarea',{id:'experiment-procedure',maxlength:'1000',rows:'3',placeholder:'What procedure or method did you actually try?',required:'required'});
  const observation=node('textarea',{id:'experiment-observation',maxlength:'1000',rows:'3',placeholder:'What did you observe, including failures or contradictions?',required:'required'});
  const outcome=node('select',{id:'experiment-outcome',required:'required'},[
    node('option',{value:'',text:'Choose a reported outcome'}),
    node('option',{value:'supports',text:'Supports hypothesis · self-reported'}),
    node('option',{value:'contradicts',text:'Contradicts hypothesis · self-reported'}),
    node('option',{value:'inconclusive',text:'Inconclusive · self-reported'}),
    node('option',{value:'failed',text:'Attempt failed · self-reported'})
  ]);
  const evidenceSource=node('select',{id:'experiment-evidence-source'},[]);
  evidenceSource.append(node('option',{value:'',text:'No retained artifact linked'}));
  for(const creation of (Array.isArray(world.creations)?world.creations:[])){
    evidenceSource.append(node('option',{value:creation.id,text:creation.title+' · current v'+creation.version}));
  }
  const evidenceVersion=node('select',{id:'experiment-evidence-version'});
  const syncEvidenceVersions=()=>{
    evidenceVersion.replaceChildren();
    const creation=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===evidenceSource.value);
    if(!creation){
      evidenceVersion.append(node('option',{value:'',text:'No evidence version'}));
      evidenceVersion.disabled=true;
      return;
    }
    const versions=[...(Array.isArray(creation.versions)?creation.versions:[]),creation]
      .filter(version=>Number.isInteger(version.version))
      .sort((left,right)=>left.version-right.version);
    for(const version of versions)evidenceVersion.append(node('option',{value:String(version.version),text:(version.version===creation.version?'Current':'Retained')+' version '+version.version}));
    evidenceVersion.value=String(creation.version);
    evidenceVersion.disabled=false;
  };
  evidenceSource.onchange=syncEvidenceVersions;
  syncEvidenceVersions();
  const submit=node('button',{id:'report-experiment',class:'primary-button',type:'submit',text:'Retain experiment report'});
  form.append(
    field('Procedure','experiment-procedure',procedure),
    field('Observed result or failure','experiment-observation',observation),
    field('Reported outcome · not adjudicated','experiment-outcome',outcome),
    field('Optional retained evidence artifact','experiment-evidence-source',evidenceSource),
    field('Evidence version','experiment-evidence-version',evidenceVersion),
    paragraph('This creates an attributed report event only. It awards no XP and does not mark the hypothesis true or false.','form-help'),
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      const selected=(Array.isArray(world.creations)?world.creations:[]).find(creation=>creation.id===evidenceSource.value);
      await act({
        type:'report-experiment',
        moonshotId:proposal.moonshotId,
        procedure:procedure.value.trim(),
        observation:observation.value.trim(),
        reportedOutcome:outcome.value,
        evidenceCreationId:selected?.id??null,
        evidenceVersion:selected?Number(evidenceVersion.value):null
      });
      toast('Experiment report retained · self-reported · not adjudicated · no XP awarded.');
      openMoonshotField();
    }finally{submit.disabled=false;}
  });
}
function openExperimentChallenge(report){
  const content=showSheet('Challenge experiment report','RETAINED DISSENT · NOT ADJUDICATION');
  content.append(paragraph('Challenge the report’s evidence, method, scope or reproducibility. This appends an attributed counterargument without deleting or rewriting the report. It does not establish truth, independently verify the challenge, authorize work, or award XP.'));
  const form=node('form',{class:'field-card'},[]);
  const challengeType=node('select',{id:'experiment-challenge-type',required:'required'},[
    node('option',{value:'',text:'Choose a challenge category'}),
    node('option',{value:'missing-evidence',text:'Missing or insufficient evidence'}),
    node('option',{value:'methodology',text:'Methodology concern'}),
    node('option',{value:'contradiction',text:'Contradiction or counterexample'}),
    node('option',{value:'reproducibility',text:'Reproducibility concern'}),
    node('option',{value:'scope',text:'Scope or applicability concern'}),
    node('option',{value:'other',text:'Other challenge'})
  ]);
  const challengeText=node('textarea',{id:'experiment-challenge-text',maxlength:'1000',rows:'4',placeholder:'State the specific gap, counterexample, or reason this report should not be accepted as verified.'});
  const evidenceSource=node('select',{id:'experiment-challenge-evidence-source'},[]);
  evidenceSource.append(node('option',{value:'',text:'No retained artifact linked'}));
  for(const creation of (Array.isArray(world.creations)?world.creations:[])){
    evidenceSource.append(node('option',{value:creation.id,text:creation.title+' · current v'+creation.version}));
  }
  const evidenceVersion=node('select',{id:'experiment-challenge-evidence-version'});
  const syncEvidenceVersions=()=>{
    evidenceVersion.replaceChildren();
    const creation=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===evidenceSource.value);
    if(!creation){
      evidenceVersion.append(node('option',{value:'',text:'No evidence version'}));
      evidenceVersion.disabled=true;
      return;
    }
    const versions=[...(Array.isArray(creation.versions)?creation.versions:[]),creation]
      .filter(version=>Number.isInteger(version.version))
      .sort((left,right)=>left.version-right.version);
    for(const version of versions)evidenceVersion.append(node('option',{value:String(version.version),text:(version.version===creation.version?'Current':'Retained')+' version '+version.version}));
    evidenceVersion.value=String(creation.version);
    evidenceVersion.disabled=false;
  };
  evidenceSource.onchange=syncEvidenceVersions;
  syncEvidenceVersions();
  const submit=node('button',{id:'challenge-experiment-report',class:'primary-button',type:'submit',text:'Preserve challenge'});
  form.append(
    field('Challenge category','experiment-challenge-type',challengeType),
    field('Challenge / counterargument','experiment-challenge-text',challengeText),
    field('Optional retained evidence artifact','experiment-challenge-evidence-source',evidenceSource),
    field('Evidence version','experiment-challenge-evidence-version',evidenceVersion),
    paragraph('A linked artifact identifies retained bytes only. A different actor ID is service attribution, not proof of a different real-world person or independent witness.','form-help'),
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      await act({
        type:'challenge-experiment-report',
        reportId:report.reportId,
        challengeType:challengeType.value,
        challengeText:challengeText.value.trim(),
        evidenceCreationId:((Array.isArray(world.creations)?world.creations:[]).find(creation=>creation.id===evidenceSource.value))?.id??null,
        evidenceVersion:evidenceSource.value?Number(evidenceVersion.value):null
      });
      toast('Challenge retained · dissent preserved · not adjudicated · no XP awarded.');
      openMoonshotField();
    }finally{submit.disabled=false;}
  });
}
function openMoonshotField(focusMoonshotId=null,focusActivityId=null){
  const content=showSheet('Moonshot Field','BOUNDED RESEARCH · PROPOSALS ARE NOT RESULTS');
  content.append(paragraph('Create a bounded research proposal with a hypothesis, a falsification condition, and the evidence needed. Founder and Witness can propose. Saving retains the question; it does not execute an experiment, award XP, establish truth, or authorize world changes.'));
  const form=node('form',{class:'field-card'},[]);
  const title=node('input',{id:'moonshot-title',maxlength:'80',placeholder:'A concise question to investigate',autocomplete:'off'});
  const hypothesis=node('textarea',{id:'moonshot-hypothesis',maxlength:'1000',rows:'3',placeholder:'What do you predict, and under which conditions?'});
  const falsifier=node('textarea',{id:'moonshot-falsifier',maxlength:'1000',rows:'3',placeholder:'What observable result would count against the hypothesis?'});
  const evidence=node('textarea',{id:'moonshot-evidence',maxlength:'1000',rows:'3',placeholder:'What source, artifact, measurement, or independent observation is needed?'});
  const source=node('select',{id:'moonshot-source'});
  source.append(node('option',{value:'',text:'Standalone question — no artifact linked'}));
  for(const creation of (Array.isArray(world.creations)?world.creations:[])){
    source.append(node('option',{value:creation.id,text:creation.title+' · current v'+creation.version}));
  }
  const sourceVersion=node('select',{id:'moonshot-source-version'});
  const syncSourceVersions=()=>{
    sourceVersion.replaceChildren();
    const creation=(Array.isArray(world.creations)?world.creations:[]).find(item=>item.id===source.value);
    if(!creation){
      sourceVersion.append(node('option',{value:'',text:'No source version'}));
      sourceVersion.disabled=true;
      return;
    }
    const versions=[...(Array.isArray(creation.versions)?creation.versions:[]),creation]
      .filter(version=>Number.isInteger(version.version))
      .sort((left,right)=>left.version-right.version);
    for(const version of versions){
      sourceVersion.append(node('option',{value:String(version.version),text:(version.version===creation.version?'Current':'Retained')+' version '+version.version}));
    }
    sourceVersion.value=String(creation.version);
    sourceVersion.disabled=false;
  };
  source.onchange=syncSourceVersions;
  syncSourceVersions();
  const submit=node('button',{id:'propose-moonshot',class:'primary-button',type:'submit',text:'Retain moonshot proposal'});
  form.append(
    field('Proposal title','moonshot-title',title),
    field('Hypothesis','moonshot-hypothesis',hypothesis),
    field('Falsification condition','moonshot-falsifier',falsifier),
    field('Evidence required','moonshot-evidence',evidence),
    field('Optional source artifact','moonshot-source',source),
    field('Source version','moonshot-source-version',sourceVersion),
    paragraph('A proposal is not an experiment result. Failed, refuted, or contradictory evidence must be recorded separately; no outcome is inferred here.','form-help'),
    node('div',{class:'button-row'},[submit])
  );
  content.append(form);
  form.onsubmit=guarded(async event=>{
    event.preventDefault();
    submit.disabled=true;
    try{
      const selected=(Array.isArray(world.creations)?world.creations:[]).find(creation=>creation.id===source.value);
      await act({
        type:'propose-moonshot',
        title:title.value.trim(),
        hypothesis:hypothesis.value.trim(),
        falsifier:falsifier.value.trim(),
        evidenceNeeded:evidence.value.trim(),
        sourceCreationId:selected?.id??null,
        sourceVersion:selected?Number(sourceVersion.value):null
      });
      toast('Moonshot proposal retained · not executed · no XP awarded.');
      openMoonshotField();
    }finally{submit.disabled=false;}
  });
  const proposals=(Array.isArray(world.events)?world.events:[]).filter(event=>event?.type==='moonshot-proposed');
  if(!proposals.length)content.append(paragraph('No moonshot proposals are retained yet. Your first objective is to make one falsifiable and name the evidence that could resolve it.','empty-note'));
  let focusedProposal=null,focusedActivity=null;
  for(const proposal of [...proposals].reverse()){
    const card=node('article',{class:'field-card moonshot-card'+(proposal.moonshotId===focusMoonshotId?' is-selected':''),'data-moonshot-id':proposal.moonshotId,tabindex:'-1'},[
      node('h3',{text:proposal.title||'Untitled moonshot proposal'}),
      node('span',{class:'pill',text:'PROPOSED · NOT EXECUTED'}),
      paragraph('Hypothesis: '+proposal.hypothesis),
      paragraph('Falsification condition: '+proposal.falsifier),
      paragraph('Evidence required: '+proposal.evidenceNeeded),
      paragraph('Submitted by '+(proposal.actor?.name||proposal.actor?.id||'unknown actor')+' · '+(proposal.at||'time unavailable'),'form-help')
    ]);
    const sourceExists=proposal.sourceCreationId&&Number.isInteger(proposal.sourceVersion)&&
      (Array.isArray(world.creations)?world.creations:[]).some(creation=>creation.id===proposal.sourceCreationId&&
        (creation.version===proposal.sourceVersion||(Array.isArray(creation.versions)&&creation.versions.some(version=>version.version===proposal.sourceVersion))));
    if(sourceExists)card.append(button('Inspect linked source v'+proposal.sourceVersion+' →',()=>openCreation(proposal.sourceCreationId,proposal.sourceVersion),{class:'list-button'}));
    else if(proposal.sourceCreationId)card.append(paragraph('Linked source version is unavailable in this snapshot; the proposal remains visible without an invented target.','evidence-warning'));
    card.append(button('Record an experiment attempt →',()=>openExperimentReport(proposal),{class:'list-button'}));
    const reports=(Array.isArray(world.events)?world.events:[]).filter(event=>event?.type==='experiment-reported'&&event.moonshotId===proposal.moonshotId);
    for(const report of reports){
      const reportCard=node('div',{class:'field-card','data-research-activity-id':report.reportId,tabindex:'-1'},[
        node('h4',{text:'Experiment report'}),
        node('span',{class:'pill',text:'SELF-REPORTED · NOT ADJUDICATED'}),
        paragraph('Procedure: '+(report.procedure||'not recorded')),
        paragraph('Observation: '+(report.observation||'not recorded')),
        paragraph('Reported outcome: '+(report.reportedOutcome||'not supplied')),
        paragraph('Submitted by '+(report.actor?.name||report.actor?.id||'unknown actor')+' · '+(report.at||'time unavailable'),'form-help')
      ]);
      if(report.reportId===focusActivityId)focusedActivity=reportCard;
      const evidenceCreation=(Array.isArray(world.creations)?world.creations:[]).find(creation=>creation.id===report.evidenceCreationId);
      const evidenceExists=evidenceCreation&&Number.isInteger(report.evidenceVersion)&&
        (evidenceCreation.version===report.evidenceVersion||(Array.isArray(evidenceCreation.versions)&&evidenceCreation.versions.some(version=>version.version===report.evidenceVersion)));
      if(evidenceExists)reportCard.append(button('Inspect retained evidence v'+report.evidenceVersion+' →',()=>openCreation(report.evidenceCreationId,report.evidenceVersion),{class:'list-button'}));
      else {
        if(report.evidenceCreationId)reportCard.append(paragraph('The linked evidence version is unavailable in this snapshot.','evidence-warning'));
        else reportCard.append(paragraph('No retained artifact is linked; this report remains self-reported.','evidence-warning'));
        if(report.actor?.id===viewer.id&&report.actor?.role===viewer.role){
          if((Array.isArray(world.creations)?world.creations:[]).some(creation=>creation&&typeof creation.id==='string'&&creation.id)){
            reportCard.append(paragraph('Reports are append-only. A follow-up creates a new attempt; this record stays unchanged.','form-help'));
            reportCard.append(button('Record a linked follow-up attempt →',()=>openExperimentReport(proposal),{class:'list-button'}));
          }else{
            reportCard.append(paragraph('No published artifact is available yet. Preserve one before recording a linked follow-up attempt.','form-help'));
            reportCard.append(button('Build a source observatory →',()=>openWorkshop('observatory'),{class:'list-button'}));
          }
        }
      }
      const challenges=(Array.isArray(world.events)?world.events:[]).filter(event=>event?.type==='experiment-challenged'&&event.reportId===report.reportId);
      for(const challenge of challenges){
        const challengeCard=node('div',{class:'field-card','data-research-activity-id':challenge.challengeId,tabindex:'-1'},[
          node('h4',{text:'Retained challenge'}),
          node('span',{class:'pill',text:'DISSENT · NOT ADJUDICATED'}),
          paragraph('Challenge category: '+String(challenge.challengeType||'other').replaceAll('-',' ')),
          paragraph('Counterargument: '+(challenge.challengeText||'not recorded')),
          paragraph('Submitted by '+(challenge.actor?.name||challenge.actor?.id||'unknown actor')+' · '+(challenge.at||'time unavailable'),'form-help')
        ]);
        if(challenge.challengeId===focusActivityId)focusedActivity=challengeCard;
        if(challenge.evidenceCreationId){
          const evidenceExists=(Array.isArray(world.creations)?world.creations:[]).some(creation=>creation.id===challenge.evidenceCreationId&&(creation.version===challenge.evidenceVersion||(Array.isArray(creation.versions)&&creation.versions.some(version=>version.version===challenge.evidenceVersion))));
          if(evidenceExists)challengeCard.append(button('Inspect challenge evidence v'+challenge.evidenceVersion+' →',()=>openCreation(challenge.evidenceCreationId,challenge.evidenceVersion),{class:'list-button'}));
          else challengeCard.append(paragraph('The linked challenge-evidence version is unavailable in this snapshot.','evidence-warning'));
        }else challengeCard.append(paragraph('No retained artifact is linked to this challenge.','evidence-warning'));
        reportCard.append(challengeCard);
      }
      if(!sameResearchActor(report.actor,viewer))reportCard.append(button('Challenge this report →',()=>openExperimentChallenge(report),{class:'list-button'}));
      card.append(reportCard);
    }
    content.append(card);
    if(proposal.moonshotId===focusMoonshotId)focusedProposal=card;
  }
  const focusTarget=focusedActivity||focusedProposal;if(focusTarget){focusTarget.scrollIntoView({block:'nearest'});focusTarget.focus({preventScroll:true});}
  if(viewer.role==='founder'&&!(Array.isArray(world.creations)?world.creations:[]).some(creation=>creation.kind==='observatory')){
    content.append(button('Build a source observatory →',()=>openWorkshop('observatory'),{class:'list-button'}));
  }
}
function openPublicationHouse(kindFilter=null){
  const content=showSheet('Publication House','PUBLISHED ARTIFACTS · PRESERVED VERSIONS');
  content.append(paragraph('Only retained published artifacts appear here. Publication means a version was preserved by this service; it is not a truth verdict.'));
  const works=[...world.creations].filter(creation=>!kindFilter||creation.kind===kindFilter).reverse();
  if(!works.length)content.append(paragraph(kindFilter?'No published '+kindFilter+' artifacts are present yet.':'No published artifacts are present yet.','empty-note'));
  for(const creation of works)content.append(button(creation.title+' · '+creation.kind+' · v'+creation.version,()=>openCreation(creation.id,creation.version),{class:'list-button'}));
}
function openJournal(){const content=showSheet('Keep the trail.','THE FIELD JOURNAL');content.append(paragraph(mode==='shared'?`Shared world · ${viewer.role==='founder'?'authenticated Founder':'Witness'} · ${viewer.name}`:'Private world · this device · local saves and backup'),node('div',{class:'journal-summary'},[node('span',{},[node('strong',{text:world.creations.length}),node('small',{text:'PLACES MADE'})]),node('span',{},[node('strong',{text:world.xp}),node('small',{text:'WORLD XP'})]),node('span',{},[node('strong',{text:world.methods.length}),node('small',{text:'METHODS EARNED'})])]),paragraph('Every accepted published version adds 100 WORLD XP to this institution-wide total. Character XP is derived separately from unique Founder publication events matched to retained versions. Neither total proves external truth, competence, provider execution or authority.','form-help'));
  if(world.drafts.length&&viewer.role==='founder'){content.append(node('h3',{class:'section-title',text:'PRIVATE DRAFTS'}));for(const d of world.drafts)content.append(button(d.title+` · draft v${d.version} →`,()=>openWorkshop(d.kind,d.id),{class:'list-button'}));}
  let pendingAction=null;try{pendingAction=readPendingSharedAction()}catch(error){content.append(node('h3',{class:'section-title',text:'SHARED ACTION RECOVERY'}),paragraph(error.message,'evidence-warning'))}if(pendingAction){content.append(node('h3',{class:'section-title',text:'SHARED ACTION RECOVERY'}),paragraph('A shared write may have committed even if its response was lost. The request ID and exact action are saved on this device; retrying reuses that ID so the server can return the original result without creating a duplicate.','form-help'),node('article',{class:'field-card'},[node('h3',{text:'Pending action · '+pendingAction.action.type.toUpperCase()}),paragraph('Request ID · '+pendingAction.requestId),paragraph('Original actor · '+pendingAction.actorId+' ('+pendingAction.actorRole+')')]));if(mode==='shared'&&pendingAction.actorId===viewer.id&&pendingAction.actorRole===viewer.role)content.append(button('Retry the exact pending action safely',guarded(async()=>{const result=await submitPendingSharedAction(pendingAction);closeSheet();toast('Shared action outcome recovered. The same request ID was reused; no duplicate was created.') }),{class:'primary-button',id:'retry-pending-shared-action'}));else content.append(paragraph('This session does not match the original actor. The action will not be replayed under a different identity or role.','evidence-warning'))}  content.append(node('h3',{class:'section-title',text:'YOUR DISCOVERIES'}));const discoveries=world.discoveries.filter(d=>d.actor.id===viewer.id);if(!discoveries.length)content.append(paragraph('Four authored field notes wait across the grounds.','empty-note'));for(const d of discoveries)content.append(button(guides[d.locationId].name+' →',()=>openGuide(d.locationId),{class:'list-button'}));
  content.append(node('h3',{class:'section-title',text:'METHODS EARNED BY REPAIR'}));if(!world.methods.length)content.append(paragraph('Publish a checked second version and preserve the first to earn a game method.','empty-note'));for(const method of world.methods)content.append(node('article',{class:'field-card'},[node('h3',{text:method.title}),paragraph(method.description),paragraph('An earned game practice, not a claim of external validation.','attribution')]));
  content.append(node('h3',{class:'section-title',text:'PRESERVE YOUR WORLD'}),paragraph(mode==='private'?'A successful save retains the previous copy as a backup. Private exports include drafts and the character’s last map position. Imports validate both the world and any included position, then replace only your private world.':'Shared exports are filtered to your current role. Imports can only open a private world; they never grant shared authority.','form-help'));
  const file=node('input',{id:'import-world',type:'file',accept:'.json,application/json'});file.onchange=guarded(async()=>{if(!file.files[0])return;if(file.files[0].size>32*1024*1024)throw new Error('World import exceeds 32 MiB.');const raw=JSON.parse(await file.files[0].text());const imported=await validateWorld(raw.world||raw);const playerPosition=raw?.schema==='ngl.private-save.v1'?raw.playerPosition:{x:180,y:640};const previousPosition=readPrivatePlayerPosition()||{x:180,y:640};if(!isPortablePosition(playerPosition)||!writePrivatePlayerPosition(playerPosition))throw new Error('The save has an invalid character position or this device cannot store it. The world was not imported.');try{persist(imported,previousPosition)}catch(error){writePrivatePlayerPosition(previousPosition);throw error}stream?.close();stream=null;mode='private';viewer=privateActor();world=imported;view.setPlayer({id:viewer.id,...playerPosition});presence=[];selectedDraft=null;closeSheet();render();toast('Verified world and character position imported privately. Shared authority was not changed.');});content.append(node('div',{class:'button-row'},[button('↓ Export world JSON',guarded(async()=>{const player=view.getPlayer();const dto=mode==='shared'?await request('/api/export'):{schema:'ngl.private-save.v1',world,playerPosition:{x:player.x,y:player.y}};download('no-gas-labs-world.json',JSON.stringify(mode==='shared'?(dto.world||dto):dto,null,2),'application/json');toast('World export prepared with your current role’s visibility.')}),{id:'export-world',class:'secondary-button'})]),field('Import a saved world · opens privately','import-world',file));
  if(mode==='private')content.append(node('div',{class:'button-row'},[button('Recover previous local backup',guarded(async()=>{const raw=JSON.parse(localStorage.getItem(BACKUP));if(!raw)throw new Error('There is no saved backup yet.');const backupEnvelope=raw?.schema===BACKUP_SCHEMA;const recovered=await validateWorld(backupEnvelope?raw.world:raw);const recoveredPosition=backupEnvelope?raw.playerPosition:{x:180,y:640};const previousPosition=readPrivatePlayerPosition()||{x:180,y:640};if(!isPortablePosition(recoveredPosition)||!writePrivatePlayerPosition(recoveredPosition))throw new Error('The backup character position could not be restored. The current world was not changed.');try{persist(recovered,previousPosition)}catch(error){writePrivatePlayerPosition(previousPosition);throw error}world=recovered;view.setPlayer({id:viewer.id,...recoveredPosition});render();openJournal();toast('Recovered the previous private world and character position. The current save is now the backup.')}),{id:'recover-backup',class:'secondary-button'})]));
  content.append(button('Projects, evidence and Founder Gate →',guarded(openInstitution),{id:'institution-projects',class:'list-button'}));
  if(institution){const details=node('details',{class:'institution-details'},[node('summary',{text:'Actual institutional instruments · kernel / courier / Forge'}),paragraph('Read-only capability evidence reported by the local service. This does not turn world XP into canonical authority.','form-help'),node('pre',{text:JSON.stringify(institution,null,2)})]);content.append(node('h3',{class:'section-title',text:'INSTITUTIONAL INSTRUMENTS'}),details)}
  content.append(node('h3',{class:'section-title',text:'CHANGE YOUR VIEW'}),node('div',{class:'button-row'},[button(mode==='shared'?'Open private world':'Enter shared world',guarded(async()=>{closeSheet();if(mode==='shared')await startPrivate();else await startShared()}),{class:'secondary-button'})]));
}
function openLogin(){const content=showSheet('Founder access.','SHARED WORLD · AUTHENTICATED SESSION');content.append(paragraph('Use the Founder key configured for this local service. It stays out of world exports and is never saved by this client.'));const key=node('input',{id:'founder-key',type:'password',autocomplete:'off',placeholder:'Local Founder key'});const name=node('input',{id:'founder-name',value:'Damien',maxlength:'80',autocomplete:'nickname'});const form=node('form',{},[field('Founder name','founder-name',name),field('Founder key','founder-key',key),node('div',{class:'button-row'},[node('button',{id:'verify-founder',type:'submit',class:'primary-button',text:'Verify Founder access'})])]);form.onsubmit=guarded(async e=>{e.preventDefault();const dto=await request('/api/login',{key:key.value,name:name.value});key.value='';if(mode!=='shared'){mode='shared';$('doorway').hidden=true;$('play-ui').hidden=false;}acceptState(dto);closeSheet();await startShared();toast('Founder session verified by the local service.');});content.append(form,paragraph('Opening a private save or changing browser data cannot authorize shared publication.','form-help'));key.focus({preventScroll:true});}
async function launch(){if(busy)return;busy=true;const launchButton=$('caveman-launch');launchButton.disabled=true;try{if(!mode)await startPrivate();if(!requireFounder())return;const content=showSheet('Making the stage.','CAVEMAN LAUNCHPAD · LOCAL REHEARSAL');content.append(paragraph('Preparing real playable creations and checking the public exhibition bytes. This can take a moment for the recovered artwork.','status-line'));
    if(!world.creations.length){for(const kind of ['comic','loom','observatory']){const r=recipes[kind];content.append(paragraph(`Making ${r.title}…`,'form-help'));const drafted=await act({type:'draft',kind,title:r.title,intent:r.intent});await act({type:'publish',draftId:drafted.draftId,expectedVersion:0});}}
    launchReport=mode==='shared'?await request('/api/launch',{}):await rehearseLaunch(world,{title:'A world worth making.',tagline:'A small local exhibition from No_Gas_Labs™.'});launchReport=launchReport.report||launchReport;launchHTML=makeLaunchPage(world,launchReport);showLaunchReport();openStage();toast(`${launchReport.checks.filter(c=>c.passed).length}/${launchReport.checks.length} actual rehearsal checks passed. No external posting occurred.`);
  }finally{busy=false;launchButton.disabled=false}}
function announcement(){return launchReport?.announcement||`I made a small playable No_Gas_Labs exhibition with ${world.creations.length} published creation${world.creations.length===1?'':'s'}. The local launch rehearsal passed ${launchReport.checks.filter(c=>c.passed).length}/${launchReport.checks.length} checks. It is a local artifact ready to share by choice; no live AI execution, public deployment, demand or revenue is claimed.`;}
function showLaunchReport(){const content=showSheet(launchReport.ready?'The stage is ready.':'A stage worth checking.','CAVEMAN LAUNCHPAD · REHEARSAL');content.append(paragraph(`${launchReport.artifactCount} real published creations. ${launchReport.checks.filter(c=>c.passed).length}/${launchReport.checks.length} checks passed. No external posting has occurred.`),node('ul',{class:'check-list'},launchReport.checks.map(check=>node('li',{class:check.passed?'':'failed'},[node('span',{class:'check-symbol',text:check.passed?'✓':'!'}),node('span',{},[node('span',{text:check.label}),node('small',{text:typeof check.detail==='string'?check.detail:JSON.stringify(check.detail??'')})])]))),node('div',{class:'button-row'},[button('Open the exhibition ↗',openStage,{id:'open-stage',class:'primary-button'}),button('↓ Download stage HTML',()=>download('no-gas-labs-exhibition.html',launchHTML),{id:'download-launch',class:'secondary-button'})]));const copy=node('textarea',{id:'launch-announcement',class:'announcement',readonly:'',rows:'6',value:announcement()});content.append(field('A fact-based announcement · copy and share by choice','launch-announcement',copy),node('div',{class:'button-row'},[button('Copy announcement',guarded(async()=>{try{await navigator.clipboard.writeText(copy.value);toast('Announcement copied. No message was posted.')}catch{copy.focus();copy.select();toast('Announcement selected. Use your device’s Copy action.')}}),{id:'copy-announcement',class:'secondary-button'})]));for(const limitation of launchReport.limitations||[])content.append(paragraph(limitation,'launch-claim'));}
function openStage(){openPortal({title:'Your local exhibition.',html:launchHTML,stage:true,kicker:'CAVEMAN LAUNCHPAD · REHEARSAL STAGE',footer:[paragraph(`${launchReport.artifactCount} playable creations · checked local artifact · you choose when and where to share.`),button('↓ Download stage',()=>download('no-gas-labs-exhibition.html',launchHTML),{id:'download-stage',class:'primary-button'}),button('View actual checks',()=>{closePortal();showLaunchReport()},{class:'secondary-button'})]})}

$('start-private').onclick=guarded(startPrivate);$('start-shared').onclick=guarded(startShared);$('caveman-launch').onclick=guarded(launch);$('launch-shortcut').onclick=guarded(launch);$('make-button').onclick=()=>openWorkshop();$('places-button').onclick=openPlaces;$('journal-button').onclick=openJournal;$('home-button').onclick=e=>{e.preventDefault();if(mode)openJournal()};$('quest-button').onclick=()=>{const quest=getActiveQuest(world,viewer);if(quest.nextAction){followQuestAction(quest.nextAction);return}if(quest.action==='trail'){$('quest-trail')?.scrollIntoView({behavior:'smooth',block:'nearest'});return}if(quest.action==='workbench')view.goTo('workbench');else openPlaces()};$('character-button').onclick=openCharacterSheet;$('interact-button').onclick=()=>view.interact();$('sheet-close').onclick=closeSheet;$('sheet-backdrop').onclick=closeSheet;$('portal-close').onclick=closePortal;$('login-button').onclick=openLogin;$('logout-button').onclick=guarded(async()=>{const dto=await request('/api/logout',{});closePortal();closeSheet();selectedDraft=null;acceptState(dto);await startShared();toast('Logged out. The shared world is now shown as Witness.');});
for(const pad of document.querySelectorAll('#movement-pad button')){const stop=()=>view.setInput({x:0,y:0});pad.addEventListener('pointerdown',e=>{e.preventDefault();pad.setPointerCapture(e.pointerId);view.setInput({x:Number(pad.dataset.dx||0),y:Number(pad.dataset.dy||0)})});pad.addEventListener('pointerup',stop);pad.addEventListener('pointercancel',stop);pad.addEventListener('lostpointercapture',stop)}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('portal').hidden){e.preventDefault();closePortal()}else if(!$('sheet').hidden){e.preventDefault();closeSheet()}}if(e.key==='Tab'&&document.body.classList.contains('modal-open')){const modal=!$('portal').hidden?$('portal'):$('sheet');const elements=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],iframe,[tabindex="0"]')].filter(el=>!el.hidden&&el.getClientRects().length);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}});
addEventListener('pagehide',()=>{if(mode==='private')writePrivatePlayerPosition(view.getPlayer());stream?.close()});
