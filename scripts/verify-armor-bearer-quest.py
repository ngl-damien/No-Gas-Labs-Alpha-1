"""Focused mobile acceptance for the Armor Bearer carry-forward quest.

Uses the existing walkable Quest Board, Forge, Field Kit, and transfer UI.
The shared Quest Board harness is imported read-only; no shared test file is edited.
All actors and source records are disposable pseudonymous browser fixtures.
"""
import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHARED_ACCEPTANCE = ROOT / "scripts" / "verify-quest-board.py"
SPEC = importlib.util.spec_from_file_location("ngl_shared_quest_board_acceptance", SHARED_ACCEPTANCE)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load the shared Quest Board acceptance helpers.")
quest = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = quest
SPEC.loader.exec_module(quest)


def start_shared_actor(page, url, role, page_errors):
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.goto(url, wait_until="networkidle")
    page.locator("#start-shared").tap()
    page.locator("#world").wait_for(state="visible")
    expect(page.locator("#world")).to_have_attribute("data-world-renderer", "pixel-v1")
    if role == "founder":
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Shared world')"
        )
        page.locator("#login-button").tap()
        page.locator("#founder-name").fill("Damien")
        page.locator("#founder-key").fill("fake-browser-fixture-key-not-a-secret")
        page.locator("#verify-founder").tap()
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )
    else:
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Witness')"
        )
    snapshot = quest.authoritative_snapshot(page)
    if snapshot["viewerRole"] != role:
        raise AssertionError("Expected " + role + " session, got " + json.dumps(snapshot))
    return snapshot


def resume_founder_session(page, url, expected_actor_id, page_errors):
    page.reload(wait_until="networkidle")
    start_button = page.locator("#start-shared")
    if start_button.is_visible():
        start_button.tap()
    page.locator("#world").wait_for(state="visible")
    page.wait_for_function("""() => {
      const label = document.querySelector('#mode-label')?.textContent || '';
      return label.includes('Shared world') || label.includes('Founder');
    }""")
    label = page.locator("#mode-label").inner_text()
    if "Founder" not in label:
        login = page.locator("#login-button")
        expect(login).to_be_visible()
        login.tap()
        page.locator("#founder-name").fill("Damien")
        page.locator("#founder-key").fill("fake-browser-fixture-key-not-a-secret")
        page.locator("#verify-founder").tap()
        page.wait_for_function(
            "() => document.querySelector('#mode-label')?.textContent.includes('Founder')"
        )
    snapshot = quest.authoritative_snapshot(page)
    if snapshot["viewerRole"] != "founder" or snapshot["viewerId"] != expected_actor_id:
        raise AssertionError(
            "Founder refresh changed the actor identity: " + json.dumps(snapshot)
        )
    return snapshot


def create_discovery_fixture(page):
    return page.evaluate("""async () => {
      const response = await fetch('/api/action', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'discover', locationId: 'river' })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(
        'Disposable discovery fixture failed (' + response.status + '): ' + JSON.stringify(payload)
      );
      const stateResponse = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!stateResponse.ok) throw new Error('Shared state read failed: ' + stateResponse.status);
      const dto = await stateResponse.json();
      const matches = dto.world.events.filter(event =>
        event.type === 'discover' &&
        event.locationId === 'river' &&
        event.actor?.id === dto.viewer?.id &&
        event.actor?.role === dto.viewer?.role &&
        event.repeat !== true
      );
      if (matches.length !== 1) throw new Error(
        'Expected one retained actor-owned River discovery, got ' + matches.length
      );
      return {
        eventId: matches[0].id,
        actorId: dto.viewer.id,
        actorRole: dto.viewer.role,
        revision: dto.world.revision,
        xp: dto.world.xp,
        fixtureOnly: true
      };
    }""")


def read_event(page, event_type, field_name, field_value):
    return page.evaluate("""expected => {
      return fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      }).then(async response => {
        if (!response.ok) throw new Error('Shared state read failed: ' + response.status);
        const dto = await response.json();
        const matches = dto.world.events.filter(event =>
          event.type === expected.type && event[expected.field] === expected.value
        );
        if (matches.length !== 1) throw new Error(
          'Expected one retained ' + expected.type + ' event, got ' + matches.length
        );
        return matches[0];
      });
    }""", {
        "type": event_type,
        "field": field_name,
        "value": field_value
    })


