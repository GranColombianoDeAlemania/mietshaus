// The guide inside an invitation package: one HTML file the invited person opens – personal, with every step and the
// links for Tailscale, Mietshaus and the one-time invitation. Works for Mac (app in the package) and iPhone / browser.
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export type Einladung = { name: string; login: string; adresse: string; token: string; bis: string; von: string; mitApp: boolean };

export const einladungsLink = (e: Einladung) => `${e.adresse}/?einladung=${encodeURIComponent(e.token)}`;
export const verbindenLink = (e: Einladung) => `mietshaus://verbinden?adresse=${encodeURIComponent(e.adresse)}&einladung=${encodeURIComponent(e.token)}`;

export function anleitungHtml(e: Einladung) {
  const bis = new Date(e.bis).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const knopf = (href: string, text: string) => `<a class="knopf" href="${esc(href)}">${esc(text)}</a>`;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mietshaus – Einladung für ${esc(e.name)}</title>
<style>
  body { font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1c2324; background: #f6efe7; margin: 0; padding: 24px; }
  main { max-width: 680px; margin: 0 auto; background: #fffaf4; border-radius: 18px; padding: 28px 30px; box-shadow: 0 8px 30px rgba(90, 42, 16, .12); }
  h1 { font-size: 26px; margin: 0 0 4px; } h2 { font-size: 18px; margin: 28px 0 8px; color: #b5491a; }
  .kopf { display: flex; gap: 14px; align-items: center; margin-bottom: 18px; } .kopf img { width: 64px; height: 64px; border-radius: 14px; }
  .knopf { display: inline-block; background: #c9521b; color: #fff; text-decoration: none; padding: 10px 16px; border-radius: 10px; font-weight: 600; margin: 4px 0; }
  .klein { font-size: 14px; color: #6b6058; } code { background: #f0e4d8; padding: 1px 6px; border-radius: 5px; }
  ol { padding-left: 22px; } li { margin: 6px 0; } .kasten { background: #fdebdc; border-radius: 10px; padding: 10px 14px; }
</style></head><body><main>
<div class="kopf"><img src="${e.mitApp ? 'logo.png' : `${esc(e.adresse)}/icon-192.png`}" alt="" onerror="this.remove()"><div>
  <h1>Hallo ${esc(e.name)}!</h1><div class="klein">${esc(e.von)} hat dich zu <b>Mietshaus</b> eingeladen, der Hausverwaltung.</div></div></div>
<p>Dein Benutzername: <code>${esc(e.login)}</code> · Die Einladung gilt bis <b>${bis}</b> und nur einmal.</p>

<h2>1. Tailscale einrichten</h2>
<p>Mietshaus läuft auf einem Server zu Hause und ist nur über <b>Tailscale</b> erreichbar – eine sichere Verbindung, ohne dass etwas im Internet offen steht.</p>
<ol>
  <li>${esc(e.von)} schickt dir eine <b>Einladung von Tailscale per E-Mail</b>. Nimm sie an.</li>
  <li>Installiere die Tailscale-App: ${knopf('https://tailscale.com/download/mac', 'für den Mac')} ${knopf('https://tailscale.com/download/ios', 'für iPhone / iPad')}</li>
  <li>Öffne Tailscale und melde dich mit dem Konto an, mit dem du die Einladung angenommen hast. Es sollte „Connected“ anzeigen.</li>
</ol>
<p class="klein">Läuft bei dir ein anderes VPN (z. B. Mullvad oder ein Firmen-VPN), trenne es, solange du Mietshaus benutzt – die beiden vertragen sich nicht.</p>

${e.mitApp ? `<h2>2. Mietshaus auf dem Mac</h2>
<ol>
  <li>Ziehe <b>Mietshaus</b> aus diesem Ordner in deinen Ordner <b>Programme</b>.</li>
  <li>Öffne Mietshaus einmal. Meldet macOS, die App sei von einem nicht verifizierten Entwickler: <b>Systemeinstellungen → Datenschutz &amp; Sicherheit → „Trotzdem öffnen“</b>.</li>
  <li>Doppelklicke danach in diesem Ordner auf <b>„Mit Mietshaus verbinden“</b> – oder auf diesen Knopf: ${knopf(verbindenLink(e), 'Mit Mietshaus verbinden')}</li>
  <li>Mietshaus fragt, ob es sich mit <code>${esc(e.adresse)}</code> verbinden soll → <b>Verbinden</b>. Dann legst du dein Passwort fest – fertig.</li>
</ol>` : `<h2>2. Mietshaus im Browser</h2>
<p>Öffne diesen Link (Tailscale muss verbunden sein) und lege dein Passwort fest: ${knopf(einladungsLink(e), 'Einladung annehmen')}</p>`}

<h2>3. Auf dem iPhone oder iPad</h2>
<ol>
  <li>Tailscale-App installieren und anmelden (siehe 1.).</li>
  <li>In Safari <code>${esc(e.adresse)}</code> öffnen und mit <code>${esc(e.login)}</code> anmelden${e.mitApp ? ' (nachdem du dein Passwort auf dem Mac festgelegt hast)' : ''}.</li>
  <li>Unten auf <b>Teilen → Zum Home-Bildschirm</b> – Mietshaus öffnest du ab jetzt wie eine App.</li>
  <li>In Mietshaus unter <b>Einstellungen</b>: <b>Mitteilungen einschalten</b> und <b>Passkey hinzufügen</b> (dann reicht Face ID statt Passwort).</li>
</ol>

<h2>Hilfe</h2>
<p class="klein">Seite lädt nicht? Prüfe, ob Tailscale „Connected“ zeigt und kein anderes VPN läuft. Einladung abgelaufen oder Passwort vergessen? ${esc(e.von)} kann dir in Mietshaus jederzeit einen neuen Link schicken.</p>
<p class="klein">Server: <code>${esc(e.adresse)}</code></p>
</main></body></html>`;
}
