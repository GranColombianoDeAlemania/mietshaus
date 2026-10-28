// Notifications on this device. Browser / home-screen app: Web Push through the service worker (works with the page
// closed). Mac app: the server's notes arrive over the open connection and become macOS notifications.
import { anfrage } from './bruecke';

export const ARTEN: [string, string][] = [['postfach', 'Neue Dokumente im Postfach'], ['aufgaben', 'Mir zugewiesene Vorgänge'],
  ['morgen', 'Morgenübersicht (ab 7 Uhr)'], ['sicherung', 'Probleme mit der Sicherung']];

const lesen = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

export const pushMoeglich = () => !window.hvDesktop && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPhone/iPad: only an app added to the home screen may receive pushes.
export const homeBildschirmNoetig = () => /iPhone|iPad/.test(navigator.userAgent) && !(navigator as { standalone?: boolean }).standalone
  && !matchMedia('(display-mode: standalone)').matches;

const sw = () => navigator.serviceWorker.register('/sw.js');

export async function pushAbo(): Promise<PushSubscription | null> {
  if (!pushMoeglich()) return null;
  return (await sw()).pushManager.getSubscription();
}

export async function pushEinschalten(arten: string[]) {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Mitteilungen sind für Mietshaus nicht erlaubt (Systemeinstellungen des Geräts bzw. Browsers).');
  const reg = await sw();
  const { schluessel } = await (await anfrage('/api/push/schluessel')).json();
  const roh = Uint8Array.from(atob(schluessel.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const abo = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: roh });
  await anfrage('/api/push/abo', { json: { abo: abo.toJSON(), arten } });
}

export async function pushAusschalten() {
  const abo = await pushAbo();
  if (!abo) return;
  await anfrage('/api/push/abmelden', { json: { endpoint: abo.endpoint } });
  await abo.unsubscribe();
}

// Mac app: show the server's notes as macOS notifications while the window is not in front (setting per device).
export function desktopMitteilungen(benutzerId: number | null) {
  if (!window.hvDesktop) return () => {};
  return window.hv.bei('benachrichtigung', (n: { titel: string; text: string; benutzer: number | null; art: string }) => {
    if (lesen('mitteilungen') === '0' || document.hasFocus()) return;
    if (n.benutzer != null && n.benutzer !== benutzerId) return;
    new Notification(n.titel, { body: n.text, icon: '/icon-192.png' });
  });
}
