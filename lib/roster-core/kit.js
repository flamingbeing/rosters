// The UI kit (app-ui: @core/theme and @core/ui) for the roster apps that are on it, at one exact version. Look A by
// default, each app's own accent, and the Look, theme and density choices for its Settings screen; the roster grids
// use the kit's data grid. Loaded with import() so a page that cannot reach core.anawj.com still works on its own
// styles (the kit only adds to them). One copy for the apps; what differs (the accent) is an option.
//
// startKit({ accent }): paints this device's look, theme and density choice with the app's accent on the 'cool' ground
//   (the NUHS kit's #f2f2f7; kit.css maps the NUHS kit's colours to the kit's, so the default look is the original's).
// kitSwitch(host): the kit's Look, theme and density switch, appended to host (the app's Settings screen).
// rosterGrid(table, { onSelect }): starts the kit's data grid on a table.ui-data-grid (keys, one Tab stop, select).
// KIT_CSS: only the kit styles these apps use (the tokens and base, the data grid), imported into a cascade layer
//   (index.html) so their base rules on bare elements (button, h1, body) never win over the NUHS kit or style.css. Not
//   ui.css, glass.css or gestures.css: their older bare class names (.bar, .sheet, .chip, .small) would restyle the
//   apps' own bars and sheets, which stay on the NUHS kit until the screens move to the kit's shell.
//   The apps' own custom properties carry an r- prefix (--r-muted, --r-line): the kit's palette sets the plain names.
// KIT_SHELL: every kit file the page loads (styles, early.js, the modules and what they import), for sw.js SHELL;
//   test/precache.test.mjs checks it against the tagged source.
export const KIT_VERSION = '1.0.0-rc.29';
export const KIT = `https://core.anawj.com/ui/${KIT_VERSION}/`;
export const KIT_CSS = ['theme/theme.css', 'ui/layout.css'];
export const KIT_MODULES = ['theme/choice.js', 'theme/colour.js', 'theme/grid.js', 'theme/guard.js', 'theme/index.js', 'theme/looks.js', 'theme/looks/a.js', 'theme/looks/b.js', 'theme/looks/c.js', 'theme/looks/d.js', 'theme/looks/e.js', 'theme/motion.js', 'theme/palette-css.js', 'theme/presets.js', 'theme/schema.js', 'theme/switch.js', 'ui/data-grid.js'];
export const KIT_SHELL = ['theme/early.js', ...KIT_CSS, ...KIT_MODULES].map(f => KIT + f);

let theme = null;
const loadTheme = () => (theme ||= import(KIT + 'theme/index.js'));

/** @param {{ accent?: string }} [o] */
export async function startKit({ accent } = {}) {
  try { (await loadTheme()).applyTheme({ accent, surface: 'cool' }); } catch (e) { console.warn('UI kit not loaded', e); theme = null; }
}

/** @param {HTMLElement} host */
export async function kitSwitch(host) {
  try { (await loadTheme()).themeSwitch(host); } catch (e) { console.warn('UI kit not loaded', e); theme = null; host.hidden = true; }
}

/** @param {HTMLTableElement} table @param {{ onSelect?: (pick: object) => void }} [o] */
export async function rosterGrid(table, o) {
  try { return (await import(KIT + 'ui/data-grid.js')).dataGrid(table, o); } catch (e) { console.warn('UI kit not loaded', e); return null; }
}
