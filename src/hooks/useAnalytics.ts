// src/hooks/useAnalytics.ts
export const useAnalytics = () => {
  const getSessionId = () => {
    let id = localStorage.getItem('abakus_session');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('abakus_session', id);
    }
    return id;
  };

  const trackEvent = (event: string, metadata: object = {}) => {
    // Your specific Webhook URL from the screenshot
    const ENDPOINT = 'https://webhook.site/52fd93c2-d87a-4ced-a7e4-261e6b04f699';
    
    const payload = JSON.stringify({
      sessionId: getSessionId(),
      event,
      timestamp: new Date().toISOString(),
      ...metadata,
    });

    // Use sendBeacon for background reliability, fallback to fetch
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, payload);
    } else {
      fetch(ENDPOINT, {
        method: 'POST',
        mode: 'no-cors', 
        headers: { 'Content-Type': 'text/plain' },
        body: payload
      }).catch(() => {});
    }
  };

  return { trackEvent };
};