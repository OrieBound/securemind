/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { TOUR_BUTTON_VISITS, hideTourButton, parseStored, registerVisit, shouldShowTourButton } from "@/lib/client/tour-button";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("tour button in the header", () => {
  it("shows for the first few visits, then goes away on its own", () => {
    const seen: boolean[] = [];
    for (let visit = 1; visit <= TOUR_BUTTON_VISITS + 2; visit++) {
      sessionStorage.clear(); // a new browser session is a new visit
      seen.push(registerVisit("a@x.com"));
    }
    expect(seen).toEqual([true, true, true, false, false]);
  });

  it("does not count a page reload as another visit", () => {
    for (let i = 0; i < 10; i++) expect(registerVisit("a@x.com")).toBe(true);
  });

  it("can be closed early, and stays closed", () => {
    expect(registerVisit("a@x.com")).toBe(true);
    hideTourButton("a@x.com");
    sessionStorage.clear();
    expect(registerVisit("a@x.com")).toBe(false);
  });

  it("is counted per account", () => {
    hideTourButton("a@x.com");
    expect(registerVisit("b@x.com")).toBe(true);
  });

  it("copes with a damaged stored value", () => {
    expect(parseStored("{nope")).toEqual({ visits: 0, hidden: false });
    expect(shouldShowTourButton(parseStored(null))).toBe(true);
  });
});