def close_sheet_if_open(page):
    sheet = page.locator("#sheet")
    if sheet.count() and not sheet.is_hidden():
        page.locator("#sheet-close").tap()
        expect(sheet).to_be_hidden()


def open_carry_objective_and_forge(page, role):
    close_sheet_if_open(page)
    quest.open_quest_board(page)
    objective = page.locator(
        '#sheet-content [data-objective-id="' + role + '-carry-field-item-forward"]'
    )
    expect(objective).to_have_count(1)
    expect(objective.locator(".quest-step-state")).to_have_text("OPEN")
    expect(objective).to_contain_text("0/1")
    expect(objective).to_contain_text("Carry a field item onward to another player")
    action = objective.get_by_role("button", name="Go do this →", exact=True)
    expect(action).to_be_visible()
    action.tap()

    page.wait_for_function("""() => {
      const sheet = document.querySelector('#sheet');
      const title = document.querySelector('#sheet-title')?.textContent;
      const world = document.querySelector('#world');
      return (!sheet?.hidden && title === 'Forge') ||
        (sheet?.hidden === true && world?.dataset.nearbyInstitutionId === 'forge');
    }""", timeout=45000)
    if page.locator("#sheet").is_hidden():
        quest.enter_nearby_institution(page, "forge", "Forge", "Forge", timeout=45000)
    expect(page.locator("#sheet-title")).to_have_text("Forge")
    expect(page.locator("[data-field-forge-root]")).to_have_count(1)
    expect(page.locator("[data-field-kit-root]")).to_have_count(1)
    return objective


def forge_equip_unequip_and_offer(page, source_event_id, witness_id, founder_id):
    source = page.locator('[data-forge-choice="scouting"]')
    expect(source).to_be_visible()
    source.select_option(value=source_event_id)
    page.locator('[data-forge-item="scouting"]').tap()

    item_card = page.locator("[data-field-item-id]")
    expect(item_card).to_have_count(1)
    item_id = item_card.get_attribute("data-field-item-id")
    if not item_id:
        raise AssertionError("Forge did not expose the retained item identity.")
    forge_event = read_event(page, "field-item-forged", "itemId", item_id)
    if forge_event.get("sourceEventId") != source_event_id:
        raise AssertionError("The forged item did not retain the exact discovery source.")
    if forge_event.get("actor", {}).get("id") != founder_id or \
            forge_event.get("actor", {}).get("role") != "founder":
        raise AssertionError("The forged item is not attributed to its creating Founder session.")

    page.locator('[data-equip-forged-item="' + item_id + '"]').tap()
    field_kit = page.locator("[data-field-kit-root]")
    expect(field_kit).to_contain_text(
        "1 distinct item equipped at least once · Armorer practice"
    )
    expect(field_kit).to_contain_text(
        "0 accepted transfer steps to another actor · Armor Bearer support"
    )

    page.locator('[data-unequip-field-item="scouting"]').tap()
    recipient = page.locator('[data-transfer-recipient="' + item_id + '"]')
    expect(recipient).to_be_visible()
    page.wait_for_function("""expected => {
      const select = document.querySelector('[data-transfer-recipient="' + expected.itemId + '"]');
      return !!select && Array.from(select.options).some(option =>
        option.value === expected.recipientId &&
        option.getAttribute('data-role') === 'witness'
      );
    }""", arg={"itemId": item_id, "recipientId": witness_id}, timeout=30000)
    recipient.select_option(value=witness_id)
    page.locator('[data-offer-field-item="' + item_id + '"]').tap()

    cancel = page.locator("[data-cancel-field-item-transfer]")
    expect(cancel).to_have_count(1)
    offer_id = cancel.get_attribute("data-cancel-field-item-transfer")
    if not offer_id:
        raise AssertionError("The retained transfer offer did not expose its identity.")
    offer_event = read_event(page, "field-item-transfer-offered", "offerId", offer_id)
    if offer_event.get("itemEventId") != forge_event.get("id") or \
            offer_event.get("itemId") != item_id:
        raise AssertionError("The offer is not bound to the exact forged item.")
    if offer_event.get("actor", {}).get("id") != founder_id or \
            offer_event.get("recipientId") != witness_id or \
            offer_event.get("recipientRole") != "witness":
        raise AssertionError("The retained offer is not bound to the designated recipient.")

    expect(field_kit).to_contain_text(
        "1 distinct item equipped at least once · Armorer practice"
    )
    expect(field_kit).to_contain_text(
        "0 accepted transfer steps to another actor · Armor Bearer support"
    )
    return {
        "itemId": item_id,
        "offerId": offer_id,
        "forgeEventId": forge_event["id"],
        "sourceEventId": source_event_id,
        "offerEventId": offer_event["id"]
    }


