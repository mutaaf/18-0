# Where this is served, and what knows the address

The game is at **<https://18-0.co>**, served by Vercel from `main`. The GitHub
Pages build at `mutaaf.github.io/18-0` is kept as a mirror.

Two deployments of one page is the fact that shapes everything below. They must
agree on which of them is the real address, or they compete as duplicates in
search and a share of the wrong one reads as a different site. `18-0.co` is
canonical, both builds say so, and `scripts/verify/web-head.mjs` fails the build
if either stops saying it.

## The two builds

| | Vercel | GitHub Pages |
|---|---|---|
| Address | `18-0.co` (root) | `mutaaf.github.io/18-0` (subpath) |
| Base path | none | `EXPO_BASE_URL=/18-0` |
| Config | `vercel.json` | `.github/workflows/pages.yml` |
| Role | canonical | mirror |

**Nothing in `public/` may hard-code a base path.** `manifest.webmanifest` used
to carry `"start_url": "/18-0/"`, which is correct on exactly one of the two:
installed from the other, the app opens on a 404. `start_url` and `scope` are
relative (`"./"`) so they resolve against wherever the manifest was served from,
and `id` is omitted so it defaults to `start_url` — which is what it already
resolved to, so nobody's installed copy changed identity.

`vercel.json` also does the two things GitHub Pages cannot: rewrites unmatched
routes to `index.html` so a deep link survives a refresh, and serves `/privacy`
without the `.html`. Rewrites run only after the filesystem is checked, so real
files still win.

## DNS, at Namecheap

| Type | Host | Value |
|---|---|---|
| `A` | `@` | `216.198.79.1` |
| `CNAME` | `www` | `cname.vercel-dns.com.` |

Nameservers stay Namecheap BasicDNS (`dns1`/`dns2.registrar-servers.com`).

**The apex is canonical and `www` redirects to it (308), not the other way
round.** Vercel's "Add Domain" dialog offers the opposite as "recommended" and
it is checked by default — take it and every visitor lands on `www.18-0.co`
while the canonical tag says `18-0.co`, and, worse, the OAuth round trip comes
back to an origin that is not in the Supabase allow list, so signing in fails
after the player has already consented.

Adding the `A` record right after deleting Namecheap's parking `URL Redirect`
on `@` takes a while to appear — the `www` CNAME went live in seconds and the
apex took considerably longer. It is worth checking with
`dig +short @dns1.registrar-servers.com 18-0.co A` rather than assuming a typo.

## What holds the address, outside this repo

Changing the domain means changing all of these, and none of them is in git:

- **Supabase → Authentication → URL Configuration.** Site URL is `https://18-0.co`.
  Redirect URLs include `https://18-0.co` and `https://18-0.co/**`, alongside
  `eighteenzero://auth-callback`, the Pages mirror and localhost. The web flow
  redirects back to the exact page it started from, so an origin missing from
  that list fails *after* consent.
- **Supabase → Edge Functions → Secrets: `ALLOWED_ORIGIN`.** A comma-separated
  list, read once in `functions/_shared/observability.ts`. This is the setting
  that breaks the *game* rather than just sign-in, and it breaks it silently:
  the domain moved while this still named only `mutaaf.github.io`, so every
  `spin`, `select`, `complete-game` and `delete-account` call from `18-0.co`
  was refused by the browser as a CORS mismatch while the leaderboard kept
  working — leaderboard reads go through PostgREST, which has its own policy.
  Current value: `https://18-0.co,https://mutaaf.github.io,http://localhost:8082`.
  `scripts/verify/e2e.mjs` now asserts all three, so a domain that falls off
  this list fails the harness instead of just failing players.
- **Google Cloud → Auth Platform → Branding** (project `eighteen-zero-game`).
  Home page, privacy policy link, and `18-0.co` in Authorized domains.
- **App Store Connect and Play Console.** Marketing URL and privacy policy URL;
  see [`submission.md`](submission.md).

The OAuth *callback* is unaffected: it is
`https://keqwdtnyotdovrtcswel.supabase.co/auth/v1/callback` and is registered
with Apple's Services ID and Google's OAuth client. Moving the game's domain
does not touch it, which is why this was not a provider change. Putting the
callback on `auth.18-0.co` would be — it needs Supabase's paid custom-domain
add-on and a re-registration at both providers.

## The privacy policy is served here now

`apps/mobile/public/privacy.html` is the real policy, as static HTML, at
`18-0.co/privacy`. It used to be a meta-refresh stub pointing at
`digitalcraftai.com/privacy`, and that was wrong in a way nothing surfaced: the
publisher's site renders its policy text in JavaScript, so the URL registered
with Apple, Google Play and the Google OAuth consent screen served a marketing
shell with no policy in it to anything that does not run scripts — which is
exactly what a store reviewer's crawler and Google's consent-screen checker
are.

The verifier now fails the build if a `<script>` appears on that page or its
word count collapses. Changing what the game sends means changing that page in
the same pass; see [`analytics.md`](analytics.md).
