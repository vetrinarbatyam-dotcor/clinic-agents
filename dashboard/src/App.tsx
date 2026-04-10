import { useState } from 'react';
import { Outlet, Link } from 'react-router-dom';

const DASHBOARD_EMAIL = 'vetcenter85@gmail.com';
const DASHBOARD_PIN = 'bond007';

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email === DASHBOARD_EMAIL && pin === DASHBOARD_PIN) {
      setAuthed(true);
      setError(false);
    } else {
      setError(true);
      setPin('');
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <form onSubmit={handleLogin} className="bg-white rounded-2xl border shadow-lg p-8 w-full max-w-sm text-center">
          <div className="text-5xl mb-4">🐾</div>
          <h1 className="text-xl font-bold mb-1">Clinic Agents</h1>
          <p className="text-sm text-gray-500 mb-6">הזן מייל וקוד כניסה</p>
          <input
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(false); }}
            placeholder="אימייל"
            autoFocus
            className={`w-full text-center px-4 py-3 border-2 rounded-xl outline-none transition mb-3 ${
              error ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-emerald-500'
            }`}
          />
          <input
            type="password"
            value={pin}
            onChange={e => { setPin(e.target.value); setError(false); }}
            placeholder="PIN"
            className={`w-full text-center text-2xl tracking-[0.3em] px-4 py-3 border-2 rounded-xl outline-none transition ${
              error ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-emerald-500'
            }`}
          />
          {error && <p className="text-red-500 text-sm mt-2">מייל או PIN שגויים</p>}
          <button
            type="submit"
            className="mt-4 w-full py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition"
          >
            כניסה
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-4">
          <Link to="/" className="text-xl font-bold text-emerald-700 flex items-center gap-2">
            <span className="text-2xl">🐾</span>
            Clinic Agents
          </Link>
          <span className="text-sm text-gray-400">ניהול סוכנים אוטומטיים</span>
          <div className="flex-1" />
          <Link to="/whatsapp" className="px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-sm font-medium hover:bg-green-100 transition">WhatsApp</Link>
          <Link to="/green-api" className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition">💬 Green API</Link>
          <Link to="/whatsapp-db" className="px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg text-sm font-medium hover:bg-teal-100 transition">📱 ארכיון WA</Link>
          <Link to="/appointment-booker" className="px-3 py-1.5 bg-pink-50 text-pink-700 rounded-lg text-sm font-medium hover:bg-pink-100 transition">
            📅 קביעת תורים
          </Link>
          <Link to="/marpet" className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition">
            💉 מרפט
          </Link>
          <Link to="/debts" className="px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-sm font-medium hover:bg-red-100 transition">
            💰 גבייה
          </Link>
          <Link to="/petconnect" className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-100 transition">
            📱 פטקונקט
          </Link>
          <Link to="/cli" className="px-3 py-1.5 bg-violet-50 text-violet-700 rounded-lg text-sm font-medium hover:bg-violet-100 transition">⚡ CLI</Link>
          <Link to="/warehouse" className="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-100 transition">🗄️ מאגר</Link>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
