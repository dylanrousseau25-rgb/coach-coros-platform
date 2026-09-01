(() => {
  // La V3 collaborative est la seule source de vérité pour les bilans hebdomadaires.
  // L'ancien automatisme de coach-polish ne doit jamais appliquer une séance sans validation.
  window.applyWeeklyPlanReview = async function legacyWeeklyReviewDisabled() {
    return null;
  };

  async function pocAudit() {
    try {
      const response = await fetch('/api/poc/audit', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Audit POC indisponible');
      if (!body.ok) console.warn('[POC audit]', body);
      return body;
    } catch (error) {
      console.warn('[POC audit]', error);
      return null;
    }
  }

  window.coachPocAudit = pocAudit;
  setTimeout(pocAudit, 2200);
})();
