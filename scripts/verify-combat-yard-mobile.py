"""Mobile acceptance for the shared Combat Yard and its Evidence Archive Chronicle.

The test uses separate pseudonymous Witness sessions, server-checked virtual
position, explicit player moves, and a read-only Chronicle inspection. It does
not treat browser sessions as proof of distinct humans or virtual position as
GPS evidence.
"""
import argparse
import importlib.util
import json
import math
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHARED_ACCEPTANCE = ROOT / "scripts" / "verify-quest-board.py"
SPEC = importlib.util.spec_from_file_location(
    "ngl_shared_quest_board_acceptance",
    SHARED_ACCEPTANCE
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load the shared Quest Board acceptance helpers.")
quest = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = quest
SPEC.loader.exec_module(quest)


def read_world_state(page):
    return page.evaluate("""async () => {
      const response = await fetch('/api/state', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Shared world read failed: ' + response.status);
      const dto = await response.json();
      const world = dto?.world;
      if (!world || !Array.isArray(world.events) || !Array.isArray(world.creations)) {
        throw new Error('Shared state did not contain the retained world projection.');
      }
      return {
        revision: world.revision,
        xp: world.xp,
        updatedAt: world.updatedAt,
        eventIds: world.events.map(event => event.id),
        events: world.events,
        creationVersions: world.creations.map(creation => [creation.id, creation.version]),
        viewer: {
          id: dto.viewer?.id,
          role: dto.viewer?.role,
          position: dto.viewer?.position
        }
      };
    }""")


def post_action(page, action):
    return page.evaluate("""async action => {
      const response = await fetch('/api/action', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action)
      });
      return { status: response.status, payload: await response.json() };
    }""", action)


def start_shared_witness(page, url, page_errors, external_requests):
    origin = url.rstrip("/")

    def record_external_request(request):
        if request.url.startswith(("http://", "https://")) and not request.url.startswith(origin):
            external_requests.append(request.url)

    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on("request", record_external_request)
    page.goto(url, wait_until="networkidle")
    page.locator("#start-shared").tap()
    page.locator("#world").wait_for(state="visible")
    expect(page.locator("#world")).to_have_attribute("data-world-renderer", "pixel-v1")
    page.wait_for_function(
        """() => document.querySelector('#mode-label')?.textContent.includes('Witness') &&
          document.querySelector('#world')?.dataset.movementEnabled === 'true'""",
        timeout=45000
    )
    page.wait_for_function("""async () => {
      const response = await fetch('/api/state', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return false;
      const dto = await response.json();
      const position = dto.viewer?.position;
      return Number.isFinite(position?.x) && Number.isFinite(position?.y);
    }""", timeout=30000)


def walk_to_institution(page, place_id, place_name):
    page.bring_to_front()
    page.locator("#places-button").tap()
    route = page.get_by_role("button", name="Walk to " + place_name, exact=True)
    expect(route).to_be_visible()
    route.tap()
    quest.enter_nearby_institution(
        page, place_id, place_name, place_name, timeout=60000
    )
    expect(page.locator("#sheet-title")).to_have_text(place_name)


def run_viewport(browser, url, out, width):
    context = browser.new_context(
        viewport={"width": width, "height": 844},
        is_mobile=True,
        has_touch=True
    )
    page = context.new_page()
    page_errors = []
    external_requests = []
    try:
        start_shared_witness(page, url, page_errors, external_requests)
        initial = read_world_state(page)
        actor = initial["viewer"]
        if actor["role"] != "witness" or not actor["id"]:
            raise AssertionError("The shared journey must use a pseudonymous Witness session.")
        position = actor["position"]
        distance = math.hypot(position["x"] - 620, position["y"] - 790)
        if distance <= 160:
            raise AssertionError("The fresh Witness must begin outside the Combat Yard action radius.")

        # A direct action from outside the yard must fail before any event is retained.
        out_of_range = post_action(page, {
            "type": "start-combat-encounter",
            "opponentId": "yard-scout",
            "requestId": "combat-yard-out-of-range-" + str(width)
        })
        if out_of_range["status"] != 409 or out_of_range["payload"].get("error", {}).get("code") != "COMBAT_YARD_REQUIRED":
            raise AssertionError("The server must reject a combat start outside the virtual Combat Yard.")
        after_probe = read_world_state(page)
        if (after_probe["revision"], after_probe["updatedAt"], after_probe["eventIds"], after_probe["xp"]) != (
            initial["revision"], initial["updatedAt"], initial["eventIds"], initial["xp"]
        ):
            raise AssertionError("An out-of-range combat request must not mutate world history or XP.")

        walk_to_institution(page, "combat_yard", "Combat Yard")
        panel = page.locator("#sheet-content")
        expect(panel).to_have_attribute("data-combat-yard-panel", "true")
        expect(panel).to_contain_text("SHARED WORLD")
        combat_xp_before = int(panel.get_attribute("data-combat-xp"))
        if combat_xp_before != 0:
            raise AssertionError("A fresh session must not inherit another actor's Combat Yard XP.")

        page.locator('#sheet-content [data-combat-opponent="yard-scout"]').tap()
        page.wait_for_function(
            """() => document.querySelector('#sheet-content')?.dataset.combatStatus === 'active' &&
              document.querySelector('#sheet-content')?.dataset.combatTurn === '0'""",
            timeout=15000
        )
        active_card = page.locator("#sheet-content [data-combat-encounter]")
        expect(active_card).to_have_count(1)
        expect(active_card).to_contain_text("OPPONENT HP 44/44")

        moves = ["feint", "guard", "strike", "feint", "guard", "strike"]
        for turn, move in enumerate(moves, start=1):
            page.locator('#sheet-content [data-combat-move="' + move + '"]').tap()
            page.wait_for_function(
                "(expected) => document.querySelector('#sheet-content')?.dataset.combatTurn === String(expected)",
                arg=turn,
                timeout=15000
            )
            if turn == 3:
                expect(page.locator("#sheet-content [data-combat-encounter]")).to_contain_text("OPPONENT HP 12/44")

        expect(panel).to_have_attribute("data-combat-status", "victory")
        expect(panel).to_have_attribute("data-combat-turn", "6")
        expect(panel).to_have_attribute("data-combat-xp", "30")
        expect(panel).to_have_attribute("data-combat-victories", "1")
        expect(panel).to_contain_text("LAST ENCOUNTER: VICTORY")

        after_fight = read_world_state(page)
        actor_events = [
            event for event in after_fight["events"]
            if event.get("type") in ("combat-encounter-started", "combat-move-resolved") and
            (event.get("actor") or {}).get("id") == actor["id"] and
            (event.get("actor") or {}).get("role") == actor["role"]
        ]
        if len(actor_events) != 7:
            raise AssertionError("One start plus six explicit moves must be retained for this actor.")
        if actor_events[0].get("type") != "combat-encounter-started":
            raise AssertionError("The actor's first retained combat event must start the encounter.")
        if [event.get("move") for event in actor_events[1:]] != moves:
            raise AssertionError("Retained combat moves must match the explicit player action sequence.")
        encounter_ids = {event.get("encounterId") for event in actor_events}
        if len(encounter_ids) != 1:
            raise AssertionError("All seven events must remain bound to one encounter.")
        final_event_id = actor_events[-1]["id"]
        if after_fight["xp"] != initial["xp"]:
            raise AssertionError("Combat Yard XP must remain actor-scoped, not mutate publication/world XP.")

        # The Character Sheet must make each retained activity navigable to its exact
        # source event in World Chronicle; this is inspection only, not a new action.
        before_character_sheet = read_world_state(page)
        final_position = next(
            (index + 1 for index, event in enumerate(before_character_sheet["events"])
             if event.get("id") == final_event_id),
            None
        )
        if final_position is None:
            raise AssertionError("The final combat move must remain visible in this actor's world stream.")

        page.locator("#sheet-close").tap()
        page.locator("#character-button").tap()
        expect(page.locator("#sheet-title")).to_have_text("Character & field record")
        expect(page.locator("#sheet-content [data-character-snapshot-stale]")).to_have_count(0)
        recent_links = page.locator("#sheet-content [data-recent-activity-event-link]")
        expect(recent_links).to_have_count(6)
        recent_link_ids = recent_links.evaluate_all(
            "nodes => nodes.map(node => node.getAttribute('data-recent-activity-event-link'))"
        )
        expected_recent_ids = [event["id"] for event in actor_events[1:]][::-1]
        if recent_link_ids != expected_recent_ids:
            raise AssertionError(
                "Character Sheet Recent field trail must expose the newest six actor events "
                "in retained append order, newest first."
            )

        final_recent_link = page.locator(
            '#sheet-content [data-recent-activity-event-link="' + final_event_id + '"]'
        )
        expect(final_recent_link).to_have_count(1)
        expect(final_recent_link).to_have_attribute("data-chronicle-event-id", final_event_id)
        expect(final_recent_link).to_have_attribute("data-chronicle-source", "world")
        expect(final_recent_link).to_have_attribute(
            "aria-label", "Inspect this retained event in World Chronicle"
        )
        final_recent_link.tap()
        expect(page.locator("#sheet-title")).to_have_text("World Chronicle")
        direct_card = page.locator(
            '#chronicle-entries [data-event-id="world:' + final_event_id + '"]'
        )
        expect(direct_card).to_have_count(1)
        expect(direct_card).to_have_attribute("data-ordering-basis", "retained-append-position")
        expect(direct_card).to_have_attribute("data-stream-position", str(final_position))
        expect(direct_card).to_contain_text("WORLD STREAM · APPEND POSITION " + str(final_position))
        expect(direct_card).to_contain_text("Combat Yard move · Training Scout · turn 6")
        expect(direct_card).to_contain_text("first in-game victory")
        expect(direct_card).to_contain_text("30 game XP")
        expect(direct_card).to_contain_text("does not certify real-world combat skill")

        after_character_chronicle = read_world_state(page)
        for key in ("revision", "updatedAt", "xp", "eventIds", "creationVersions"):
            if after_character_chronicle[key] != before_character_sheet[key]:
                raise AssertionError(
                    "Character Sheet to Chronicle navigation must be read-only; changed " + key + "."
                )

        page.locator("#sheet-close").tap()
        walk_to_institution(page, "evidence_archive", "Evidence Archive")
        expect(page.locator("#sheet-content [data-chronicle-entries]")).to_have_count(1)
        before_inspection = read_world_state(page)
        final_position = next(
            (index + 1 for index, event in enumerate(before_inspection["events"])
             if event.get("id") == final_event_id),
            None
        )
        if final_position is None:
            raise AssertionError("The final combat move must remain visible in this actor's world stream.")

        search = page.locator("#sheet-content [data-chronicle-search]")
        expect(search).to_be_visible()
        search.fill(final_event_id)
        card = page.locator('#chronicle-entries [data-event-id="world:' + final_event_id + '"]')
        expect(card).to_have_count(1)
        expect(card).to_have_attribute("data-ordering-basis", "retained-append-position")
        expect(card).to_have_attribute("data-stream-position", str(final_position))
        expect(card).to_contain_text("WORLD STREAM · APPEND POSITION " + str(final_position))
        expect(card).to_contain_text("Combat Yard move · Training Scout · turn 6")
        expect(card).to_contain_text("first in-game victory")
        expect(card).to_contain_text("30 game XP")
        expect(card).to_contain_text("Remaining HP: player 100, opponent 0")
        expect(card).to_contain_text("does not certify real-world combat skill")

        after_inspection = read_world_state(page)
        for key in ("revision", "updatedAt", "xp", "eventIds", "creationVersions"):
            if after_inspection[key] != before_inspection[key]:
                raise AssertionError("Chronicle inspection must be read-only; changed " + key + ".")

        # Lose the shared connection after the last accepted snapshot. Character
        # Sheet -> Chronicle must remain locally navigable, but label the snapshot
        # stale and never pretend an offline inspection is a server-confirmed write.
        api_requests_after_offline = []
        origin = url.rstrip("/")
        def record_offline_api_request(request):
            if request.url.startswith(origin + "/api/"):
                api_requests_after_offline.append({
                    "method": request.method,
                    "path": request.url.split("?", 1)[0][len(origin):]
                })
        page.locator("#sheet-close").tap()
        page.locator("#character-button").tap()
        expect(page.locator("#sheet-title")).to_have_text("Character & field record")
        expect(page.locator("#sheet-content [data-character-snapshot-stale]")).to_have_count(0)
        online_offline_boundary_links = page.locator(
            "#sheet-content [data-recent-activity-event-link]"
        )
        expect(online_offline_boundary_links).to_have_count(6)
        online_offline_boundary_ids = online_offline_boundary_links.evaluate_all(
            "nodes => nodes.map(node => node.getAttribute('data-recent-activity-event-link'))"
        )
        if final_event_id not in online_offline_boundary_ids:
            raise AssertionError(
                "The last Combat Yard event must remain reachable in the current Character Sheet trail."
            )
        page.on("request", record_offline_api_request)
        context.set_offline(True)
        page.wait_for_function(
            """() => navigator.onLine === false &&
              document.querySelector('#connection-dot')?.dataset.connectionState === 'offline' &&
              document.querySelector('#mode-label')?.textContent.includes('reconnecting')""",
            timeout=15000
        )
        offline_character_notice = page.locator(
            "#sheet-content [data-character-snapshot-stale]"
        )
        expect(offline_character_notice).to_have_count(1)
        expect(offline_character_notice).to_contain_text(
            "last accepted shared-world snapshot and may be stale"
        )
        if offline_character_notice.get_attribute("data-snapshot-revision") != str(after_inspection["revision"]):
            raise AssertionError("The stale notice must identify the exact last accepted world revision.")
        offline_recent_links = page.locator(
            "#sheet-content [data-recent-activity-event-link]"
        )
        expect(offline_recent_links).to_have_count(6)
        offline_recent_ids = offline_recent_links.evaluate_all(
            "nodes => nodes.map(node => node.getAttribute('data-recent-activity-event-link'))"
        )
        if offline_recent_ids != online_offline_boundary_ids:
            raise AssertionError(
                "Offline Character Sheet must retain the same six links visible at the outage boundary; " +
                "expected=" + json.dumps(online_offline_boundary_ids) +
                " actual=" + json.dumps(offline_recent_ids) +
                " sheetTitle=" + json.dumps(page.locator("#sheet-title").inner_text()) +
                " staleNoticeCount=" + str(offline_character_notice.count()) +
                " worldRevision=" + json.dumps(page.locator("#world").get_attribute("data-world-revision"))
            )
        offline_final_link = page.locator(
            '#sheet-content [data-recent-activity-event-link="' + final_event_id + '"]'
        )
        expect(offline_final_link).to_have_count(1)
        offline_final_link.tap()
        expect(page.locator("#sheet-title")).to_have_text("World Chronicle")
        expect(page.locator("#sheet-content")).to_contain_text(
            "The shared stream is disconnected; this is the last accepted snapshot and may be stale."
        )
        offline_card = page.locator(
            '#chronicle-entries [data-event-id="world:' + final_event_id + '"]'
        )
        expect(offline_card).to_have_count(1)
        expect(offline_card).to_have_attribute("data-ordering-basis", "retained-append-position")
        expect(offline_card).to_have_attribute("data-stream-position", str(final_position))
        offline_snapshot = page.evaluate("""() => ({
          revision: document.querySelector('#world')?.dataset.worldRevision ?? null,
          xp: document.querySelector('#xp-count')?.textContent ?? null,
          creationCount: document.querySelector('#creation-count')?.textContent ?? null
        })""")
        if offline_snapshot != {
            "revision": str(after_inspection["revision"]),
            "xp": str(after_inspection["xp"]),
            "creationCount": str(len(after_inspection["creationVersions"]))
        }:
            raise AssertionError(
                "Offline Character Sheet/Chronicle navigation must preserve the last accepted snapshot."
            )
        offline_api_mutations = [
            request for request in api_requests_after_offline
            if request["method"] != "GET" or request["path"] in (
                "/api/state", "/api/action", "/api/presence"
            )
        ]
        if offline_api_mutations:
            raise AssertionError(
                "Offline read-only navigation must not request shared state or submit mutations: " +
                json.dumps(offline_api_mutations)
            )

        horizontal_overflow = page.evaluate(
            "() => document.documentElement.scrollWidth <= window.innerWidth"
        )
        if not horizontal_overflow:
            raise AssertionError("The mobile Combat Yard and Chronicle must not overflow horizontally.")
        if page_errors:
            raise AssertionError("Browser page errors: " + json.dumps(page_errors))
        if external_requests:
            raise AssertionError("The local acceptance made external requests: " + json.dumps(external_requests))

        screenshot = out / ("combat-yard-chronicle-offline-" + str(width) + ".png")
        page.screenshot(path=str(screenshot), full_page=True)
        result = {
            "passed": True,
            "viewportWidth": width,
            "actorId": actor["id"],
            "actorRole": actor["role"],
            "initialVirtualDistance": round(distance, 2),
            "outOfRangeStatus": out_of_range["status"],
            "outOfRangeCode": out_of_range["payload"]["error"]["code"],
            "outOfRangeMutation": False,
            "opponentHpBeforeMoves": "44/44",
            "opponentHpAfterTurnThree": "12/44",
            "moves": moves,
            "encounterId": next(iter(encounter_ids)),
            "combatEventIds": [event["id"] for event in actor_events],
            "combatXpBefore": combat_xp_before,
            "combatXpAfter": 30,
            "worldXpUnchanged": after_fight["xp"] == initial["xp"],
            "finalMoveEventId": final_event_id,
            "chronicleAppendPosition": final_position,
            "chronicleInspectionReadOnly": True,
            "characterRecentActivityEventIds": recent_link_ids,
            "characterChronicleEventId": final_event_id,
            "characterChronicleAppendPosition": final_position,
            "characterChronicleInspectionReadOnly": True,
            "offlineCharacterSheetChronicleNavigation": True,
            "onlineOfflineBoundaryEventIds": online_offline_boundary_ids,
            "offlineCharacterSheetStaleNotice": True,
            "offlineChronicleStaleNotice": True,
            "offlineInspectionReadOnly": True,
            "offlineSnapshot": offline_snapshot,
            "offlineApiRequests": api_requests_after_offline,
            "offlineApiMutationRequests": offline_api_mutations,
            "horizontalOverflow": False,
            "pageErrors": page_errors,
            "externalRequests": external_requests,
            "screenshot": screenshot.name
        }
        return result
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="artifacts/combat-yard-mobile")
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results = []

    with tempfile.TemporaryDirectory(prefix="ngl-combat-yard-mobile-") as data_dir:
        process, url = quest.launch_server(data_dir, Path(data_dir) / "source-retry-attempts.txt")
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(args=["--no-sandbox"])
                try:
                    for width in (320, 390):
                        result = run_viewport(browser, url, out, width)
                        if any(item["actorId"] == result["actorId"] for item in results):
                            raise AssertionError("Separate mobile contexts must receive distinct session identities.")
                        results.append(result)
                        (out / "results.json").write_text(json.dumps(results, indent=2))
                        print(json.dumps(result), flush=True)
                finally:
                    browser.close()
        finally:
            quest.stop_server(process)

    (out / "results.json").write_text(json.dumps(results, indent=2))
    print(json.dumps(results))


if __name__ == "__main__":
    main()
