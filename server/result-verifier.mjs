const words = value => String(value || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const normalizedHost = value => { try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return ''; } };

export class ResultVerifier {
  verifyTarget(expected = {}, context = {}) {
    if (expected.host && normalizedHost(context.url) !== normalizedHost(`https://${expected.host}`)) return { verified: false, reason: 'destination-host-mismatch' };
    if (expected.pathPattern && !new RegExp(expected.pathPattern, 'i').test(new URL(context.url).pathname)) return { verified: false, reason: 'destination-path-mismatch' };
    if (expected.identifier && !new RegExp(`\\b${String(expected.identifier).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(`${context.url}\n${context.pageText || ''}`)) return { verified: false, reason: 'identifier-mismatch' };
    const requiredWords = words(expected.title).filter(word => word.length > 2);
    if (requiredWords.length && !requiredWords.every(word => words(`${context.title || ''} ${context.pageText || ''}`).includes(word))) return { verified: false, reason: 'title-mismatch' };
    return { verified: true, reason: 'target-observed' };
  }

  verifyConstraint(constraint = {}, observed = {}) {
    if (Number.isFinite(constraint.maxPrice) && (!Number.isFinite(observed.price) || observed.price > constraint.maxPrice)) return { verified: false, reason: 'price-constraint-failed' };
    if (Number.isFinite(constraint.minRating) && (!Number.isFinite(observed.rating) || observed.rating < constraint.minRating)) return { verified: false, reason: 'rating-constraint-failed' };
    return { verified: true, reason: 'constraints-observed' };
  }

  verifyFinalState(expected, context, constraint, observed) {
    const target = this.verifyTarget(expected, context); if (!target.verified) return target;
    const constraints = this.verifyConstraint(constraint, observed); if (!constraints.verified) return constraints;
    if (context.challenge?.detected) return { verified: false, reason: 'human-verification-still-present' };
    return { verified: true, reason: 'final-state-verified' };
  }

  verifyTask(input) { return this.verifyFinalState(input.expected, input.context, input.constraint, input.observed); }
}
