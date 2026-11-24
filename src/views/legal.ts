// Privacy policy and imprint (Austria: §5 E-Commerce-Gesetz, §25 Mediengesetz).

import { setTitle } from "../ui";

const SITE_OPERATOR = {
  name: "Julian Reil",
  street: "Peter-Behrens-Platz 6",
  city: "4020 Linz",
  country: "Austria",
  email: "brainwormbrood@gmail.com",
};
const operatorAddress = `${SITE_OPERATOR.street}<br>${SITE_OPERATOR.city}<br>${SITE_OPERATOR.country}`;
const operatorEmail = `<a href="mailto:${SITE_OPERATOR.email}">${SITE_OPERATOR.email}</a>`;

export function renderPrivacy(root: HTMLElement) {
  setTitle("Privacy policy");
  root.innerHTML = `
    <article class="page prose">
      <h1>Privacy policy</h1>
      <p class="lede">What we store about you, and how to get it deleted.</p>

      <h2>Who is responsible</h2>
      <p>${SITE_OPERATOR.name}<br>${operatorAddress}<br>${operatorEmail}</p>

      <h2>Using the site</h2>
      <p>Forever Forge has no accounts and sets no cookies. Your crafting list and the skill you enter on a profession page
        are kept in your browser's local storage and never sent to us; a crafting list you share lives only in the link.</p>
      <p>Our host, Cloudflare, processes technical request data such as IP addresses to deliver the site and protect it from abuse.
        Item icons load from Blizzard Entertainment's image servers, which also receive your IP address.</p>
      <p>If you send a bug report, we store your message, the page address, your browser (user agent), screen size and the game build
        shown, plus your email address if you enter one. We use it only to fix the problem and, if you asked, to reply.
        Reports are deleted after 12 months at the latest. Your IP address is kept for at most 24 hours to stop spam.</p>

      <h2>Former accounts</h2>
      <p>Until November 2026 the site offered accounts for saving talent builds. That feature was retired. If you had an
        account and want its data (username, email address, saved builds) deleted now, write to us at ${SITE_OPERATOR.email}.</p>

      ${
        import.meta.env.VITE_ADSENSE_CLIENT
          ? `<h2>Advertising</h2>
      <p>Forever Forge is funded by ads served by Google AdSense. Google may use cookies to show and measure ads.
        Personalized ads are only shown if you agree in the consent dialog, and you can change your choice at any time.
        See <a href="https://policies.google.com/technologies/ads" rel="noopener">how Google uses data for ads</a>.</p>`
          : `<h2>Advertising</h2>
      <p>Forever Forge shows no third-party ads and loads no ad or tracking scripts. The highlighted boxes on some pages
        point to other parts of this site or to our Ko-fi page.</p>`
      }

      <h2>Donations</h2>
      <p>The "Support on Ko-fi" links take you to Ko-fi, which handles donations under its own
        <a href="https://more.ko-fi.com/privacy" rel="noopener">privacy policy</a>. Nothing from Ko-fi is loaded on this site
        until you click. If you donate, we see what Ko-fi shows us, usually your name or nickname and your message.</p>

      <h2>Your rights</h2>
      <p>You have the right to access, correct, restrict and port your data, to object to processing, and to complain
        to a data protection authority. Contact us at ${SITE_OPERATOR.email}.</p>
    </article>`;
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
        Basic direction: information about crafting and professions in the game World of Warcraft: Forever.</p>
      <h2>Disclaimer</h2>
      <p>Forever Forge is a fan project and is not affiliated with or endorsed by Blizzard Entertainment.
        World of Warcraft and related names and images are trademarks of Blizzard Entertainment, Inc.
        Game data is read from the public game client (the beta until WoW Forever launches) and may be incomplete or change at any time.</p>
    </article>`;
}
