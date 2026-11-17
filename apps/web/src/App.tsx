import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/ui/Toast';
import { AuthProvider } from './features/auth/AuthContext';
import { WsProvider } from './lib/ws';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Channel } from './pages/Channel';
import { Studio } from './pages/Studio';
import { Settings } from './pages/Settings';
import { NotFound } from './pages/NotFound';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <WsProvider>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Home />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/c/:name" element={<Channel />} />
                <Route
                  path="/studio"
                  element={
                    <ProtectedRoute>
                      <Studio />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute>
                      <Settings />
                    </ProtectedRoute>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </WsProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
};
