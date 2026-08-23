import type { Metadata } from "next";
import LegalPage from "../legal-page";
import { SITE_NAME, SITE_URL } from "../site";

const description = "Rules and responsibilities for hosting and joining private HackMusic music parties.";

export const metadata: Metadata = {
  title: "Terms of Use",
  description,
  alternates: { canonical: `${SITE_URL}/terms` },
  openGraph: { title: `${SITE_NAME} Terms of Use`, description, url: `${SITE_URL}/terms`, images: [] },
  twitter: { title: `${SITE_NAME} Terms of Use`, description, images: [] },
};

const sections = [
  {
    id: "agreement",
    title: "Agreement & operator",
    content: <>
      <p>These Terms of Use are a legal agreement between you and the operator of HackMusic, a small experimental service operated from New Jersey, United States. By accessing hackmusic.fun, creating or joining a room, or connecting Spotify, you agree to these terms and acknowledge the Privacy Policy.</p>
      <p>If you do not agree, do not use HackMusic. Event organizers should make these terms available to participants.</p>
    </>,
  },
  {
    id: "eligibility",
    title: "Eligibility & event supervision",
    content: <>
      <p>You must be at least 13 to use HackMusic. If you are under the age of legal majority where you live, you must have permission and appropriate supervision from a parent, guardian, or event organizer. HackMusic is not directed to children under 13.</p>
      <p>The host or event organizer is responsible for the physical event, participants, speaker volume, device safety, internet access, appropriate content, and compliance with venue rules and applicable law.</p>
    </>,
  },
  {
    id: "service",
    title: "What HackMusic provides",
    content: <>
      <p>HackMusic coordinates temporary private music rooms. Participants can submit Spotify track links, react to songs, affect scores, and—after enough boos—skip a track. The host controls the shared playback device and queue mode.</p>
      <p>HackMusic does not sell music, provide ownership rights in recordings, host uploaded audio, or grant a public-performance license. Points are fictional, have no monetary value, and cannot be redeemed or transferred.</p>
    </>,
  },
  {
    id: "music",
    title: "Music, Spotify & licenses",
    content: <>
      <p>Spotify is a separate service. A compatible Spotify Premium subscription, approved developer setup, supported device, and compliance with Spotify’s terms and policies may be required. You authorize Spotify directly; HackMusic is not affiliated with, endorsed by, or sponsored by Spotify.</p>
      <p>You and the event organizer are responsible for ensuring that playback is lawful and permitted for the event and location, including any copyright, venue, public-performance, subscription, or music-licensing requirements. Private-event positioning does not itself create a license or legal exemption.</p>
      <p>Review the <a href="https://www.spotify.com/legal/end-user-agreement/" target="_blank" rel="noreferrer">Spotify Terms ↗</a> and applicable <a href="https://developer.spotify.com/terms" target="_blank" rel="noreferrer">Spotify Developer Terms ↗</a>.</p>
    </>,
  },
  {
    id: "accounts",
    title: "Rooms, host keys & devices",
    content: <>
      <p>HackMusic does not require a participant account. A host key and readable room passcode are saved in the browser that created the room. Anyone with access to that device and browser profile may be able to use host controls or reveal the passcode. Guests need both the room code and passcode to enter newly created rooms.</p>
      <p>Keep invite links, passcodes, and the host device appropriately private. We are not responsible for access caused by a shared device, forwarded invitation, exposed code or passcode, cleared storage, compromised browser, or failure to secure the connected Spotify account.</p>
    </>,
  },
  {
    id: "conduct",
    title: "Acceptable use",
    content: <>
      <p>You may use HackMusic only for lawful, private-event purposes. You may not:</p>
      <ul>
        <li>Harass, threaten, impersonate, shame, or target another person.</li>
        <li>Submit unlawful, infringing, hateful, exploitative, deceptive, or malicious content.</li>
        <li>Probe, bypass, reverse engineer, overload, scrape, automate abuse of, or interfere with the service or another room.</li>
        <li>Steal credentials, guess host keys, access rooms without permission, distribute malware, or misuse Spotify authorization.</li>
        <li>Use HackMusic for commercial broadcasting, resale, surveillance, gambling, or any purpose that violates third-party rights or terms.</li>
      </ul>
      <p>We may restrict or terminate access, remove data, or cooperate with lawful requests when reasonably necessary to protect HackMusic, users, third parties, or the public.</p>
    </>,
  },
  {
    id: "third-party",
    title: "Third-party infrastructure",
    content: <>
      <p>HackMusic depends on third parties including Spotify, OpenAI Sites, ChatGPT sign-in for the owner-only admin page, infrastructure providers, domain and network providers, browsers, operating systems, and connected speakers. Their services, content, security, pricing, availability, advertisements, subscriptions, and policies are outside our control.</p>
      <div className="legal-callout">
        <strong>🧩 Many moving pieces.</strong>
        <span>If Spotify, OpenAI infrastructure, the internet, or your speaker takes a nap, HackMusic cannot promise to wake it.</span>
      </div>
      <p>To the maximum extent permitted by law, HackMusic is not responsible for third-party acts, omissions, outages, content, data practices, account actions, service changes, or losses. Your dealings with third parties are between you and them. Nothing here limits rights or liabilities that cannot legally be waived.</p>
    </>,
  },
  {
    id: "availability",
    title: "Changes, availability & termination",
    content: <>
      <p>HackMusic is experimental and may change, break, pause, lose features, impose limits, or stop operating at any time. We do not promise uninterrupted service, permanent storage, compatibility with every device, preservation of a room or score, or continued availability of any Spotify feature.</p>
      <p>You may stop using the service at any time. The host may end a room. We may suspend access or remove rooms when reasonably necessary for security, legal compliance, abuse prevention, or service operation.</p>
    </>,
  },
  {
    id: "warranty",
    title: "Disclaimers",
    content: <>
      <p>To the maximum extent permitted by law, HackMusic is provided “as is” and “as available,” without warranties of any kind, whether express, implied, or statutory, including warranties of merchantability, fitness for a particular purpose, title, non-infringement, accuracy, security, availability, or quiet enjoyment.</p>
      <p>We do not warrant that tracks, metadata, queue order, scores, reactions, anonymity controls, playback, or third-party integrations will always be complete, accurate, private, available, or error-free. Some jurisdictions do not allow certain disclaimers, so portions of this section may not apply to you.</p>
    </>,
  },
  {
    id: "liability",
    title: "Limitation of liability",
    content: <>
      <p>To the maximum extent permitted by law, HackMusic and its operator will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost data, profits, goodwill, opportunities, device access, music access, or event enjoyment arising from or related to the service or a third party.</p>
      <p>To the maximum extent permitted by law, total aggregate liability for all claims relating to HackMusic will not exceed the greater of the amount you paid HackMusic in the 12 months before the claim or US $100. These limits do not apply to liability that cannot legally be excluded, including where applicable liability for willful misconduct or gross negligence.</p>
    </>,
  },
  {
    id: "indemnity",
    title: "Your responsibility for claims",
    content: <>
      <p>To the extent permitted by law, you agree to defend, indemnify, and hold harmless HackMusic and its operator from third-party claims, losses, liabilities, and reasonable costs arising from your unlawful use, your event, content or tracks you submit, violation of these terms, or infringement of another person’s rights.</p>
      <p>This section does not require a consumer to indemnify HackMusic for HackMusic’s own unlawful conduct where such a requirement is prohibited.</p>
    </>,
  },
  {
    id: "law",
    title: "New Jersey law & disputes",
    content: <>
      <p>These terms are governed by the laws of the State of New Jersey and applicable United States federal law, without regard to conflict-of-law principles. Subject to any mandatory consumer rights, courts located in New Jersey will have exclusive jurisdiction over disputes relating to HackMusic.</p>
      <p>Before filing a claim, please email <a href="mailto:hackmusic.fun@gmail.com">hackmusic.fun@gmail.com</a> and give us 30 days to try to resolve it informally. This does not shorten a legal limitation period or prevent either party from seeking urgent relief.</p>
    </>,
  },
  {
    id: "general",
    title: "General terms & contact",
    content: <>
      <p>If part of these terms is unenforceable, it will be adjusted or removed only as necessary and the remainder will continue. A failure to enforce a provision is not a waiver. You may not transfer these terms without our consent; we may transfer them in connection with operating or transferring the service. These terms and the Privacy Policy are the entire agreement about HackMusic unless applicable law says otherwise.</p>
      <p>We may update these terms as HackMusic or the law changes. Continued use after updated terms become effective means you accept them, to the extent permitted by law.</p>
      <p>Questions, copyright concerns, or requests for changes: <a href="mailto:hackmusic.fun@gmail.com">hackmusic.fun@gmail.com</a>.</p>
    </>,
  },
];

export default function TermsPage() {
  return <LegalPage eyebrow="📜 HOUSE RULES FOR THE HOUSE PARTY" title="Terms of Use" summary="A fair playlist still needs rules. These cover acceptable use, Spotify, third-party infrastructure, and who is responsible for the actual event." accent="blue" sections={sections} />;
}
