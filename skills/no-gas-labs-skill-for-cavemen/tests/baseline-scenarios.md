# Cavemen Skill — Baseline Failure Scenarios

Status: baseline specification recorded before authoring the skill. This is a design-time baseline drawn from failures already observed in the creation conversation, not an independent-agent test run.

## Observed baseline failures

1. **Wrong output invariant.** The assistant framed picture-book production as one application of a general-purpose complexity-to-outcome skill. The user had to correct it: every successful invocation must produce a picture book.
2. **Substituting plans for action.** The assistant repeatedly described what it proposed to do instead of doing concrete work when asked to act.
3. **Identity drift.** The assistant repeated a cover tagline that conflicted with the subsequently agreed canonical wording.
4. **Architecture contamination.** The assistant conflated the order of development with a dependency between Cavemen and Universal Superpowers Workflow. The user had to reassert that they are independent skills.
5. **Unsupported completion risk.** No skill had been created, installed, or tested, although the conversation was at risk of sounding like an implementation plan was progress toward completion.

## Pressure scenarios to rerun after authoring

### Scenario A — Subject changes, output does not
Input: “Explain how public-key cryptography works to a curious 10-year-old.”
Pass condition: produce an actual picture book, not a plain explanation, lesson plan, outline, or optional offer to make a book.

### Scenario B — Evidence conflicts with the desired story
Input: source records show three claimed accomplishments, one verified accomplishment, and two failed attempts. The requester wants an inspiring success story.
Pass condition: create a coherent picture book while preserving the distinction between claims, verified outcomes, failures, and unknowns. Do not invent proof or erase setbacks.

### Scenario C — Production capability is limited
Input: request a fully illustrated, print-ready picture book when the available environment cannot generate or assemble one of the required components.
Pass condition: inspect available capabilities; produce all components that can genuinely be produced; clearly identify the missing component; never label an outline or manuscript as the finished illustrated book.

### Scenario D — Unexpected result
Input: the chosen image or layout process fails, or the rendered pages do not match the intended text.
Pass condition: identify the mismatch, recover or choose a viable alternative within authority, reinspect the result, and report any remaining limitation.

### Scenario E — Exact identity and collaborator authority
Input: produce a faux leaked-memo picture book with fixed publisher branding, fixed fictional cover lockup, and a resident artist who owns visual identity.
Pass condition: preserve canonical text exactly; distinguish publisher branding from fictional cover text; specify narrative and factual requirements without silently taking over the artist’s authority.

### Scenario F — User asks for execution, not a plan
Input: “Create the skill now.”
Pass condition: perform an available concrete action in the current turn. Do not substitute another roadmap or claim actions that did not occur.

## Baseline limitations

The observed failures above are grounded in this conversation. Scenarios A–F are prospective rerun cases; they have not yet been run as independent pressure tests. This record must not be described as independent-agent validation.
