'use strict';
// Experiment 001 reference gate. HMAC is for a single trusted issuer boundary only.
// Not an identity, consent, or multi-party signature solution.
const { createHmac, timingSafeEqual } = require('node:crypto');
const ACTIONS = new Set(['AWARD_XP','SET_QUEST_STATUS','REVOKE_GRANT','RECORD_LOCATION']);
function canonical(x) {
  if (Array.isArray(x)) return '['+x.map(canonical).join(',')+']';
  if (x && typeof x === 'object') return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
  return JSON.stringify(x);
}
function sign(key, body) { return createHmac('sha256',key).update(canonical(body)).digest('hex'); }
function verify(key, body, mac) {
  if (typeof mac !== 'string' || !/^[a-f0-9]{64}$/.test(mac)) return false;
  return timingSafeEqual(Buffer.from(sign(key,body),'hex'),Buffer.from(mac,'hex'));
}
function gate({issuerKey, grants, now=()=>Date.now()}) {
  if (!issuerKey || !grants) throw Error('issuerKey and grants required');
  const seen=new Set(), revoked=new Set();
  function accept(event) {
    if (!event || typeof event!=='object' || !ACTIONS.has(event.action)) return {ok:false,reason:'UNKNOWN_ACTION'};
    if (typeof event.id!=='string' || !event.id || seen.has(event.id)) return {ok:false,reason:'REPLAY_OR_BAD_ID'};
    const {mac,...body}=event;
    if (!verify(issuerKey,body,mac)) return {ok:false,reason:'INVALID_SIGNATURE'};
    const grant=grants[event.grantId];
    if (!grant || revoked.has(event.grantId) || grant.subject!==event.actor ||
        !Array.isArray(grant.scopes) || !grant.scopes.includes(event.action) ||
        !Number.isFinite(grant.expiresAt) || now()>=grant.expiresAt)
      return {ok:false,reason:'NOT_AUTHORIZED'};
    if (event.action==='AWARD_XP' && (!Number.isSafeInteger(event.xp) || event.xp<0 || event.xp>grant.maxXp))
      return {ok:false,reason:'REWARD_OUT_OF_SCOPE'};
    if (event.action==='SET_QUEST_STATUS' && !['PROPOSED','COMPLETED','FAILED','REJECTED'].includes(event.status))
      return {ok:false,reason:'INVALID_STATUS'};
    if (event.action==='RECORD_LOCATION' &&
      (!Number.isFinite(event.lat)||Math.abs(event.lat)>90||!Number.isFinite(event.lon)||Math.abs(event.lon)>180||
       !event.consentReceipt || event.consentReceipt.subject!==event.actor ||
       event.consentReceipt.purpose!=='location' || !verify(issuerKey,
       {subject:event.consentReceipt.subject,purpose:event.consentReceipt.purpose,expiresAt:event.consentReceipt.expiresAt},
       event.consentReceipt.mac) || now()>=event.consentReceipt.expiresAt))
      return {ok:false,reason:'INVALID_LOCATION_OR_CONSENT_RECEIPT'};
    if (event.action==='REVOKE_GRANT' && (!event.targetGrantId || !grants[event.targetGrantId]))
      return {ok:false,reason:'INVALID_REVOCATION_TARGET'};
    // Mark accepted events only; rejected event IDs do not poison the replay ledger.
    seen.add(event.id);
    if (event.action==='REVOKE_GRANT') revoked.add(event.targetGrantId);
    return {ok:true,action:event.action,id:event.id};
  }
  return {accept};
}
module.exports={canonical,sign,verify,gate};
