const ASIN = /^[A-Z0-9]{10}$/;
const ACCESSORY = /\b(?:decal|skin|sticker|screen\s*protector|bag|sleeve|stand|charger|adapter|keyboard|mouse|cover|case|replacement|brochure|booklet|paper|oil)\b/i;
const HARDWARE = /\b(?:\d{1,2}\s*GB|\d(?:\.\d)?\s*TB|\d{3,4}\s*GB\s*(?:SSD|HDD)|SSD|HDD|Core\s+i[3579]|Ryzen\s+[3579]|Celeron|Pentium|Snapdragon\s+X|Windows\s*1[01]|ChromeBook|MacBook|laptop|notebook)\b/i;

export function verifiedAmazonProductUrl(raw, expectedAsin) {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    const asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
    if (url.protocol !== 'https:' || host !== 'amazon.in' || url.username || url.password || !asin || asin !== expectedAsin) return '';
    return `https://www.amazon.in/dp/${asin}`;
  } catch { return ''; }
}

export function isLaptopTitle(title) {
  const value = String(title || '');
  return /\blaptop|notebook|chromebook|macbook\b/i.test(value) && HARDWARE.test(value) && !ACCESSORY.test(value);
}

export function normalizeAmazonCandidate(candidate) {
  const asin = String(candidate?.asin || '').toUpperCase();
  const title = String(candidate?.title || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const price = Number(candidate?.price);
  const url = ASIN.test(asin) ? verifiedAmazonProductUrl(candidate?.url, asin) : '';
  const rating = Number(candidate?.rating);
  const ratingCount = Number(candidate?.ratingCount);
  const confidence = Math.max(0, Math.min(1, Number(candidate?.confidence) || 0));
  return {
    asin, title, price, currency: candidate?.currency === 'INR' ? 'INR' : '',
    rating: Number.isFinite(rating) ? rating : null,
    ratingCount: Number.isFinite(ratingCount) ? Math.max(0, Math.trunc(ratingCount)) : null,
    url, sponsored: candidate?.sponsored === true, position: Number.isFinite(Number(candidate?.position)) ? Number(candidate.position) : null,
    confidence, ref: /^c\d+$/.test(candidate?.ref || '') ? candidate.ref : '', availability: String(candidate?.availability || '').slice(0, 100),
    bbox: candidate?.bbox && ['x','y','width','height'].every(key => Number.isFinite(Number(candidate.bbox[key]))) ? Object.fromEntries(['x','y','width','height'].map(key => [key, Math.round(Number(candidate.bbox[key]))])) : null
  };
}

export function selectAmazonCandidates(rawCandidates, maximumPrice) {
  const rejected = { sponsored: 0, identity: 0, price: 0, productType: 0 };
  const byAsin = new Map();
  for (const raw of rawCandidates || []) {
    const item = normalizeAmazonCandidate(raw);
    if (item.sponsored) { rejected.sponsored++; continue; }
    if (!ASIN.test(item.asin) || !item.url || !item.ref || item.confidence < 0.65) { rejected.identity++; continue; }
    if (!Number.isFinite(item.price) || item.price <= 0 || item.price > maximumPrice || item.currency !== 'INR') { rejected.price++; continue; }
    if (!isLaptopTitle(item.title)) { rejected.productType++; continue; }
    const previous = byAsin.get(item.asin);
    if (!previous || item.confidence > previous.confidence || (item.confidence === previous.confidence && item.title.length > previous.title.length)) byAsin.set(item.asin, item);
  }
  const candidates = [...byAsin.values()].sort((a, b) => a.price - b.price || b.confidence - a.confidence || (a.position ?? Infinity) - (b.position ?? Infinity));
  return { candidates, rejected };
}

export function verifyAmazonProductDetail(expected, detail, maximumPrice) {
  const asin = String(detail?.asin || '').toUpperCase();
  const title = String(detail?.title || '').replace(/\s+/g, ' ').trim();
  const price = Number(detail?.price);
  if (!expected || asin !== String(expected.asin || '').toUpperCase()) return { verified: false, reason: 'final-asin-mismatch' };
  if (!verifiedAmazonProductUrl(detail?.url, asin)) return { verified: false, reason: 'final-url-mismatch' };
  if (!isLaptopTitle(title)) return { verified: false, reason: 'final-product-type-mismatch' };
  if (!Number.isFinite(price) || price <= 0 || price > maximumPrice) return { verified: false, reason: 'final-price-mismatch' };
  const expectedWords = String(expected.title || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  const actual = title.toLowerCase();
  if (expectedWords.length && !expectedWords.slice(0, 4).some(word => actual.includes(word))) return { verified: false, reason: 'final-title-mismatch' };
  return { verified: true, reason: 'asin-title-price-product-verified', price, title };
}

export function amazonDiagnostic(rawCandidates, maximumPrice, selected = null, verificationPassed = false) {
  const normalized = (rawCandidates || []).map(normalizeAmazonCandidate);
  const { candidates } = selectAmazonCandidates(rawCandidates, maximumPrice);
  return {
    pageLoaded: true, candidatesFound: normalized.length,
    candidatesWithAsin: normalized.filter(item => ASIN.test(item.asin)).length,
    candidatesWithPrice: normalized.filter(item => Number.isFinite(item.price) && item.price > 0).length,
    organicCandidates: normalized.filter(item => !item.sponsored).length,
    qualifyingCandidates: candidates.length,
    selectedAsin: selected?.asin || '', selectedPrice: Number.isFinite(selected?.price) ? selected.price : null,
    verificationPassed: verificationPassed === true
  };
}