def assert_character_skills(page, role, expected_armorer, expected_armor_bearer):
    close_sheet_if_open(page)
    before = quest.authoritative_snapshot(page)
    page.locator("#character-button").tap()
    expect(page.locator("#sheet-title")).to_have_text("Character & field record")
    armorer = page.locator('#sheet-content [data-skill-id="armorer"]')
    bearer = page.locator('#sheet-content [data-skill-id="armor-bearer"]')
    expect(armorer).to_have_count(1)
    expect(bearer).to_have_count(1)
    expect(armorer).to_contain_text(str(expected_armorer) + " recorded")
    expect(bearer).to_contain_text(str(expected_armor_bearer) + " recorded")
    expect(page.locator("#sheet-content")).to_contain_text("0 character XP")
    after = quest.authoritative_snapshot(page)
    assert after == before, "Character and skill inspection must be read-only."
    return {
        "role": role,
        "armorerCount": expected_armorer,
        "armorBearerCount": expected_armor_bearer,
        "characterXp": 0,
        "readOnly": after == before
    }


def assert_pending_offer_no_progress(page, item_id, offer_id, out):
    pending_skills = assert_character_skills(page, "founder", 1, 0)
    close_sheet_if_open(page)
    quest.open_quest_board(page)
    before = quest.authoritative_snapshot(page)
    carry = page.locator(
        '#sheet-content [data-objective-id="founder-carry-field-item-forward"]'
    )
    participation = page.locator(
        '#sheet-content [data-objective-id="founder-complete-field-item-transfer"]'
    )
    expect(carry).to_have_count(1)
    expect(carry.locator(".quest-step-state")).to_have_text("OPEN")
    expect(carry).to_contain_text("0/1")
    expect(carry.locator("details.quest-evidence")).to_have_count(0)
    expect(participation.locator(".quest-step-state")).to_have_text("OPEN")
    expect(participation).to_contain_text("0/1")
    after = quest.authoritative_snapshot(page)
    assert after == before, "A pending-offer Quest Board inspection must be read-only."
    screenshot = out / "armor-bearer-pending-offer-320.png"
    page.screenshot(path=str(screenshot), full_page=True)
    return {
        "armorerCount": pending_skills["armorerCount"],
        "armorBearerCount": pending_skills["armorBearerCount"],
        "carryObjective": "OPEN 0/1",
        "sharedTransferObjective": "OPEN 0/1",
        "pendingOfferId": offer_id,
        "itemId": item_id,
        "readOnly": after == before,
        "screenshot": screenshot.name
    }


def accept_designated_transfer(page, offer_id, item_id, founder_id, source_event_id):
    open_carry_objective_and_forge(page, "witness")
    incoming = page.locator('[data-field-transfer-offer="' + offer_id + '"]')
    expect(incoming).to_have_count(1)
    expect(incoming).to_contain_text("Only this recipient session can accept.")
    expect(incoming).to_contain_text(founder_id)
    page.locator('[data-accept-field-item-transfer="' + offer_id + '"]').tap()
    expect(page.locator('[data-field-transfer-offer="' + offer_id + '"]')).to_have_count(0)

    received = page.locator('[data-field-item-id="' + item_id + '"]')
    expect(received).to_have_count(1)
    expect(received).to_contain_text("current owner")
    expect(received).to_contain_text("Original creator " + founder_id)
    expect(received).to_contain_text("retained source event " + source_event_id)
    return received


def read_transfer_event(page, offer_id):
    return read_event(page, "field-item-transferred", "offerId", offer_id)


