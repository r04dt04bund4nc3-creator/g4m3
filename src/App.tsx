// src/App.tsx
import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppProvider } from './state/AppContext';
import { useAnalytics } from './hooks/useAnalytics';

import { Shell } from './components/layout/Shell';
import { UploadPage } from './pages/UploadPage';
import InstrumentPage from './pages/InstrumentPage';
import ResultPage from './pages/ResultPage';
import AuthCallbackPage from './pages/AuthCallbackPage'; // New import

function App() {
  const { trackEvent } = useAnalytics();

  useEffect(() => {
    // Track initial landing
    trackEvent('visit', { path: window.location.pathname });
  }, []);

  return (
    <AppProvider>
      <Routes>
        <Route
          path="/"
          element={
            <Shell>
              <UploadPage />
            </Shell>
          }
        />
        <Route
          path="/instrument"
          element={
            <Shell>
              <InstrumentPage />
            </Shell>
          }
        />
        <Route
          path="/result"
          element={
            <Shell>
              <ResultPage />
            </Shell>
          }
        />
        // Auth callback route - no Shell wrapper needed for this temporary page
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
      </Routes>
    </AppProvider>
  );
}

export default App;