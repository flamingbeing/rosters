// Which folder of this repo each address serves. Pure functions, no Cloudflare APIs, so worker/test/routes.test.mjs
// can check them in Node. worker/sites.js is the Worker that uses them.
//
// A host in SITES is served only from the folders listed for it. A host not listed serves nothing, except local
// testing (localhost), which sees the repo as it is.

// host -> { prefixes: { '/app/': 'app/' } }  (several apps share the host, one path each)
//      or { root: 'app/' }                   (one app at the root; its own folder name works too; prefixes beside
//                                             root add a few extra folders)
//      or { moved: { '/old/': 'https://example.org/new/' } }  (apps now on another site: each path forwards there)
export const SITES = {
  'nuhroster.anawj.com': { root: 'nuh-roster/' },
  // NTF anaesthesia monthly duty roster (its own data, so its own host). /__/auth/ and /__/firebase/ are Firebase's
  // sign-in helper pages on this host (authDomain ntfroster.anawj.com): ntf-auth/ holds its init.json.
  'ntfroster.anawj.com': { root: 'ntf-roster/', prefixes: { '/__/auth/': '__/auth/', '/__/firebase/': 'ntf-auth/firebase/' } },
  // NUH junior monthly roster helper (cardiac and ICU calls into the department's Google Sheet; its own data)
  'nuhjuniormonthly.anawj.com': { root: 'nuh-junior-monthly/' },
};

// Worker routes (not files) per host: only these hosts answer them (each app's claims file, worker/sites.js APPS);
// elsewhere they are plain 404s.
const CLAIMS = ['/api/claims', '/api/members/sync'];
export const API = {
  'nuhjuniormonthly.anawj.com': CLAIMS,
  'nuhroster.anawj.com': CLAIMS,
  'ntfroster.anawj.com': CLAIMS,
};
export const api = (host, pathname) => {
  host = String(host || '').toLowerCase().replace(/:\d+$/, '');
  return (API[host] || []).includes(pathname) ? pathname : null;
};

// Folders every host serves as they are (shared files, no data): /lib/ holds the one copy of exceljs the three apps use.
export const SHARED = ['/lib/'];

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;

// -> { file } (a path inside the repo, or a folder ending in "/"), { redirect } (a public path, or a full address
//    on another site, to send the browser to), or { notFound: true }
export function resolve(host, pathname) {
  const out = route(host, pathname);
  // an encoded slash, dot or backslash, or a leftover ".." could point the asset lookup out of the folder: refuse
  return out.file != null && /%2e|%2f|%5c|\\|(^|\/)\.\.?(\/|$)/i.test(out.file) ? { notFound: true } : out;
}

function route(host, pathname) {
  host = String(host || '').toLowerCase().replace(/:\d+$/, '');
  const site = SITES[host], p = pathname;
  if (!site) return LOCAL.test(host) ? { file: p.replace(/^\//, '') } : { notFound: true };
  for (const dir of SHARED) {
    if (p === dir.slice(0, -1)) return { redirect: dir };
    if (p.startsWith(dir)) return { file: p.slice(1) };
  }
  if (site.moved) {
    for (const [prefix, to] of Object.entries(site.moved)) {
      if (p === prefix.slice(0, -1) || p.startsWith(prefix)) return { redirect: to + p.slice(prefix.length) };
    }
    return { notFound: true };
  }
  for (const [prefix, folder] of Object.entries(site.root ? site.prefixes || {} : {})) {
    if (p.startsWith(prefix)) return { file: folder + p.slice(prefix.length) };   // a root host's extra folders
  }
  if (site.root) {
    const own = '/' + site.root;
    if (p === own.slice(0, -1)) return { redirect: own };
    if (p.startsWith(own)) return { file: site.root + p.slice(own.length) };
    return { file: site.root + p.replace(/^\//, '') };
  }
  for (const [prefix, folder] of Object.entries(site.prefixes || {})) {
    if (p === prefix.slice(0, -1)) return { redirect: prefix };
    if (p.startsWith(prefix)) return { file: folder + p.slice(prefix.length) };
  }
  return { notFound: true };
}
