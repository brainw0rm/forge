// Privacy policy and imprint (Austria: §5 E-Commerce-Gesetz, §25 Mediengesetz).

import { setTitle } from "../ui";

const SITE_OPERATOR = {
  name: "Julian Reil",
  street: "Herrenstrasse 23",
  city: "4020 Linz",
  country: "Austria",
  email: "wowforeverforge@gmail.com",
};
const operatorAddress = `${SITE_OPERATOR.street}<br>${SITE_OPERATOR.city}<br>${SITE_OPERATOR.country}`;
const operatorEmail = `<a href="mailto:${SITE_OPERATOR.email}">${SITE_OPERATOR.email}</a>`;

export function renderPrivacy(root: HTMLElement) {
  setTitle("Privacy policy");
  root.innerHTML = `
    <article class="page prose">
      <h1>Privacy policy</h1>
      <p class="lede">What Forever Forge stores about you, why, and how to get rid of it.</p>

      <h2>Who is responsible</h2>
      <p>${SITE_OPERATOR.name}<br>${operatorAddress}<br>${operatorEmail}</p>

      <h2>Without an account</h2>
      <p>You can use the talent calculator, changelog and community builds without an account. Your builds live in the page
        address you share. A small preference (whether the changes lens is on) is kept in your browser's local storage and never sent to us.</p>
      <p>Our host, Cloudflare, processes technical request data such as IP addresses to deliver the site and protect it from abuse.
        Talent icons load from Blizzard Entertainment's image servers, which also receive your IP address.</p>
      <p>If you send a bug report, we store your message, the page address, your browser (user agent), screen size and the game build
        shown, plus your email address if you enter one and your username if you're signed in. We use it only to fix the problem and,
        if you asked, to reply. Resolved reports are deleted after 30 days, and every report after 12 months at the latest.</p>
      <p>The News page lists headlines from other websites. We load nothing from those sites when you view it; only when you
        open a headline does your browser go to the publisher's site, whose privacy policy then applies.</p>

      <h2>With an account</h2>
      <ul>
        <li><b>Account data:</b> username, email address and a salted hash of your password (we never store the password itself).</li>
        <li><b>Emails:</b> we send only account emails (address confirmation and password resets) through our email provider, Resend.
          The one-time links in them expire after 48 hours and 1 hour respectively.</li>
        <li><b>Your content:</b> builds you save and ratings you give. Public builds and your username are visible to everyone.</li>
        <li><b>Session cookie:</b> one strictly necessary cookie (<code>ff_session</code>) keeps you signed in for up to 30 days.</li>
        <li><b>Abuse protection:</b> IP addresses of sign-in attempts are kept for at most 24 hours to rate-limit password guessing.</li>
        <li><b>Reports:</b> if you report a build, moderators see your username, the reason and your note.</li>
        <li><b>Change alerts:</b> if you watch a class or build, we store what you watch and email you when a new game build changes it.
          Every alert email has a one-click unsubscribe link.</li>
      </ul>
      <p>The legal basis is the contract you enter by creating an account (Art. 6(1)(b) GDPR) and our legitimate interest in
        keeping the service secure (Art. 6(1)(f) GDPR).</p>

      <h2>Advertising</h2>
      <p>Forever Forge is funded by ads served by Google AdSense. Google may use cookies to show and measure ads.
        Personalized ads are only shown if you agree in the consent dialog, and you can change your choice at any time.
        See <a href="https://policies.google.com/technologies/ads" rel="noopener">how Google uses data for ads</a>.</p>

      <h2>Your rights</h2>
      <p>You can delete your account, builds and ratings at any time from <a href="/account" data-link>My account</a>.
        You also have the right to access, correct, restrict and port your data, to object to processing, and to complain
        to a data protection authority. Contact us at ${SITE_OPERATOR.email}.</p>
    </article>`;
}

export function renderUnsubscribe(root: HTMLElement, params: URLSearchParams, unsubscribe: (u: number, t: string) => Promise<unknown>) {
  setTitle("Unsubscribe");
  const u = Number(params.get("u"));
  const t = params.get("t") ?? "";
  root.innerHTML = `
    <section class="auth-page"><div class="auth-card" id="card">
      <h1>Stop change alerts?</h1>
      <p class="muted">You won't get any more emails about talent changes. You can watch classes and builds again at any time.</p>
      <div class="form-actions"><button class="btn primary block" id="confirm">Stop all change alerts</button></div>
    </div></section>`;
  root.querySelector("#confirm")!.addEventListener("click", async () => {
    const card = root.querySelector("#card")!;
    try {
      await unsubscribe(u, t);
      card.innerHTML = `<h1>You're unsubscribed</h1><p class="muted">No more change alerts. Nothing else about your account changed.</p>`;
    } catch (err) {
      card.innerHTML = `<h1>That link didn't work</h1><p class="muted">${(err as Error).message}</p>
        <p class="muted">You can also manage alerts from <a href="/account" data-link>your account</a>.</p>`;
    }
  });
}

export function renderImprint(root: HTMLElement) {
  setTitle("Imprint");
  root.innerHTML = `
    <article class="page prose">
      <h1>Imprint</h1>
      <h2>Operator</h2>
      <p>${SITE_OPERATOR.name}<br>${operatorAddress}</p>
      <h2>Contact</h2>
      <p>${operatorEmail}</p>
      <h2>Disclosure under §25 Mediengesetz</h2>
      <p>Media owner: ${SITE_OPERATOR.name}, ${SITE_OPERATOR.city.replace(/^\S+\s+/, "")}, ${SITE_OPERATOR.country}.<br>
        Basic direction: information and planning tools about the game World of Warcraft: Forever (talent builds,
        game data, community builds and news headlines).</p>
      <h2>Disclaimer</h2>
      <p>Forever Forge is a fan project and is not affiliated with or endorsed by Blizzard Entertainment.
        World of Warcraft and related names and images are trademarks of Blizzard Entertainment, Inc.
        Game data is read from the public game client (the beta until WoW Forever launches) and may be incomplete or change at any time.</p>
      <p>Community builds are written by their authors; we are not responsible for their content but remove unlawful
        content promptly once we learn of it.</p>
    </article>`;
}
