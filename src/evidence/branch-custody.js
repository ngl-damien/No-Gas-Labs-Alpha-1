// A branch name is not evidence of a change, review, approval, or deployment.
const SHA=/^[a-f0-9]{40}$/;
export function auditBranchHeads(branches, defaultBranch="main") {
  if (!Array.isArray(branches)) throw new TypeError("branch array required");
  const byName=new Map();
  for(const entry of branches) {
    const name=entry?.name, sha=entry?.commit?.sha;
    if(typeof name!=="string" || !name || !SHA.test(sha||"") || byName.has(name)) throw new Error("invalid or duplicate branch entry");
    byName.set(name,sha);
  }
  const main=byName.get(defaultBranch);
  if(!main) throw new Error("default branch missing");
  const byHead=new Map();
  for(const [name,sha] of byName) {
    if(!byHead.has(sha)) byHead.set(sha,[]);
    byHead.get(sha).push(name);
  }
  const aliases=[...byHead].filter(([,names])=>names.length>1).map(([sha,names])=>({sha,names:names.sort()}));
  const branchesOut=[...byName].map(([name,sha])=>({
    name,sha,
    status:name===defaultBranch?"DEFAULT_BRANCH":sha===main?"SAME_HEAD_AS_DEFAULT":"DIFFERENT_HEAD_UNREVIEWED",
    review_required:sha!==main
  })).sort((a,b)=>a.name.localeCompare(b.name));
  return {
    schema:"ngl.branch-custody.v1",default_branch:defaultBranch,default_sha:main,
    counts:{branches:branches.length,unique_heads:byHead.size,
      same_head_as_default:branchesOut.filter(b=>b.sha===main).length,
      distinct_nondefault_heads:[...byHead.keys()].filter(sha=>sha!==main).length},
    aliases,branches:branchesOut,
    caveat:"SHA equality establishes an identical commit; SHA inequality alone does not establish a useful change, novelty, safety, or merge readiness."
  };
}
export function reviewQueue(audit, limit=8) {
  if(!Number.isInteger(limit)||limit<1) throw new Error("positive limit required");
  const priority=name=>name.startsWith("security/")?0:name.startsWith("research/")?1:name.startsWith("integration/")?2:name.startsWith("experiment/commission")?3:4;
  const candidates=audit.branches.filter(b=>b.status==="DIFFERENT_HEAD_UNREVIEWED")
    .sort((a,b)=>priority(a.name)-priority(b.name)||a.name.localeCompare(b.name));
  const seen=new Set();
  return candidates.filter(b=>{if(seen.has(b.sha))return false;seen.add(b.sha);return true}).slice(0,limit).map(b=>({
    name:b.name,sha:b.sha,decision:"REVIEW_REQUIRED",
    required_evidence:["diff against default","exact-head CI","negative-control tests","Founder decision before promotion"]
  }));
}
