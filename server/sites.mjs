// Curated official destinations, not guessed domains. Keep exact-name matching:
// a query about a brand (for example "Spotify premium price") is still a query.
export const SITES = Object.freeze({
  youtube: 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com',
  amazon: 'https://www.amazon.in', flipkart: 'https://www.flipkart.com', wikipedia: 'https://www.wikipedia.org',
  github: 'https://github.com', linkedin: 'https://www.linkedin.com', irctc: 'https://www.irctc.co.in',
  spotify: 'https://open.spotify.com/', netflix: 'https://www.netflix.com/in/', reddit: 'https://www.reddit.com/',
  instagram: 'https://www.instagram.com/', facebook: 'https://www.facebook.com/',
  whatsapp: 'https://web.whatsapp.com/', bing: 'https://www.bing.com/', duckduckgo: 'https://duckduckgo.com/',
  stackoverflow: 'https://stackoverflow.com/',
});

const ALIASES = Object.freeze({
  'you tube': 'youtube', 'g mail': 'gmail', 'google mail': 'gmail', 'git hub': 'github', 'linked in': 'linkedin',
  'spot ify': 'spotify', 'net flix': 'netflix', 'face book': 'facebook', 'insta gram': 'instagram',
  'whats app': 'whatsapp', 'duck duck go': 'duckduckgo', 'stack overflow': 'stackoverflow',
});

export function namedSite(value) {
  const name = String(value || '').trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+(?:website|site)$/, '').replace(/\s+/g, ' ');
  const canonical = ALIASES[name] || name;
  return Object.hasOwn(SITES, canonical) ? [canonical, SITES[canonical]] : null;
}
