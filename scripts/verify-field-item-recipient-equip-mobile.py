"""Mobile acceptance for a designated recipient equipping a transferred field item.

This separate two-session journey proves current ownership enables equip and
Armorer practice without rewriting creator/source provenance, adding XP, or
manufacturing authority.
"""
import argparse
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / "scripts" / "verify-armor-bearer-mobile.py"
SPEC = importlib.util.spec_from_file_location("ngl_armor_bearer_acceptance", SHARED)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load the shared Armor Bearer acceptance helpers.")
helper = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = helper
SPEC.loader.exec_module(helper)
quest = helper.quest


def run_viewport(browser, out, width):
    page_errors = {"founder": [], "witness": []}
    external_requests = {"founder": [], "witness": []}
    diagnostics = {}
    context_options = {
        "viewport": {"width": width, "height": 844},
        "is_mobile": True,
        "has_touch": True
    }

    with tempfile.TemporaryDirectory(prefix="ngl-recipient-equip-mobile-") as data_dir:
        process, url = quest.launch_server(data_dir)
        founder_context = browser.new_context(**context_options)
        witness_context = browser.new_context(**context_options)
        founder_page = founder_context.new_page()
        witness_page = witness_context.new_page()
        try:
            helper.attach_observers(founder_page, url, page_errors["founder"], external_requests["founder"])
            helper.attach_observers(witness_page, url, page_errors["witness"], external_requests["witness"])

            witness = helper.enter_shared(witness_page, url, "witness")
            founder_prelogin = helper.enter_shared(founder_page, url, "witness")
            assert witness["role"] == founder_prelogin["role"] == "witness"
            founder = helper.login_founder(founder_page)
            assert founder["role"] == "founder" and founder["id"] != witness["id"]
            assert founder_prelogin["id"] != witness["id"], (
                "Separate browser contexts must have separate pseudonymous session IDs."
            )
            helper.wait_for_presence(founder_page, witness["id"], "witness", True)
            helper.wait_for_presence(witness_page, founder["id"], "founder", True)

            initial_state = helper.read_state(founder_page)
            initial_kernel_event_ids = initial_state["kernelEventIds"]
            assert initial_state["xp"] == 0, "The disposable world must begin with zero world XP."

            # Founder creates the item through the actual walkable world and Forge UI.
            helper.walk_to(founder_page, "River of Receipts", "river")
            helper.wait_for_event(founder_page, {
                "type": "discover", "actorId": founder["id"], "actorRole": "founder",
                "match": {"locationId": "river"}
            })
            river_events = [
                event for event in helper.read_state(founder_page)["events"]
                if event.get("type") == "discover" and event.get("locationId") == "river" and
                (event.get("actor") or {}).get("id") == founder["id" and
                (event.get("actor") or {}).get("role") == "founder" and event.get("repeat") is not True
            ]
            assert len(river_events) == 1, "One retained River source must exist."
            discovery_event = river_events[0]

            helper.enter_institution(founder_page, "forge", "Forge")
            source_select = founder_page.locator("#sheet-content #forge-source-scouting")
            expect(source_select).to_be_visible()
            source_select.select_option(value=discovery_event["id"])
            founder_page.locator('#sheet-content [data-forge-item="scouting"]').tap()
            helper.wait_for_event(founder_page, {
                "type": "field-item-forged", "actorId": founder["id"], "actorRole": "founder",
                "match": {"sourceEventId": discovery_event["id"], "slotId": "scouting"}
            })
            forged_state = helper.read_state(founder_page)
            forge_events = [
                event for event in forged_state["events"]
                if event.get("type") == "field-item-forged" and
                event.get("sourceEventId") == discovery_event["id"] and
                event.get("slotId") == "scouting" and
                (event.get("actor") or {}).get("id") == founder["id"]
            ]
            assert len(forge_events) == 1, "Forge must retain one source-bound item."
            forge_event = forge_events[0]
            item_id = forge_event["itemId"]
            assert isinstance(item_id, str) and item_id

            founder_before = helper.inspect_character(founder_page)
            witness_before = helper.inspect_character(witness_page)
            assert founder_before["characterXp"] == witness_before["characterXp"] == 0
            assert founder_before["worldXp"] == witness_before["worldXp"] == 0
            assert founder_before["skills"]["forger"] == 1
            assert founder_before["skills"]["armorer"] == 0
            assert founder_before["skills"]["armor-bearer"] == 0
            assert witness_before["skills"]["forger"] == 0
            assert witness_before["skills"]["armorer"] == 0
            assert witness_before["skills"]["armor-bearer"] == 0

            # Offer the exact source-bound item through the Field Kit UI.
            helper.enter_institution(founder_page, "forge", "Forge")
            recipient_select = founder_page.locator(
                '#sheet-content [data-transfer-recipient="' + item_id + '"]'
            )
            founder_page.wait_for_function(
                """expected => {
                  const select = document.querySelector(
                    '#sheet-content [data-transfer-recipient="' + expected.itemId + '"]'
                  );
                  return Boolean(select && Array.from(select.options).some(option =>
                    option.value === expected.recipientId &&
                    option.getAttribute('data-role') === 'witness'
                  ));
                }""",
                arg={"itemId": item_id, "recipientId": witness["id"]},
                timeout=20000
            )
            recipient_select.select_option(value=witness["id"])
            founder_page.locator(
                '#sheet-content [data-offer-field-item="' + item_id + '"]'
            ).tap()
            helper.wait_for_event(founder_page, {
                "type": "field-item-transfer-offered", "actorId": founder["id"],
                "actorRole": "founder",
                "match": {"itemEventId": forge_event["id"], "recipientId": witness["id"],
                          "recipientRole": "witness"}
            })
            offer_events = [
                event for event in helper.read_state(founder_page)["events"]
                if event.get("type") == "field-item-transfer-offered" and
                event.get("itemEventId") == forge_event["id"] and
                event.get("recipientId") == witness["id"] and
                (event.get("actor") or {}).get("id") == founder["id"]
            ]
            assert len(offer_events) == 1, "One designated-recipient offer must be retained."
            offer_event = offer_events[0]
            offer_id = offer_event["offerId"]

            # Recipient accepts through the visible incoming-offer UI.
            helper.enter_institution(witness_page, "forge", "Forge")
            incoming = witness_page.locator(
                '#sheet-content [data-field-transfer-offer="' + offer_id + '"]'
            )
            expect(incoming).to_have_count(1)
            accept_button = incoming.locator(
                '[data-accept-field-item-transfer="' + offer_id + '"]'
            )
            expect(accept_button).to_have_count(1)
            accept_button.tap()
            helper.wait_for_event(witness_page, {
                "type": "field-item-transferred", "actorId": witness["id"],
                "actorRole": "witness", "match": {"offerId": offer_id, "itemEventId": forge_event["id"]}
            })
            transfer_events = [
                event for event in helper.read_state(witness_page)["events"]
                if event.get("type") == "field-item-transferred" and event.get("offerId") == offer_id
            ]
            assert len(transfer_events) == 1, "One accepted transfer must be retained."
            transfer_event = transfer_events[0]
            assert transfer_event.get("fromActorId") == founder["id"]
            assert transfer_event.get("fromActorRole") == "founder"
            assert transfer_event.get("actor", {}).get("id") == witness["id"]
            assert transfer_event.get("itemId") == forge_event["itemId"]
            assert transfer_event.get("itemEventId") == forge_event["id"]

            # Read-only character projection shows ownership, but not Armorer credit yet.
            founder_after_transfer = helper.inspect_character(founder_page)
            witness_after_transfer = helper.inspect_character(witness_page)
            witness_item_card = witness_page.locator(
                '#sheet-content [data-field-item-id="' + item_id + '"]'
            )
            expect(witness_item_card).to_have_count(1)
            expect(witness_item_card).to_contain_text("current owner " + witness["id"])
            expect(witness_item_card).to_contain_text("Original creator " + founder["id"])
            expect(witness_item_card).to_contain_text("retained source event " + discovery_event["id"])
            expect(founder_page.locator(
                '#sheet-content [data-field-item-id="' + item_id + '"]'
            )).to_have_count(0)
            assert founder_after_transfer["skills"]["forger"] == 1
            assert founder_after_transfer["skills"]["armorer"] == 0
            assert founder_after_transfer["skills"]["armor-bearer"] == 1
            assert founder_after_transfer["skills"]["questkeeper"] == founder_before["skills"]["questkeeper"] + 1
            assert witness_after_transfer["skills"]["forger"] == 0
            assert witness_after_transfer["skills"]["armorer"] == 0
            assert witness_after_transfer["skills"]["armor-bearer"] == 0
            assert witness_after_transfer["skills"]["questkeeper"] == witness_before["skills"]["questkeeper"] + 1
            assert founder_after_transfer["characterXp"] == witness_after_transfer["characterXp"] == 0
            assert founder_after_transfer["worldXp"] == witness_after_transfer["worldXp"] == 0

            # The recipient, not the original creator, now equips the exact item.
            helper.enter_institution(witness_page, "forge", "Forge")
            equip_button = witness_page.locator(
                '#sheet-content [data-equip-forged-item="' + item_id + '"]'
            )
            expect(equip_button).to_have_count(1)
            equip_button.tap()
            helper.wait_for_event(witness_page, {
                "type": "field-item-equipped", "actorId": witness["id"],
                "actorRole": "witness", "match": {"sourceEventId": forge_event["id"], "slotId": "scouting"}
            })
            equip_events = [
                event for event in helper.read_state(witness_page)["events"]
                if event.get("type") == "field-item-equipped" and
                event.get("sourceEventId") == forge_event["id"] and
                event.get("slotId") == "scouting" and
                (event.get("actor") or {}).get("id") == witness["id"]
            ]
            assert len(equip_events) == 1, "The recipient must retain one equip action."
            equip_event = equip_events[0]
            expect(witness_page.locator(
                '#sheet-content [data-equipment-slot="scouting"]'
            )).to_contain_text("Equipped")

            witness_after_equip = helper.inspect_character(witness_page)
            witness_item_card = witness_page.locator(
                '#sheet-content [data-field-item-id="' + item_id + '"]'
            )
            expect(witness_item_card).to_have_count(1)
            expect(witness_item_card).to_contain_text("current owner " + witness["id"])
            expect(witness_item_card).to_contain_text("Original creator " + founder["id"])
            expect(witness_item_card).to_contain_text("retained source event " + discovery_event["id"])
            assert founder_after_transfer["skills"]["armor-bearer"] == 1
            assert witness_after_equip["skills"]["armorer"] == 1
            assert witness_after_equip["skills"]["forger"] == 0
            assert witness_after_equip["skills"]["armor-bearer"] == 0
            assert witness_after_equip["skills"]["questkeeper"] == witness_after_transfer["skills"]["questkeeper"] + 1
            assert witness_after_equip["characterXp"] == witness_after_transfer["characterXp"] == 0
            assert witness_after_equip["worldXp"] == 0

            founder_quest = helper.inspect_quest_board(founder_page, "founder", [
                ("forge-field-item", "1/1", forge_event["id"]),
                ("equip-field-item", "0/1", None),
                ("complete-field-item-transfer", "1/1", transfer_event["id"]),
                ("carry-field-item-forward", "1/1", transfer_event["id"])
            ])
            witness_quest = helper.inspect_quest_board(witness_page, "witness", [
                ("forge-field-item", "0/1", None),
                ("equip-field-item", "1/1", equip_event["id"]),
                ("complete-field-item-transfer", "1/1", transfer_event["id"]),
                ("carry-field-item-forward", "0/1", None)
            ])
            witness_equip_row = witness_page.locator(
                '#sheet-content [data-objective-id="witness-equip-field-item"]'
            )
            expect(witness_equip_row).to_contain_text("currently owned field item")

            final_founder = helper.read_state(founder_page)
            final_witness = helper.read_state(witness_page)
            assert final_founder["revision"] == final_witness["revision"]
            assert final_founder["sharedEventIds"] == final_witness["sharedEventIds"]
            assert final_founder["sharedActivityEventIds"] == final_witness["sharedActivityEventIds"]
            assert final_founder["xp"] == final_witness["xp"] == initial_state["xp"] == 0
            assert final_founder["kernelEventIds"] == final_witness["kernelEventIds"] == initial_kernel_event_ids
            positions = {event["id"]: index for index, event in enumerate(final_founder["events"])}
            ordered_ids = [
                discovery_event["id"], forge_event["id"], offer_event["id"],
                transfer_event["id"], equip_event["id"]
            ]
            assert all(event_id in positions for event_id in ordered_ids)
            ordered_positions = [positions[event_id] for event_id in ordered_ids]
            assert len(set(ordered_positions)) == 5 and ordered_positions == sorted(ordered_positions)
            assert {event.get("type") for event in final_founder["events"]} == {
                "discover", "field-item-forged", "field-item-transfer-offered",
                "field-item-transferred", "field-item-equipped"
            }
            assert final_founder["revision"] == initial_state["revision"] + 5
            helper.assert_no_overflow(founder_page, width, "Founder Quest Board")
            helper.assert_no_overflow(witness_page, width, "Witness Quest Board")
            assert not page_errors["founder"], "Founder page errors: " + json.dumps(page_errors["founder"])
            assert not page_errors["witness"], "Witness page errors: " + json.dumps(page_errors["witness"])
            assert external_requests["founder"] == [], (
                "Founder browser made external requests: " + json.dumps(external_requests["founder"])
            )
            assert external_requests["witness"] == [], (
                "Witness browser made external requests: " + json.dumps(external_requests["witness"])
            )

            founder_screenshot = out / ("recipient-equip-founder-" + str(width) + ".png")
            witness_screenshot = out / ("recipient-equip-witness-" + str(width) + ".png")
            founder_page.screenshot(path=str(founder_screenshot), full_page=True)
            witness_page.screenshot(path=str(witness_screenshot), full_page=True)
            return {
                "journey": "recipient-equip-after-transfer-" + str(width),
                "passed": True,
                "viewport": width,
                "founder": {
                    "actorId": founder["id"], "role": founder["role"],
                    "before": founder_before, "afterTransfer": founder_after_transfer,
                    "questBoard": founder_quest
                },
                "witness": {
                    "actorId": witness["id"], "role": witness["role"],
                    "before": witness_before, "afterTransfer": witness_after_transfer,
                    "afterEquip": witness_after_equip, "questBoard": witness_quest
                },
                "events": {
                    "initialRevision": initial_state["revision"],
                    "initialKernelEventIds": initial_kernel_event_ids,
                    "initialWorldXp": initial_state["xp"],
                    "finalRevision": final_founder["revision"],
                    "mutuallyVisibleEventIds": final_founder["sharedEventIds"],
                    "appendPositions": {event_id: positions[event_id] for event_id in ordered_ids},
                    "discoveryEventId": discovery_event["id"],
                    "forgeEventId": forge_event["id"],
                    "itemId": item_id,
                    "offerEventId": offer_event["id"],
                    "offerId": offer_id,
                    "transferEventId": transfer_event["id"],
                    "equipEventId": equip_event["id"]
                },
                "progression": {
                    "founderForger": founder_after_transfer["skills"]["forger"],
                    "founderArmorBearer": founder_after_transfer["skills"]["armor-bearer"],
                    "witnessArmorer": witness_after_equip["skills"]["armorer"],
                    "witnessQuestkeeperIncrementOnTransfer": 1,
                    "witnessQuestkeeperIncrementOnEquip": 1,
                    "characterXp": {"founder": founder_after_transfer["characterXp"],
                                   "witness": witness_after_equip["characterXp"]},
                    "worldXp": final_founder["xp"]
                },
                "provenance": {
                    "creatorRemainsFounder": True,
                    "sourceRemainsRiverDiscovery": True,
                    "currentOwnerIsWitness": True,
                    "equipmentIsActorAttributed": True
                },
                "readOnlyProjections": {
                    "characterSheets": True, "questBoards": True
                },
                "noPageErrors": True, "noExternalRequests": True, "noHorizontalOverflow": True,
                "screenshots": [founder_screenshot.name, witness_screenshot.name]
            }
        except Exception as error:
            failure = {
                "journey": "recipient-equip-after-transfer-" + str(width),
                "passed": False, "viewport": width, "error": repr(error),
                "diagnostics": diagnostics, "pageErrors": page_errors,
                "externalRequests": external_requests
            }
            (out / ("failure-" + str(width) + ".json")).write_text(
                json.dumps(failure, indent=2), encoding="utf-8"
            )
            try:
                founder_page.screenshot(
                    path=str(out / ("failure-founder-" + str(width) + ".png")),
                    full_page=True
                )
                witness_page.screenshot(
                    path=str(out / ("failure-witness-" + str(width) + ".png")),
                    full_page=True
                )
            except Exception:
                pass
            raise
        finally:
            founder_context.close()
            witness_context.close()
            quest.stop_server(process)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="/tmp/ngl-recipient-equip-mobile")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=["--no-sandbox"])
        try:
            for width in (320, 390):
                result = run_viewport(browser, out, width)
                results.append(result)
                (out / "results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
                print(json.dumps(result), flush=True)
        finally:
            browser.close()
    print(json.dumps(results))


if __name__ == "__main__":
    main()
