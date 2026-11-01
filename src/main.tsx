import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { anzeigeAnwenden } from './anzeige';
import { brueckeEinrichten } from './bruecke';
import { Start } from './views/Anmelden';
import { Leisten } from './Leisten';

brueckeEinrichten();
// The service worker keeps the page for starting without a connection (not needed for the Mac's own local server).
if ('serviceWorker' in navigator && !window.hvDesktop?.lokal) navigator.serviceWorker.register('/sw.js').catch(() => {});
// Platform-specific layout tweaks (macOS window buttons sit inside the header).
document.documentElement.dataset.plattform = window.hv.plattform;
anzeigeAnwenden();

createRoot(document.getElementById('root')!).render(<Start>{(s) => <><App benutzer={s.benutzer} /><Leisten status={s} /></>}</Start>);
