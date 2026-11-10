#!/usr/bin/env python3
"""Exercise bounded Quest Board evidence pagination at a 320px mobile viewport.

This is a dedicated acceptance journey so a skipped branch in the broad browser
harness cannot silently turn the pagination check green. It reuses the same
disposable game server and navigation helpers as verify-browser.py.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
PAGE_SIZE = 20


def load_browser_harness():
    path = ROOT / "scripts" / "verify-browser.py"
    spec = importlib.util.spec_from_file_location("ngl_verify_browser_harness", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the shared browser acceptance helpers.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


FIXTURE_SCRIPT = r"""() => {
  const key = 'ngl.common-ground.v2';
  const state = JSON.parse(localStorage.getItem(key));
  if (!state || !Array.isArray(state.events) || !Number.isSafeInteger(state.revision)) {
    throw new Error('Private world fixture is missing a valid event history.');
  }
  const existing = state.events.filter(event =>
    event?.type === 'moonshot-proposed' &&
    typeof event.actor?.id === 'string' &&
    ['founder', 'witness'].includes(event.actor?.role)
  );
  if (!existing.length) throw new Error('A retained Moonshot proposal template is required.');
  const actor = existing[0].actor;
  const actorExisting = existing.filter(event =>
    event.actor?.id === actor.id && event.actor?.role === actor.role
  );
  const expectedIds = actorExisting.map(event => event.id);
  if (expectedIds.some(id => typeof id !== 'string') ||
      new Set(expectedIds).size !== expectedIds.length) {
    throw new Error('Existing actor-bound proposal IDs are not unique.');
  }
  const template = actorExisting[0];
  const expectedTotal = Math.max(35, actorExisting.length);
  const addCount = expectedTotal - actorExisting.length;
  const prefix = 'quest-preview-' + state.revision + '-' + state.events.length;
  let lastAt = Date.parse(state.events.at(-1)?.at || new Date().toISOString());
  if (!Number.isFinite(lastAt)) lastAt = Date.now();

  for (let index = 0; index < addCount; index += 1) {
    const sequence = index + 1;
    const id = prefix + '-event-' + sequence;
    const moonshotId = prefix + '-moonshot-' + sequence;
    state.events.push({
      ...template,
      id,
      moonshotId,
      at: new Date(lastAt + sequence * 1000).toISOString(),
      title: 'Pagination fixture ' + sequence
    });
    expectedIds.push(id);
  }

  state.revision += addCount;
  if (addCount) state.updatedAt = new Date(lastAt + addCount * 1000).toISOString();
  localStorage.setItem(key, JSON.stringify(state));
  return {
    actorId: actor.id,
    actorRole: actor.role,
    expectedIds,
    expectedTotal,
    added: addCount,
    baseline: {
      revision: state.revision,
      xp: state.xp,
      eventIds: state.events.map(event => event.id)
    }
  };
}"""


STATE_SNAPSHOT_SCRIPT = r"""() => {
  const state = JSON.parse(localStorage.getItem('ngl.common-ground.v2'));
  if (!state) throw new Error('Private world state disappeared.');
  return {
    revision: state.revision,
    xp: state.xp,
    eventIds: state.events.map(event => event.id)
  };
}"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        default="artifacts/browser-acceptance/quest-evidence-preview.json"
    )
    args = parser.parse_args()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    screenshot = out.with_name("quest-evidence-preview-320.png")
    harness = load_browser_harness()
    errors = []
    page = None
    result = None

    try:
        with tempfile.TemporaryDirectory(prefix="ngl-quest-evidence-preview-") as data:
            process, url = harness.launch_server(data)
            try:
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(
                        executable_path=os.environ.get(
                            "NGL_CHROMIUM_EXECUTABLE", "/usr/bin/chromium"
                        ),
                        args=["--no-sandbox"]
                    )
                    try:
                        context = browser.new_context(
                            viewport={"width": 320, "height": 844},
                            is_mobile=True,
                            has_touch=True,
                            reduced_motion="reduce",
                            accept_downloads=True
                        )
                        try:
                            page = context.new_page()
                            page.on("pageerror", lambda error: errors.append(str(error)))
                            page.goto(url, wait_until="networkidle")
                            page.get_by_role(
                                "button", name="Play your world", exact=True
                            ).click()
                            page.locator("#world").wait_for(state="visible")
                            page.locator("#places-button").click()
                            harness.walk_to_location(page, "Moonshot Field")
                            page.wait_for_function(
                                "() => document.querySelector('#sheet-title')?.textContent === 'Moonshot Field'"
                            )
                            page.locator("#moonshot-title").fill(
                                "Can the Quest Board retain every page?"
                            )
                            page.locator("#moonshot-hypothesis").fill(
                                "The player can inspect a bounded preview and still reach every retained event."
                            )
                            page.locator("#moonshot-falsifier").fill(
                                "An older retained event cannot be reached or the rendered order diverges."
                            )
                            page.locator("#moonshot-evidence").fill(
                                "Exact actor-bound event IDs and the unchanged local world projection."
                            )
                            page.locator("#propose-moonshot").click()
                            page.wait_for_function(
                                "() => document.querySelector('#sheet')?.textContent.includes('PROPOSED')"
                            )
                            harness.close_sheet(page)

                            fixture = page.evaluate(FIXTURE_SCRIPT)
                            if fixture["expectedTotal"] <= PAGE_SIZE:
                                raise AssertionError(
                                    "Fixture did not create enough retained proposals to exercise pagination."
                                )

                            page.reload(wait_until="networkidle")
                            page.get_by_role(
                                "button", name="Play your world", exact=True
                            ).click()
                            page.locator("#world").wait_for(state="visible")
                            objective_id = fixture["actorRole"] + "-moonshot-proposal"
                            page.wait_for_function(
                                "(id) => Boolean(document.querySelector('[data-objective-id="' + id + '"]'))",
                                arg=objective_id
                            )
                            objective = page.locator(
                                '[data-objective-id="' + objective_id + '"]'
                            )
                            if objective.count() != 1:
                                raise AssertionError(
                                    "The actor-bound Moonshot objective is not uniquely rendered."
                                )
                            if str(fixture["expectedTotal"]) + " retained event" not in (
                                objective.text_content() or ""
                            ):
                                raise AssertionError(
                                    "The objective count does not match the retained actor-bound proposals."
                                )

                            before = page.evaluate(STATE_SNAPSHOT_SCRIPT)
                            if before != fixture["baseline"]:
                                raise AssertionError(
                                    "Reload changed the fixture's revision, XP, or retained event IDs."
                                )

                            disclosure = objective.locator("details.quest-evidence")
                            if disclosure.count() != 1:
                                raise AssertionError("The objective has no unique evidence disclosure.")
                            disclosure.locator("summary").click()

                            initial_ids = disclosure.locator(
                                "ul.quest-evidence-list li code"
                            ).all_text_contents()
                            expected_initial = fixture["expectedIds"][-PAGE_SIZE:]
                            if len(initial_ids) != PAGE_SIZE or initial_ids != expected_initial:
                                raise AssertionError(
                                    "The initial preview is not exactly the newest 20 events in append order: "
                                    + json.dumps({
                                        "actual": initial_ids,
                                        "expected": expected_initial
                                    })
                                )

                            initial_note = disclosure.locator(
                                "small.quest-evidence-preview-note"
                            ).text_content() or ""
                            if "Showing 20 of" not in initial_note:
                                raise AssertionError(
                                    "The preview note does not disclose the bounded initial page."
                                )

                            older_pages = 0
                            older_button = disclosure.locator("button.quest-evidence-more")
                            while older_button.count():
                                older_button.click()
                                older_pages += 1
                                if older_pages > fixture["expectedTotal"]:
                                    raise AssertionError(
                                        "Older-evidence pagination did not terminate."
                                    )

                            final_ids = disclosure.locator(
                                "ul.quest-evidence-list li code"
                            ).all_text_contents()
                            if final_ids != fixture["expectedIds"]:
                                raise AssertionError(
                                    "Paging did not recover every retained event exactly once in append order."
                                )
                            if len(set(final_ids)) != len(final_ids):
                                raise AssertionError(
                                    "Paging rendered duplicate retained event IDs."
                                )

                            final_note = disclosure.locator(
                                "small.quest-evidence-preview-note"
                            ).text_content() or ""
                            if "All " + str(fixture["expectedTotal"]) + " retained event details are loaded." not in final_note:
                                raise AssertionError(
                                    "The final preview note does not confirm that all retained details are loaded."
                                )

                            after = page.evaluate(STATE_SNAPSHOT_SCRIPT)
                            if after != before:
                                raise AssertionError(
                                    "Opening or paging the evidence disclosure mutated world revision, XP, or events."
                                )
                            if errors:
                                raise AssertionError(
                                    "Browser page errors occurred: " + "; ".join(errors)
                                )

                            page.screenshot(path=str(screenshot), full_page=True)
                            result = {
                                "journey": "quest-evidence-preview-320",
                                "passed": True,
                                "viewport": 320,
                                "objectiveId": objective_id,
                                "retainedEvents": fixture["expectedTotal"],
                                "fixtureEventsAdded": fixture["added"],
                                "initialPageSize": len(initial_ids),
                                "initialNewestOrderPreserved": initial_ids == expected_initial,
                                "olderPagesLoaded": older_pages,
                                "allEventsReachableInAppendOrder": final_ids == fixture["expectedIds"],
                                "noDuplicateRows": len(set(final_ids)) == len(final_ids),
                                "worldRevisionUnchanged": after["revision"] == before["revision"],
                                "worldXpUnchanged": after["xp"] == before["xp"],
                                "eventHistoryUnchanged": after["eventIds"] == before["eventIds"],
                                "pageErrors": errors
                            }
                            out.write_text(json.dumps(result, indent=2) + "\n")
                            print(json.dumps(result), flush=True)
                        finally:
                            context.close()
                    finally:
                        browser.close()
            finally:
                harness.stop_server(process)
    except Exception as error:
        if page is not None:
            try:
                page.screenshot(path=str(screenshot), full_page=True)
            except Exception:
                pass
        failure = {
            "journey": "quest-evidence-preview-320",
            "passed": False,
            "error": str(error),
            "pageErrors": errors
        }
        out.write_text(json.dumps(failure, indent=2) + "\n")
        print(json.dumps(failure), flush=True)
        raise


if __name__ == "__main__":
    main()
