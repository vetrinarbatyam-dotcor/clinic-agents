import { useState, useRef, useCallback } from 'react';

const CLI_PIN = import.meta.env.VITE_CLI_PIN || '';

const AGENTS = [
  { name: 'clinic-agents', path: '/home/claude-user/clinic-agents', icon: '🏠', label: 'בסיס — clinic-agents' },
  { name: 'appointment-reminder', path: '/home/claude-user/clinic-agents/appointment-reminder', icon: '⏰', label: 'תזכורות תורים' },
  { name: 'vaccine-reminders', path: '/home/claude-user/clinic-agents/vaccine-reminders', icon: '💉', label: 'תזכורות חיסון' },
  { name: 'remind-agent', path: '/home/claude-user/clinic-agents/remind-agent', icon: '🔔', label: 'תזכורות חוזרות' },
  { name: 'debt-agent', path: '/home/claude-user/clinic-agents/debt-agent', icon: '💰', label: 'גבייה' },
  { name: 'followup-agents', path: '/home/claude-user/clinic-agents/followup-agents', icon: '📋', label: 'פולואפ' },
  { name: 'petconnect', path: '/home/claude-user/clinic-agents/petconnect', icon: '📱', label: 'פטקונקט' },
  { name: 'marpet-reminder', path: '/home/claude-user/clinic-agents/marpet-reminder', icon: '🛡️', label: 'מרפט תזכורות' },
  { name: 'marpet-audit', path: '/home/claude-user/clinic-agents/marpet-audit', icon: '📊', label: 'מרפט ביקורת' },
  { name: 'data-warehouse', path: '/home/claude-user/clinic-agents/data-warehouse', icon: '🗄️', label: 'מאגר נתונים' },
  { name: 'dashboard', path: '/home/claude-user/clinic-agents/dashboard', icon: '📈', label: 'דשבורד' },
  { name: 'shared', path: '/home/claude-user/clinic-agents/shared', icon: '🔧', label: 'שיתופי' },
  { name: 'clinic-pal-hub', path: '/home/claude-user/clinic-pal-hub', icon: '🐾', label: 'clinic-pal-hub (פורטל)' },
];

export default function ClaudeCLI() {
  const [authed, setAuthed] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const ttydBase = `http://${window.location.hostname}:7681`;

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === CLI_PIN) {
      setAuthed(true);
      setPinError(false);
    } else {
      setPinError(true);
      setPin('');
    }
  };

  const toggleFullscreen = useCallback(() => {
    if (!isFullscreen && containerRef.current) {
      containerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  if (!authed) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" dir="rtl">
        <form onSubmit={handlePinSubmit} className="bg-white rounded-2xl border shadow-lg p-8 w-full max-w-sm text-center">
          <div className="text-5xl mb-4">⚡</div>
          <h1 className="text-xl font-bold mb-1">Claude Code CLI</h1>
          <p className="text-sm text-gray-500 mb-6">הזן PIN לגישה לטרמינל</p>
          <input
            type="password"
            value={pin}
            onChange={e => { setPin(e.target.value); setPinError(false); }}
            placeholder="PIN"
            autoFocus
            className={`w-full text-center text-2xl tracking-[0.3em] px-4 py-3 border-2 rounded-xl outline-none transition ${
              pinError ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-violet-500'
            }`}
          />
          {pinError && <p className="text-red-500 text-sm mt-2">PIN שגוי</p>}
          <button
            type="submit"
            className="mt-4 w-full py-3 bg-violet-600 text-white rounded-xl font-medium hover:bg-violet-700 transition"
          >
            כניסה
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <span className="text-3xl">⚡</span>
            Claude Code CLI
          </h1>
          <p className="text-sm text-gray-500 mt-1">פתח סשן Claude Code ועבוד ישירות על הסוכנים מהדפדפן</p>
        </div>
        <div className="flex gap-2">
          <a href={ttydBase} target="_blank" rel="noopener noreferrer"
            className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition">
            🔗 פתח בחלון חדש
          </a>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm p-4">
        <h2 className="font-semibold text-sm text-gray-600 mb-3">בחר סוכן לעבוד עליו:</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {AGENTS.map(agent => (
            <button key={agent.name} onClick={() => setSelected(agent.name)}
              className={`text-right px-3 py-2.5 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
                selected === agent.name ? 'bg-violet-100 text-violet-800 ring-2 ring-violet-400' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
              }`}>
              <span className="text-lg">{agent.icon}</span>
              <span>{agent.label}</span>
            </button>
          ))}
        </div>
        {selected && (
          <div className="mt-3 flex items-center gap-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            <span className="font-mono">{AGENTS.find(a => a.name === selected)?.path}</span>
            <span className="text-gray-300">|</span>
            <span>בטרמינל למטה, הקלד: <code className="bg-gray-200 px-1.5 py-0.5 rounded font-mono">cd {AGENTS.find(a => a.name === selected)?.path} && claude</code></span>
          </div>
        )}
      </div>

      <div ref={containerRef}
        className={`bg-gray-900 rounded-xl overflow-hidden shadow-lg border border-gray-700 ${isFullscreen ? 'fixed inset-0 z-50 rounded-none' : ''}`}>
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
            </div>
            <span className="text-gray-400 text-xs font-mono mr-3">
              claude-user@contabo{selected && ` — ${selected}`}
            </span>
          </div>
          <button onClick={toggleFullscreen}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition">
            {isFullscreen ? '⬜ צמצם' : '⬛ מסך מלא'}
          </button>
        </div>
        <iframe ref={iframeRef} src={ttydBase}
          className={`w-full bg-black ${isFullscreen ? 'h-[calc(100vh-40px)]' : 'h-[600px]'}`}
          style={{ border: 'none' }} title="Claude Code Terminal" />
      </div>

      <div className="bg-violet-50 rounded-xl border border-violet-200 p-4 text-sm text-violet-800" dir="rtl">
        <h3 className="font-bold mb-2">טיפים מהירים</h3>
        <ul className="space-y-1 list-disc list-inside">
          <li>הטרמינל מחובר ישירות לשרת — כל שינוי הוא אמיתי</li>
          <li>הקלד <code className="bg-violet-100 px-1 rounded">claude</code> כדי להתחיל סשן Claude Code</li>
          <li>השתמש ב-<code className="bg-violet-100 px-1 rounded">cd ~/clinic-agents/[agent-name]</code> לניווט בין סוכנים</li>
          <li><code className="bg-violet-100 px-1 rounded">claude --dangerously-skip-permissions</code> למצב NL</li>
          <li>הסשן נשמר — גם אם תסגור את הדף, תוכל לחזור</li>
        </ul>
      </div>
    </div>
  );
}