def assert_quest_projection(page, role, item_id, transfer_event, out, width):
    close_sheet_if_open(page)
    quest.open_quest_board(page)
    snapshot_before_inspection = quest.authoritative_snapshot(page)

    carry = page.locator(
        '#sheet-content [data-objective-id="' + role + '-carry-field-item-forward"]'
    )
    expect(carry).to_have_count(1)
    if role == "founder":
        expect(carry.locator(".quest-step-state")).to_have_text("RECORDED")
        expect(carry).to_contain_text("1/1")
        expect(carry).to_contain_text("Only the initiating actor receives this support objective")
        detail = carry.locator("details.quest-evidence")
        expect(detail).to_have_count(1)
        detail.locator("summary").tap()
        expect(detail).to_contain_text(transfer_event["id"])
        expect(detail).to_contain_text(item_id)
    else:
        expect(carry.locator(".quest-step-state")).to_have_text("OPEN")
        expect(carry).to_contain_text("0/1")
        expect(carry).to_contain_text("Receiving an item is separate participation")

    participation = page.locator(
        '#sheet-content [data-objective-id="' + role + '-complete-field-item-transfer"]'
    )
    expect(participation).to_have_count(1)
    expect(participation.locator(".quest-step-state")).to_have_text("RECORDED")
    expect(participation).to_contain_text("1/1")
    participation_detail = participation.locator("details.quest-evidence")
    expect(participation_detail).to_have_count(1)
    participation_detail.locator("summary").tap()
    expect(participation_detail).to_contain_text(transfer_event["id"])
    expect(participation_detail).to_contain_text(item_id)

    snapshot_after_inspection = quest.authoritative_snapshot(page)
    assert snapshot_after_inspection == snapshot_before_inspection, (
        "Quest Board evidence inspection must not mutate revision, events, XP, or artifact versions."
    )
    screenshot = out / ("armor-bearer-quest-board-" + role + "-" + str(width) + ".png")
    page.screenshot(path=str(screenshot), full_page=True)
    return {
        "role": role,
        "carryObjective": {
            "id": role + "-carry-field-item-forward",
            "state": "RECORDED" if role == "founder" else "OPEN",
            "progress": "1/1" if role == "founder" else "0/1",
            "evidenceEventId": transfer_event["id"] if role == "founder" else None
        },
        "sharedTransferObjective": {
            "id": role + "-complete-field-item-transfer",
            "state": "RECORDED",
            "progress": "1/1",
            "evidenceEventId": transfer_event["id"]
        },
        "readOnlyEvidenceInspection": snapshot_after_inspection == snapshot_before_inspection,
        "screenshot": screenshot.name
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="artifacts/armor-bearer-mobile")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []

    with tempfile.TemporaryDirectory(prefix="ngl-armor-bearer-quest-") as data_dir:
        process, url = quest.launch_server(data_dir)
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(args=["--no-sandbox"])
                try:
                    founder_context = browser.new_context(
                        viewport={"width": 320, "height": 844},
                        is_mobile=True,
                        has_touch=True
                    )
                    witness_context = browser.new_context(
                        viewport={"width": 390, "height": 844},
                        is_mobile=True,
                        has_touch=True
                    )
                    try:
                        founder_page = founder_context.new_page()
                        witness_page = witness_context.new_page()
                        founder_errors = []
                        witness_errors = []
                        founder_initial = start_shared_actor(
                            founder_page, url, "founder", founder_errors
                        )
                        witness_initial = start_shared_actor(
                            witness_page, url, "witness", witness_errors
                        )
                        if founder_initial["viewerId"] == witness_initial["viewerId"]:
                            raise AssertionError("Founder and Witness fixtures must use separate session identities.")
                        if founder_initial["xp"] != witness_initial["xp"]:
                            raise AssertionError("Both clients must observe the same initial shared-world XP.")

                        source = create_discovery_fixture(founder_page)
                        if source["actorId"] != founder_initial["viewerId"] or source["actorRole"] != "founder":
                            raise AssertionError("The source fixture is not owned by the Founder session.")
                        if source["xp"] != founder_initial["xp"]:
                            raise AssertionError("A discovery fixture must not grant XP.")

                        open_carry_objective_and_forge(founder_page, "founder")
                        item_and_offer = forge_equip_unequip_and_offer(
                            founder_page, source["eventId"], witness_initial["viewerId"],
                            founder_initial["viewerId"]
                        )
                        pending = assert_pending_offer_no_progress(
                            founder_page, item_and_offer["itemId"], item_and_offer["offerId"], out
                        )

                        accept_designated_transfer(
                            witness_page, item_and_offer["offerId"],
                            item_and_offer["itemId"], founder_initial["viewerId"],
                            source["eventId"]
                        )
                        transfer_event = read_transfer_event(
                            witness_page, item_and_offer["offerId"]
                        )
                        if transfer_event.get("itemId") != item_and_offer["itemId"]:
                            raise AssertionError("The transfer event is not bound to the exact forged item.")
                        if transfer_event.get("itemEventId") != item_and_offer["forgeEventId"]:
                            raise AssertionError("The transfer event lost the original forge-event identity.")
                        if transfer_event.get("fromActorId") != founder_initial["viewerId"] or \
                                transfer_event.get("fromActorRole") != "founder":
                            raise AssertionError("The retained transfer event has the wrong sender.")
                        if transfer_event.get("actor", {}).get("id") != witness_initial["viewerId"] or \
                                transfer_event.get("actor", {}).get("role") != "witness":
                            raise AssertionError("The retained transfer event has the wrong accepting recipient.")
                        if transfer_event.get("offerId") != item_and_offer["offerId"]:
                            raise AssertionError("The retained transfer event is not bound to the exact offer.")

                        founder_refreshed = resume_founder_session(
                            founder_page, url, founder_initial["viewerId"], founder_errors
                        )
                        witness_after = quest.authoritative_snapshot(witness_page)
                        if founder_refreshed["xp"] != founder_initial["xp"] or \
                                witness_after["xp"] != witness_initial["xp"]:
                            raise AssertionError(
                                "Forge, equipment, offer, acceptance, and quest projection must grant zero world XP."
                            )

                        founder_quest = assert_quest_projection(
                            founder_page, "founder", item_and_offer["itemId"],
                            transfer_event, out, 320
                        )
                        witness_quest = assert_quest_projection(
                            witness_page, "witness", item_and_offer["itemId"],
                            transfer_event, out, 390
                        )
                        founder_skills = assert_character_skills(
                            founder_page, "founder", 1, 1
                        )
                        witness_skills = assert_character_skills(
                            witness_page, "witness", 0, 0
                        )
                        if founder_errors or witness_errors:
                            raise AssertionError(
                                "Browser page errors: " + json.dumps({
                                    "founder": founder_errors,
                                    "witness": witness_errors
                                })
                            )

                        results.append({
                            "journey": "armor-bearer-carry-forward-founder-320-witness-390",
                            "passed": True,
                            "fixtureOnlySource": source,
                            "founderActorId": founder_initial["viewerId"],
                            "witnessActorId": witness_initial["viewerId"],
                            "itemId": item_and_offer["itemId"],
                            "forgeEventId": item_and_offer["forgeEventId"],
                            "sourceEventId": item_and_offer["sourceEventId"],
                            "offerId": item_and_offer["offerId"],
                            "offerEventId": item_and_offer["offerEventId"],
                            "transferEvent": {
                                "id": transfer_event["id"],
                                "type": transfer_event["type"],
                                "itemId": transfer_event["itemId"],
                                "itemEventId": transfer_event["itemEventId"],
                                "fromActorId": transfer_event["fromActorId"],
                                "fromActorRole": transfer_event["fromActorRole"],
                                "recipientId": transfer_event["actor"]["id"],
                                "recipientRole": transfer_event["actor"]["role"]
                            },
                            "pendingOffer": pending,
                            "founderQuest": founder_quest,
                            "witnessQuest": witness_quest,
                            "founderSkills": founder_skills,
                            "witnessSkills": witness_skills,
                            "worldXpUnchanged": True,
                            "truthVerdict": None,
                            "independentVerification": "NOT_PERFORMED",
                            "approval": None,
                            "nglAuthority": None,
                            "actorIdentityLimit": "separate pseudonymous browser sessions, not proof of distinct humans",
                            "pageErrors": {
                                "founder": founder_errors,
                                "witness": witness_errors
                            }
                        })
                        print(json.dumps(results[-1]), flush=True)
                    finally:
                        founder_context.close()
                        witness_context.close()
                finally:
                    browser.close()
        finally:
            quest.stop_server(process)

    (out / "results.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results))


if __name__ == "__main__":
    main()
