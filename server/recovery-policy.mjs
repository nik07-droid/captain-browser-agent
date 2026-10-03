export const FailureReason = Object.freeze({
  ELEMENT_NOT_FOUND: 'ELEMENT_NOT_FOUND', STALE_ELEMENT: 'STALE_ELEMENT', PAGE_LOADING: 'PAGE_LOADING',
  NAVIGATION_CHANGED: 'NAVIGATION_CHANGED', NETWORK_ERROR: 'NETWORK_ERROR', CAPTCHA: 'CAPTCHA',
  RATE_LIMIT: 'RATE_LIMIT', SPONSORED_RESULT: 'SPONSORED_RESULT', NO_RESULT: 'NO_RESULT',
  MODEL_INVALID: 'MODEL_INVALID', PRIVATE_FIELD: 'PRIVATE_FIELD', UNKNOWN: 'UNKNOWN'
});

const POLICIES = Object.freeze({
  ELEMENT_NOT_FOUND: ['REOBSERVE', 'SEMANTIC_MATCH', 'OCR', 'VISION'],
  STALE_ELEMENT: ['REOBSERVE', 'REBUILD_CONTEXT'],
  PAGE_LOADING: ['ADAPTIVE_WAIT', 'DOM_STABILITY_CHECK', 'MEANINGFUL_CONTENT_CHECK'],
  NAVIGATION_CHANGED: ['REOBSERVE', 'VERIFY_DESTINATION'],
  NETWORK_ERROR: ['BOUNDED_BACKOFF', 'REOBSERVE'],
  CAPTCHA: ['HUMAN_HANDOFF'], RATE_LIMIT: ['STOP_AND_REPORT'],
  SPONSORED_RESULT: ['REJECT_REDIRECT', 'CHOOSE_VERIFIED_ORGANIC_RESULT'],
  NO_RESULT: ['REFORMULATE_ONCE', 'REPORT_PARTIAL'], MODEL_INVALID: ['DETERMINISTIC_PLANNER', 'FAIL_SAFE'],
  PRIVATE_FIELD: ['REQUEST_LOCAL_INPUT'], UNKNOWN: ['REOBSERVE', 'FAIL_SAFE']
});

export function recoveryStrategies(reason) { return [...(POLICIES[reason] || POLICIES.UNKNOWN)]; }
export function classifyFailure(input) {
  const text = String(input?.message || input || '');
  if (/captcha|human verification|robot check|bot challenge/i.test(text)) return FailureReason.CAPTCHA;
  if (/rate limit|too many requests|\b429\b/i.test(text)) return FailureReason.RATE_LIMIT;
  if (/sponsored|advertis/i.test(text)) return FailureReason.SPONSORED_RESULT;
  if (/sensitive field|credential|password|otp|cvv|token/i.test(text)) return FailureReason.PRIVATE_FIELD;
  if (/target not found|element not found/i.test(text)) return FailureReason.ELEMENT_NOT_FOUND;
  if (/stale|detached|changed while executing/i.test(text)) return FailureReason.STALE_ELEMENT;
  if (/loading|not become readable|timed out/i.test(text)) return FailureReason.PAGE_LOADING;
  if (/network|dns|connection|fetch failed/i.test(text)) return FailureReason.NETWORK_ERROR;
  if (/destination|navigation|redirect/i.test(text)) return FailureReason.NAVIGATION_CHANGED;
  if (/invalid action|malformed|structured action/i.test(text)) return FailureReason.MODEL_INVALID;
  if (/no (?:safe |qualifying |verified )?(?:result|match|product)/i.test(text)) return FailureReason.NO_RESULT;
  return FailureReason.UNKNOWN;
}

export function classifyPageChange(before = {}, after = {}) {
  if (after.challenge?.detected) return 'BLOCKED';
  if (before.url !== after.url) return 'NAVIGATION';
  if (before.pageMetadata?.domFingerprint === after.pageMetadata?.domFingerprint && before.pageMetadata?.visibleTextHash === after.pageMetadata?.visibleTextHash) return 'NO_CHANGE';
  if (after.pageMetadata?.meaningfulContent === false) return 'LOADING';
  return 'EXPECTED_CHANGE';
}
