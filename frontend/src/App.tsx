import React from 'react';
import {Routes, Route, Navigate} from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Providers from './pages/Providers';
import ProxyPage from './pages/ProxyPage';
import Models from './pages/Models';
import Sessions from './pages/Sessions';
import Runs from './pages/Runs';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import NetworkProfiles from './pages/NetworkProfiles';
import Workspace from './pages/Workspace';
import Analytics from './pages/Analytics';
import ApiKeys from './pages/ApiKeys';
import AnalyticsWindow from './pages/AnalyticsWindow';
import {I18nProvider} from './i18n';

export default function App() {
  return (
    <I18nProvider>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="providers" element={<Providers />} />
          <Route path="proxy" element={<ProxyPage />} />
          <Route path="models" element={<Models />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="runs" element={<Runs />} />
          <Route path="network" element={<NetworkProfiles />} />
          <Route path="logs" element={<Logs />} />
          <Route path="workspace" element={<Workspace />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="settings" element={<Settings />} />
          <Route path="api-keys" element={<ApiKeys />} />
        </Route>
        <Route path="analytics-window" element={<AnalyticsWindow />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </I18nProvider>
  );
}
