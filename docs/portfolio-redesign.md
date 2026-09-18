# Portfolio redesign: Code & Camera

## Design and evidence

The previous homepage already had a distinctive paper-and-orange particle portrait. About and Market Lab used a disconnected dark technology style; photography required drag exploration, and Contact had nonfunctional placeholders. The redesign preserves the portrait and résumé terminal while making the three visitor journeys explicit.

One identity connects analytical work, AI-built tools, and photography: warm paper (#f4f0e8), ink (#252620), burnt orange (#ac452b), Georgia display typography, Inter/system body text, and small monospace labels. Photography uses larger uncrowded frames; tool cards explain purpose and the build without invented performance metrics or decorative market charts.

References inspected on 2026-09-18:

- https://brittanychiang.com/ — observed separate Experience, Projects, and Full Résumé access. Applied the principle of immediately discoverable professional evidence, not its layout or color identity.
- https://tobiasahlin.com/ — observed an individual introduction with separate Projects and Work. Applied clear hierarchy across multiple practices.
- https://www.alexstrohl.com/ — observed photography-led presentation. Applied image-first composition with a bounded gallery and lazy loading rather than an unlimited media stream.

These are content/structure observations and design interpretations, not claims about measured performance or animations on the reference sites.

## Implementation

- Homepage: identity first, then three numbered paths, selected working tools, photography, and a professional introduction.
- Shared navigation/footer and portfolio-scoped CSS. Desktop uses direct links; mobile uses a keyboard-operable disclosure menu. Hash destinations and market tool interfaces remain intact.
- Photography: 22 existing local photographs, subject filters, descriptive image alternatives, native dialog, original image proportions in the viewer, previous/next controls, arrow keys, Escape, and focus restoration. The two external Unsplash images are excluded from the personal journal.
- About: résumé-sourced experience, skills, education, and certifications are immediately readable. The terminal plays once and supports pause, show-all, and replay; reduced-motion visitors get its complete state.
- Contact: owner-supplied email and LinkedIn, actual PDF download, and email copying with explicit failure feedback.
- The original résumé is untouched. The served public copy is byte-identical to docs/SiuChunKung_Resume.pdf. Both copies must be updated together when the owner supplies a replacement.
- The same portrait has an optimized 433,412-byte WebP derivative, down from the 3,199,485-byte PNG. Original images are retained. Market route chunks are lazy loaded; the production entry is approximately 171 kB (55 kB gzip), with market libraries deferred.
- Three.js was considered and rejected: the existing Canvas delivers the recognizable effect with less loading and maintenance cost. Essential text and an ordinary portrait image remain if Canvas is unavailable. Motion pauses when the portrait is offscreen or the page is hidden.

## Local verification before release

- ESLint passed; TypeScript and production Vite build passed.
- `npm run test:portfolio-ui`: seven checks cover route round trips, essential pre-effect content, reduced-motion terminal/portrait state, local-only photo triggers, and the served PDF byte contract.
- Browser inspected at desktop 1440 x 1000 and mobile 390 x 844: homepage, photography, About, Contact, and Market Lab.
- Browser exercised portrait pause, mobile menu close/Escape, gallery filter, full-image viewer, next/previous, keyboard arrows, Escape, focus restoration, terminal pause/show-all/replay, email copy, and an actual résumé download event.
- Reduced-motion and unavailable-Canvas behavior were exercised in an ignored local test harness; the portrait, essential routes, and complete résumé remained accessible without runtime errors.
- PDF HTTP response was 200 with application/pdf; SHA-256 matched the original: 05a10fa2a26c56d03c8b099bd67b6b63fba4ad7a35cc054df11b2705204948ad.
- Build reports a pre-existing outdated Browserslist data notice. It does not fail compilation. Dependency versions were not changed.

No market provider, API, calculation, cache, secret, or scheduled workflow was modified. Local browser verification does not itself prove production deployment or live market availability; release evidence must be checked separately.
