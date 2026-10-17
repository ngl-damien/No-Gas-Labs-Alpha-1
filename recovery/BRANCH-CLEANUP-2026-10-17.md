# Branch cleanup manifest — 2026-10-17

Source: GitHub REST branches inventory, 224 refs across three pages.

Baseline main commit: `facee282ae0c0a56031e7bf00a038eac3ebe4926`.

These 80 branches pointed to **exactly that same commit** when inventoried; consequently they had no distinct commit at that time. The cleanup workflow must check each live SHA again immediately before deletion, skip protected branches and open PR heads, and report its actual outcomes. No unique-content branches are candidates.

To restore any deleted branch at its original commit: `git push origin facee282ae0c0a56031e7bf00a038eac3ebe4926:refs/heads/<branch-name>` (requires authorization).

- `experiment/ngl-102-replayledger`
- `experiment/ngl-104-testcustody`
- `experiment/ngl-107-graphescrow`
- `experiment/ngl-110-mcp-custody`
- `experiment/ngl-113-meterwitness`
- `experiment/ngl-115-runbound`
- `experiment/ngl-116-allocatewitness`
- `experiment/ngl-118-afteraccess`
- `experiment/ngl-120-authgraph`
- `experiment/ngl-121-sunsetradius`
- `experiment/ngl-124-claimtrace`
- `experiment/ngl-129-branchwitness`
- `experiment/ngl-135-escalationbound`
- `experiment/ngl-137-addendumwitness`
- `experiment/ngl-138-promisefrontier`
- `experiment/ngl-139-clockwitness`
- `experiment/ngl-141-meterfrontier`
- `experiment/ngl-147-detentionfrontier`
- `experiment/ngl-147-restorewitness`
- `experiment/ngl-148-coveragepatch`
- `experiment/ngl-149-handoffwitness`
- `experiment/ngl-150-revokewitness`
- `experiment/ngl-153-stringbudget`
- `experiment/ngl-154-jsonveil`
- `experiment/ngl-155-splitbound`
- `experiment/ngl-161-consentseam`
- `experiment/ngl-162-ratecustody`
- `experiment/ngl-163-refundseam`
- `experiment/ngl-164-dimwitness`
- `experiment/ngl-165-exportwitness`
- `experiment/ngl-166-clockcustody`
- `experiment/ngl-170-replayproof`
- `experiment/ngl-174-eventfate`
- `experiment/ngl-179-clockcustody`
- `experiment/ngl-181-optseam`
- `experiment/ngl-190-payeechain`
- `experiment/ngl-191-marginwake`
- `experiment/ngl-193-seatcustody`
- `experiment/ngl-198-driftwitness`
- `experiment/ngl-199-eventcustody`
- `experiment/ngl-208-rightsfrontier`
- `experiment/ngl-210-returnfrontier`
- `experiment/ngl-211-eventwitness`
- `experiment/ngl-215-riskfrontier`
- `experiment/ngl-217-maskchain`
- `experiment/ngl-218-proofgap`
- `experiment/ngl-221-domainfence`
- `experiment/ngl-225-splitwitness`
- `experiment/ngl-226-depotfence`
- `experiment/ngl-230-allocfence`
- `experiment/ngl-233-bidfence`
- `experiment/ngl-238-buyerwitness`
- `experiment/ngl-247-storagefork`
- `experiment/ngl-248-camfork`
- `experiment/ngl-249-rankseam`
- `experiment/ngl-253-importseam`
- `experiment/ngl-256-lotfrontier`
- `experiment/ngl-259-matchbound`
- `experiment/ngl-260-resiliencefork`
- `experiment/ngl-263-peakshadow`
- `experiment/ngl-266-slipfork`
- `experiment/ngl-268-specwake`
- `experiment/ngl-269-mixshift`
- `experiment/ngl-274-balancecut`
- `experiment/ngl-274-kitfrontier`
- `experiment/ngl-277-ruajury`
- `experiment/ngl-278-typefork`
- `experiment/ngl-280-keyjury`
- `experiment/ngl-286-pairforge`
- `experiment/ngl-288-wireseam`
- `experiment/ngl-289-keyfork`
- `experiment/ngl-292-ttlbridge`
- `experiment/ngl-294-erasurecut`
- `experiment/ngl-295-cookiepath`
- `experiment/ngl-296-meterwitness`
- `experiment/ngl-298-fanoutwitness`
- `experiment/ngl-300-linkjury`
- `experiment/ngl-301-stockrace`
- `research/commission-006-signature-bridge`
- `security/commission-005-forged-consequence`
