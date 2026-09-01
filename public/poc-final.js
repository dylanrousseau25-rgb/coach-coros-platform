(() => {
  // La V3 collaborative est la seule source de vérité pour les bilans hebdomadaires.
  // L'ancien automatisme de coach-polish ne doit jamais appliquer une séance sans validation.
  window.applyWeeklyPlanReview = async function legacyWeeklyReviewDisabled() {
    return null;
  };

  // Toute mutation importante doit être reflétée dans la continuité locale du POC.
  // Cela protège le prototype mono-appareil contre le recyclage du /tmp Vercel.
  const previousFetch = window.fetch.bind(window);
  window.fetch = async function pocFinalFetch(input, init) {
    const response = await previousFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      if (!response.ok || !url.includes('/api/')) return response;

      const deleted = method === 'DELETE' && url.match(/\/api\/objectives\/([^/?]+)/);
      if (deleted) {
        window.coachPlanContinuity?.markDeleted(decodeURIComponent(deleted[1]));
      }

      const shouldCapture = method !== 'GET' &&
        !/\/api\/plans\/continuity\/restore/.test(url) &&
        !/\/api\/coros\/disconnect/.test(url) &&
        (/\/api\/objectives(?:\/|$)/.test(url) ||
         /\/api\/plans(?:\/|$)/.test(url) ||
         /\/api\/sessions(?:\/|$)/.test(url) ||
         /\/api\/feedback(?:\?|$)/.test(url) ||
         /\/api\/coach(?:\?|$)/.test(url) ||
         /\/api\/coros\/sync(?:\?|$)/.test(url));

      if (shouldCapture) {
        setTimeout(() => window.coachPlanContinuity?.capture(), 40);
      }
    } catch (error) {
      console.warn('[POC continuity]', error);
    }
    return response;
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
