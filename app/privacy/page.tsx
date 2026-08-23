import type { Metadata } from "next";
import LegalPage from "../legal-page";
import { SITE_NAME, SITE_URL } from "../site";

const description = "How HackMusic collects, uses, stores, and shares information for private music parties.";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description,
  alternates: { canonical: `${SITE_URL}/privacy` },
  openGraph: { title: `${SITE_NAME} Privacy Policy`, description, url: `${SITE_URL}/privacy`, images: [] },
  twitter: { title: `${SITE_NAME} Privacy Policy`, description, images: [] },
};

const sections = [
  {
    id: "scope",
    title: "Who we are & scope",
    content: <>
      <p>HackMusic is a small, experimental web service operated from New Jersey, United States. In this policy, “HackMusic,” “we,” “us,” and “our” refer to the operator of hackmusic.fun.</p>
      <p>This policy applies to the HackMusic website, temporary event rooms, host controls, and related support communications. It does not replace the privacy policies of Spotify, OpenAI, or other services you choose to use with HackMusic.</p>
    </>,
  },
  {
    id: "collection",
    title: "Information we collect",
    content: <>
      <h3>Information you provide</h3>
      <ul>
        <li>Event names and participant display names.</li>
        <li>Spotify track links and the resulting track title, artist, duration, and Spotify track identifier.</li>
        <li>Cheers, boos, queue choices, scores, and other event actions.</li>
        <li>Your email address and message if you contact us directly.</li>
      </ul>
      <h3>Information created while the service runs</h3>
      <ul>
        <li>Random room, participant, submission, reaction, activity, and host-control identifiers.</li>
        <li>Event status, queue order, timestamps, reaction history, and final scores.</li>
        <li>Basic request and security information that our hosting and network providers may process, such as IP address, browser/device details, request logs, and error information.</li>
      </ul>
      <p>We do not ask for a HackMusic account, legal name, postal address, phone number, or payment information during normal play.</p>
    </>,
  },
  {
    id: "use",
    title: "How we use information",
    content: <>
      <p>We use information only to provide and protect the service: create and operate rooms, remember participants and the host device, validate Spotify tracks, control authorized playback, calculate scores, display event history, prevent abuse, diagnose failures, answer support requests, and comply with law.</p>
      <p>We do not sell personal data. We do not use event data for targeted advertising, cross-site behavioral profiling, credit decisions, employment decisions, or other legally significant automated decisions.</p>
    </>,
  },
  {
    id: "cookies",
    title: "Cookies & device storage",
    content: <>
      <p>HackMusic uses only storage that is required to make the requested features work. We do not use advertising cookies, analytics cookies, tracking pixels, or cross-site marketing cookies.</p>
      <div className="legal-callout">
        <strong>🍪 Necessary means necessary.</strong>
        <span>No ad-tech confetti is hiding behind the real confetti.</span>
      </div>
      <ul>
        <li><strong>Spotify OAuth cookie:</strong> a short-lived, HTTP-only cookie keeps the Spotify sign-in request secure for about 10 minutes.</li>
        <li><strong>Spotify session cookie:</strong> an HTTP-only, secure cookie keeps the host’s authorized Spotify connection available for up to 30 days, or until the host disconnects it. It contains Spotify access credentials and required connection details and is not available to page scripts.</li>
        <li><strong>Local browser storage:</strong> participant IDs, the host key, and the host’s public Spotify Client ID are stored on that device so the browser can recognize its room role. Clearing site data removes them from the device and may lock that browser out of host controls.</li>
        <li><strong>Infrastructure storage:</strong> OpenAI Sites and its infrastructure providers may use strictly necessary security, routing, authentication, load-balancing, or fraud-prevention technologies.</li>
      </ul>
      <p>You can clear cookies and local storage through your browser. Blocking necessary storage may prevent room recognition, host access, or Spotify playback.</p>
    </>,
  },
  {
    id: "spotify",
    title: "Spotify connection",
    content: <>
      <p>A host may voluntarily connect a Spotify Premium account using Spotify’s authorization screen. HackMusic requests the permissions needed for streaming, account eligibility, playback state, and playback control. We use the resulting authorization to run the shared speaker and do not intentionally display or store the host’s Spotify email or private profile information in the HackMusic event database.</p>
      <p>Spotify controls its own service and data practices. Review the <a href="https://www.spotify.com/legal/privacy-policy/" target="_blank" rel="noreferrer">Spotify Privacy Policy ↗</a>. Disconnecting Spotify from the host page removes HackMusic’s Spotify cookies on that device; you can also revoke access from your Spotify account settings.</p>
    </>,
  },
  {
    id: "sharing",
    title: "When information is shared",
    content: <>
      <p>We disclose information only as reasonably necessary to:</p>
      <ul>
        <li>OpenAI Sites and infrastructure/service providers that host, secure, route, store, and operate HackMusic.</li>
        <li>Spotify, when a track is validated or the host authorizes and controls playback.</li>
        <li>Other people in the same event room. Display names, cheers, tracks, event history, and scores may be visible as described in the interface; boo identities are hidden from participant views.</li>
        <li>Professional advisers, authorities, or other parties when reasonably necessary to comply with law, protect rights and safety, investigate abuse, or handle a business transfer.</li>
      </ul>
      <p>Service providers may process information in the United States or other locations where they operate, subject to their own safeguards and legal obligations.</p>
    </>,
  },
  {
    id: "retention",
    title: "Retention & security",
    content: <>
      <p>Event records currently may remain in our hosted database until they are manually deleted, deleted during operational cleanup, or removed after a valid request. We do not promise a fixed automatic deletion date. Spotify cookies expire as described above or can be removed by disconnecting or clearing site data.</p>
      <p>We use reasonable measures such as HTTPS, randomized room/participant identifiers, device-held host keys, HTTP-only Spotify cookies, limited data collection, and restricted host controls. No online service is perfectly secure. Keep room links private, do not reuse sensitive information as a display name, and protect the host device.</p>
    </>,
  },
  {
    id: "rights",
    title: "Your privacy choices & rights",
    content: <>
      <p>Depending on where you live, you may have rights to know or access personal data, correct it, delete it, receive a portable copy, withdraw consent, or appeal a decision about a request. New Jersey residents may exercise applicable rights under New Jersey law. Because we do not sell personal data or use it for targeted advertising or legally significant profiling, there is no sale or targeted-advertising opt-out to process.</p>
      <p>Email <a href="mailto:hackmusic.fun@gmail.com">hackmusic.fun@gmail.com</a> with the room code, approximate event date, display name, requested action, and enough information to verify the request without sending unnecessary sensitive data. Use “Privacy Appeal” in the subject line to appeal a response. We may retain limited information when legally required or necessary for security and dispute handling.</p>
    </>,
  },
  {
    id: "children",
    title: "Children",
    content: <>
      <p>HackMusic is a general-audience service and is not directed to children under 13. Children under 13 may not submit information to HackMusic. If you are under the age of legal majority where you live, use HackMusic only with permission and supervision from a parent, guardian, or event organizer.</p>
      <p>If you believe a child under 13 provided information, email <a href="mailto:hackmusic.fun@gmail.com">hackmusic.fun@gmail.com</a> so we can investigate and delete it where appropriate.</p>
    </>,
  },
  {
    id: "third-parties",
    title: "Third-party services",
    content: <>
      <p>Third-party services—including Spotify, OpenAI Sites, infrastructure providers, browsers, networks, and connected speakers—are governed by their own terms and privacy practices. We do not control their independent collection, availability, security, policy changes, outages, or acts and omissions.</p>
      <p>Links to third-party sites are provided for convenience and do not make HackMusic responsible for those sites. This policy covers only information controlled by HackMusic.</p>
    </>,
  },
  {
    id: "changes",
    title: "Changes & contact",
    content: <>
      <p>We may update this policy as the service or law changes. The updated date at the top shows the latest revision. Material changes may also be highlighted on the website where practical.</p>
      <p>Questions, corrections, deletion requests, or complaints: <a href="mailto:hackmusic.fun@gmail.com">hackmusic.fun@gmail.com</a>.</p>
    </>,
  },
];

export default function PrivacyPage() {
  return <LegalPage eyebrow="🔐 YOUR DATA, MINUS THE DRAMA" title="Privacy Policy" summary="The short version: we collect what the party needs, skip ad tracking, and keep private event routes away from search bots." accent="mint" sections={sections} />;
}
