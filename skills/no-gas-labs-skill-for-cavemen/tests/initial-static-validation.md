# Cavemen Skill — Initial Static Validation

Date: 2026-10-22

## Artifacts

- Skill: ../SKILL.md
- Baseline scenarios: baseline-scenarios.md

## Static checks

All checks below passed against the file fetched back from the repository after commit:

- YAML frontmatter delimiters are present.
- Machine-readable skill name contains only lowercase letters, numbers, and hyphens.
- Description begins with “Use when”.
- The invariant requires a picture book as the successful output.
- The production loop includes understand, translate, produce, inspect, and deliver-or-recover.
- Evidence classifications include verified observation, source-stated claim, inference, fiction/dramatization, and unknown/disputed.
- External publisher branding and fictional cover lockup are distinct and use the canonical wording.
- Partial work cannot be mislabeled as a finished book.
- The skill contains no Universal Superpowers Workflow dependency.
- Six pressure scenarios are recorded in the baseline file.

## What this does and does not establish

**Established:** the skill file exists on the repository's main branch and the static checks above passed against the fetched file.

**Not established:** successful behavioral testing, independent-agent pressure testing, actual picture-book production quality, installation into a runtime skill directory, or market validation.

The baseline file records failures already observed in the creation conversation. The six scenarios are specified for reruns; they have not been executed as independent-agent tests. Do not report them as passed.
