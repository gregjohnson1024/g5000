/**
 * nav-sections.ts — Section model for the Phase-2 NavShell.
 *
 * Six intent sections (SAIL / CHART / ANCHOR / CONDITIONS / VOYAGE / BOAT)
 * matching the proposal IA (§6). Task 3: all hrefs point at canonical new URLs
 * (route-tree tasks 2a–2f complete). Settings-gated tabs (Tides/Currents) are
 * defined here with canadianGated:true and filtered in NavShell.
 */

export interface SectionTab {
  href: string;
  label: string;
  /** If true, this tab is hidden until settings.canadianTideCurrents resolves true. */
  canadianGated?: boolean;
}

export interface Section {
  id: string;
  label: string;
  /** Primary href — the section chip navigates here. */
  href: string;
  /** Sub-nav tabs. Empty = no SectionTabs row (e.g. CHART uses the dock instead). */
  tabs: SectionTab[];
  /** If true, the SectionTabs row is suppressed even when tabs is non-empty. */
  hideSectionTabs?: boolean;
}

export const SECTIONS: readonly Section[] = [
  {
    id: 'sail',
    label: 'SAIL',
    href: '/sail',
    tabs: [
      { href: '/sail', label: 'Helm' },
      { href: '/sail/race', label: 'Race' },
      { href: '/sail/autopilot', label: 'Autopilot' },
      { href: '/mast', label: 'Mast' },
    ],
  },
  {
    id: 'chart',
    label: 'CHART',
    href: '/chart',
    tabs: [],
    // Chart uses the dock as sub-nav; the SectionTabs row is absent.
    hideSectionTabs: true,
  },
  {
    id: 'anchor',
    label: 'ANCHOR',
    href: '/anchor',
    tabs: [],
    // Anchor has its own drawer; no SectionTabs row per spec.
    hideSectionTabs: true,
  },
  {
    id: 'conditions',
    label: 'CONDITIONS',
    href: '/conditions',
    tabs: [
      { href: '/conditions', label: 'Forecast' },
      { href: '/conditions/tides', label: 'Tides', canadianGated: true },
      { href: '/conditions/currents', label: 'Currents', canadianGated: true },
      { href: '/conditions/models', label: 'Models' },
      { href: '/conditions/windows', label: 'Windows' },
    ],
  },
  {
    id: 'voyage',
    label: 'VOYAGE',
    href: '/voyage',
    tabs: [
      { href: '/voyage', label: 'Passage' },
      { href: '/voyage/plan', label: 'Plan' },
      { href: '/voyage/logbook', label: 'Logbook' },
      { href: '/voyage/tracker', label: 'Tracker' },
    ],
  },
  {
    id: 'boat',
    label: 'BOAT',
    href: '/boat',
    tabs: [
      { href: '/boat/polars', label: 'Polars' },
      { href: '/boat/sails', label: 'Sails' },
      { href: '/boat/crossover', label: 'Crossover' },
      { href: '/boat/setup', label: 'Setup' },
      { href: '/boat/diag', label: 'Diagnostics' },
    ],
  },
];

/** All canonical hrefs across every section and tab for longest-prefix matching. */
const ALL_SECTION_HREFS: readonly string[] = [
  ...SECTIONS.map((s) => s.href),
  ...SECTIONS.flatMap((s) => s.tabs.map((t) => t.href)),
];

/**
 * Longest-prefix match against ALL section hrefs.
 * Returns the href whose prefix matches the pathname most specifically.
 * Ported from Navbar.tsx bestMatchHref.
 */
export function bestMatchHref(pathname: string | null): string | null {
  if (!pathname) return null;
  let best: string | null = null;
  for (const href of ALL_SECTION_HREFS) {
    if (pathname === href || pathname.startsWith(href + '/')) {
      if (best === null || href.length > best.length) best = href;
    }
  }
  return best;
}

/**
 * Returns the active Section for a given pathname, or null if none.
 * A section is active when its primary href OR any of its tabs' hrefs
 * is the best match for pathname.
 */
export function activeSection(pathname: string | null): Section | null {
  const active = bestMatchHref(pathname);
  if (!active) return null;
  for (const section of SECTIONS) {
    if (section.href === active || section.tabs.some((t) => t.href === active)) {
      return section;
    }
  }
  return null;
}

/**
 * Pathnames where the SectionTabs row is hidden entirely.
 * Derived from sections that either have no tabs or set hideSectionTabs.
 */
export function shouldHideSectionTabs(pathname: string | null): boolean {
  const section = activeSection(pathname);
  if (!section) return false;
  return !!(section.hideSectionTabs || section.tabs.length === 0);
}
