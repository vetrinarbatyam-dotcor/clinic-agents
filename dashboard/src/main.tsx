import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import Home from './pages/Home';
import AgentConfig from './pages/AgentConfig';
import ApprovalQueue from './pages/ApprovalQueue';
import DebtPage from './pages/DebtPage';
import VaccineReminders from './pages/VaccineReminders';
import PetConnect from './pages/PetConnect';
import Warehouse from './pages/Warehouse';
import MarpetReminder from './pages/MarpetReminder';
import AppointmentBooker from './pages/AppointmentBooker';
import AppointmentReminder from './pages/AppointmentReminder';
import WhatsAppHealth from './pages/WhatsAppHealth';
import GreenApi from './pages/GreenApi';
import WhatsAppDB from './pages/WhatsAppDB';
import ClaudeCLI from './pages/ClaudeCLI';
import DealCalculator from './pages/DealCalculator';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Home />} />
          <Route path="agent/:agentId" element={<AgentConfig />} />
          <Route path="queue/:agentId" element={<ApprovalQueue />} />
          <Route path="debts" element={<DebtPage />} />
          <Route path="vaccine" element={<VaccineReminders />} />
          <Route path="petconnect" element={<PetConnect />} />
          <Route path="warehouse" element={<Warehouse />} />
          <Route path="marpet" element={<MarpetReminder />} />
          <Route path="whatsapp" element={<WhatsAppHealth />} />
          <Route path="green-api" element={<GreenApi />} />
          <Route path="whatsapp-db" element={<WhatsAppDB />} />
          <Route path="appointment-booker" element={<AppointmentBooker />} />
          <Route path="appointment-reminder" element={<AppointmentReminder />} />
          <Route path="cli" element={<ClaudeCLI />} />
          <Route path="deal-calculator" element={<DealCalculator />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
