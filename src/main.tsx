import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { anzeigeAnwenden } from './anzeige';
import { brueckeEinrichten } from './bruecke';
import { Start } from './views/Anmelden';
import { Leisten } from './Leisten';

brueckeEinrichten();
// Platform-specific layout tweaks (macOS window buttons sit inside the header).
document.documentElement.dataset.plattform = window.hv.plattform;
anzeigeAnwenden();

createRoot(document.getElementById('root')!).render(<Start>{(s) => <><App benutzer={s.benutzer} /><Leisten status={s} /></>}</Start>);
