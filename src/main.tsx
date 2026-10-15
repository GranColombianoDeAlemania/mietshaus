import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { anzeigeAnwenden } from './anzeige';

// Platform-specific layout tweaks (macOS window buttons sit inside the header).
document.documentElement.dataset.plattform = window.hv?.plattform ?? 'web';
anzeigeAnwenden();

createRoot(document.getElementById('root')!).render(<App />);
