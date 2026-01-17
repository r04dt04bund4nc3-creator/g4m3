// src/components/layout/Shell.tsx
import React from 'react';

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        position: 'relative',
        overflow: 'hidden',
        color: '#fff',
      }}
    >
      {children}
    </div>
  );
}