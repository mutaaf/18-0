import { useEffect, useRef, type CSSProperties } from 'react';
import { isEmbedded } from '@/features/embed';
import { TESTFLIGHT_URL } from '@/features/links';
import { track } from '@/features/telemetry';
import { color, font } from '@/theme';
import type { ShowcaseProps } from './Showcase';

/**
 * The front page as a launch page: the download first, then the iPhone Duo
 * folding through its poses as you scroll, then the phone, then the game.
 *
 * Real DOM rather than React Native views, because the whole effect is CSS:
 * scroll-driven animations (`animation-timeline`) where the browser has them,
 * and where it does not, a small driver that scrubs the *same* keyframes by
 * setting a negative `animation-delay` from the scroll position. So there is one
 * set of keyframes and two clocks, and no per-frame layout work in React.
 * Reduced motion gets neither clock and a static page that reads top to bottom.
 *
 * Every claim here is a fact about the build: the Duo poses are
 * docs/iphone-duo.md, the screens are captures (the phone ones from the iOS
 * simulator, the Duo ones from the web build at the Duo's own fold geometry --
 * scripts/store/capture-duo-web.mjs -- since the simulator cannot move its
 * hinge), and the haptics are the reel's REEL_TICKS and its landing.
 *
 * Colours come in as custom properties from `color`, so the page follows the
 * palette like everything else and the theme test has no literal to find.
 */

const BASE = (process.env.EXPO_BASE_URL ?? '').replace(/\/+$/, '');
const img = (name: string) => `${BASE}/showcase/${name}`;

export function showcaseOffered(): boolean {
  if (isEmbedded()) return false;
  // A TestFlight link goes nowhere on Android.
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) return false;
  return true;
}

export function Showcase({ onPlay }: ShowcaseProps) {
  const root = useRef<HTMLDivElement>(null);
  useScrollClock(root);

  const vars = {
    '--void': color.void,
    '--field': color.field,
    '--surface': color.surface,
    '--raised': color.surfaceRaised,
    '--navy': color.navy,
    '--ink': color.ink,
    '--ink-deep': color.inkDeep,
    '--line': color.line,
    '--line-bright': color.lineBright,
    '--text': color.text,
    '--silver': color.silver,
    '--dim': color.textDim,
    '--faint': color.textFaint,
    '--action': color.action,
    '--action-bright': color.actionBright,
    '--on-action': color.onAction,
    '--gold': color.gold,
    '--turf-deep': color.turfDeep,
    '--turf-lit': color.turfLit,
    '--cool': color.backdropCool,
    '--f-display': font.display,
    '--f-label': font.label,
    '--f-body': font.body,
    '--f-body-bold': font.bodyBold,
  } as CSSProperties;

  const join = (where: string) => () => track('app_link_opened', { target: `showcase_${where}` });

  return (
    <div ref={root} className="sc" style={vars}>
      <style>{STYLES}</style>

      {/* ── Hero: the download, first ─────────────────────────────── */}
      <section className="hero" data-tl="hero" aria-labelledby="sc-h1">
        <div className="hero-sky t-hero-sky" aria-hidden="true">
          <i className="beam b1" />
          <i className="beam b2" />
        </div>
        <div className="hero-turf t-hero-turf" aria-hidden="true">
          <div className="turf-plane" />
        </div>

        <div className="hero-grid">
          <div className="hero-copy t-hero-copy">
            <p className="chip">
              <span className="dot" /> Public beta · iPhone · iPhone Duo · iPad
            </p>
            <h1 id="sc-h1">
              17-0,
              <br />
              <em>in your hand.</em>
            </h1>
            <p className="lede">
              The pro football history game, native on iPhone. Spin a franchise and an era, take one player, live with
              it. <b>The wheel clicks as it slows and lands with a thump</b>, every team and era is set in its own
              colour, and on an <b>iPhone Duo it opens into two pages.</b>
            </p>
            <div className="cta-row">
              <a className="cta" href={TESTFLIGHT_URL} target="_blank" rel="noopener" onClick={join('hero')}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3v12m0 0-5-5m5 5 5-5M5 20h14" />
                </svg>
                Join the beta on TestFlight
                <span className="arr" aria-hidden="true">→</span>
              </a>
              <p className="fine">
                Free. No account.
                <br />
                Plays offline.
              </p>
            </div>
            <div className="hero-foot">
              <div className="qr">
                <img src={img('testflight-qr.svg')} alt="" width={84} height={84} />
                <p>
                  <b>On a computer?</b>
                  <br />
                  Point your iPhone's camera here to join.
                </p>
              </div>
              <button type="button" className="ghost" onClick={onPlay}>
                Play in the browser <span aria-hidden="true">↓</span>
              </button>
            </div>
          </div>

          <div className="hero-devices" aria-hidden="true">
            <div className="dev duo-open t-hero-duo">
              <img src={img('duo-book.jpg')} alt="" fetchPriority="high" />
              <i className="seam" />
            </div>
            <div className="dev phone t-hero-phone">
              <img src={img('phone-result.jpg')} alt="" />
            </div>
            <p className="tag tag1 t-hero-tag1">
              <b>DAL · 1999–2004</b>
              <span>Team and era, in colour</span>
            </p>
            <p className="tag tag2 t-hero-tag2">
              <b>Click, click, thump</b>
              <span>Haptics on every spin</span>
            </p>
            <p className="tag tag3 t-hero-tag3">
              <b>Two pages</b>
              <span>Split at the Duo's fold</span>
            </p>
          </div>
        </div>
        <p className="scroll-cue" aria-hidden="true">
          Scroll
        </p>
      </section>

      {/* ── The Duo, folding through its poses ─────────────────────── */}
      <section className="duo" aria-labelledby="sc-duo">
        <header className="duo-head">
          <p className="kicker">iPhone Duo</p>
          <h2 id="sc-duo">
            Fold it mid-season.
            <br />
            <em>The game follows.</em>
          </h2>
        </header>
        <div className="duo-track" data-tl="duo">
          <div className="duo-stage">
            <div className="duo-words" aria-hidden="true">
              <span className="w1 t-duo">Closed</span>
              <span className="w2 t-duo">Open</span>
              <span className="w3 t-duo">Tabletop</span>
            </div>
            <div className="duo-floor t-duo" aria-hidden="true" />
            <div className="duo-scene" aria-hidden="true">
              <div className="dev pose closed t-duo">
                <img src={img('phone-spin.jpg')} alt="" loading="lazy" />
              </div>
              <div className="dev pose book t-duo">
                <img src={img('duo-book.jpg')} alt="" loading="lazy" />
                <i className="seam" />
              </div>
              <div className="pose table t-duo">
                <div className="half hi dev-half">
                  <img src={img('duo-tabletop.jpg')} alt="" loading="lazy" />
                </div>
                <div className="half lo dev-half t-duo">
                  <img src={img('duo-tabletop.jpg')} alt="" loading="lazy" />
                </div>
              </div>
            </div>
            <ol className="duo-steps">
              <li className="s1 t-duo">
                <p className="kicker">Closed</p>
                <h3>A phone in one hand.</h3>
                <p>
                  The outer screen plays it like any iPhone: spin, take one, live with it. The landed team and era sit
                  in the header in that franchise's colour.
                </p>
              </li>
              <li className="s2 t-duo">
                <p className="kicker">Open as a book</p>
                <h3>Two pages, split at the fold.</h3>
                <p>
                  Every tab becomes two pages. On a spin, the team and era fill one and your lineup takes a field that
                  fills the other. The tabs move to a rail on the edge.
                </p>
              </li>
              <li className="s3 t-duo">
                <p className="kicker">Tabletop</p>
                <h3>Stand it up.</h3>
                <p>
                  Half open on a table, the field goes above the fold and the list below it, like a handheld. The
                  leaderboards and your stats split the same way.
                </p>
              </li>
            </ol>
            <div className="duo-rail" aria-hidden="true">
              <div className="lbls">
                <span className="l1 t-duo">Closed</span>
                <span className="l2 t-duo">Open</span>
                <span className="l3 t-duo">Tabletop</span>
              </div>
              <div className="bar">
                <i className="t-duo" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The phone ─────────────────────────────────────────────── */}
      <section className="phones" data-tl="phones" aria-labelledby="sc-ph">
        <div className="nums" aria-hidden="true">
          <span className="n1 t-sec">4,872 seasons</span>
          <span className="n2 t-sec">218 franchise-eras</span>
          <span className="n3 t-sec">1 in 6,000</span>
        </div>
        <header className="ph-head">
          <p className="kicker">iPhone</p>
          <h2 id="sc-ph" className="t-sec drift-a">
            Seven picks.
            <br />
            <em>One perfect season.</em>
          </h2>
        </header>
        <div className="ph-row">
          <figure className="t-sec drift-b">
            <div className="dev phone">
              <img src={img('phone-spin.jpg')} alt="A spin landed on Arizona, 1990 to 1998, with its eligible players listed" loading="lazy" />
            </div>
            <figcaption>
              <b>The spin.</b> One team, one era, in its colours. Nothing else.
            </figcaption>
          </figure>
          <figure className="t-sec drift-c">
            <div className="dev phone">
              <img src={img('phone-field.jpg')} alt="A complete lineup of seven on the field" loading="lazy" />
            </div>
            <figcaption>
              <b>The lineup.</b> Every rating era-adjusted, against the season it happened in.
            </figcaption>
          </figure>
          <figure className="t-sec drift-d">
            <div className="dev phone">
              <img src={img('phone-result.jpg')} alt="A projected record of seven and ten, with the roster that earned it" loading="lazy" />
            </div>
            <figcaption>
              <b>The record.</b> The same seven always earn the same one. 17-0 lands about once in 6,000.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ── The ask again, then the game ──────────────────────────── */}
      <section className="close" aria-labelledby="sc-close">
        <h2 id="sc-close">
          Get it on your iPhone.
          <br />
          <em>Or play it right here.</em>
        </h2>
        <div className="cta-row center">
          <a className="cta" href={TESTFLIGHT_URL} target="_blank" rel="noopener" onClick={join('close')}>
            Join the beta on TestFlight <span className="arr" aria-hidden="true">→</span>
          </a>
          <button type="button" className="ghost" onClick={onPlay}>
            Play in the browser <span aria-hidden="true">↓</span>
          </button>
        </div>
      </section>
    </div>
  );
}

/**
 * The fallback clock: where `animation-timeline` is missing, scrub the same
 * keyframes by scroll. Each animated element runs a 1s animation, paused, and
 * its delay is set to minus its timeline's progress in seconds.
 */
function useScrollClock(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const native = typeof CSS !== 'undefined' && CSS.supports?.('animation-timeline: view()') && !/[?&]sd=0/.test(location.search);
    el.classList.add('fx', native ? 'sd' : 'sdjs');
    if (native) return () => el.classList.remove('fx', 'sd');

    const scroller = scrollParent(el);
    const sections = {
      hero: el.querySelector<HTMLElement>('[data-tl=hero]'),
      duo: el.querySelector<HTMLElement>('[data-tl=duo]'),
      phones: el.querySelector<HTMLElement>('[data-tl=phones]'),
    };
    const groups: [HTMLElement | null, NodeListOf<HTMLElement>, 'exit' | 'contain' | 'cover'][] = [
      [sections.hero, el.querySelectorAll<HTMLElement>('[class*="t-hero"]'), 'exit'],
      [sections.duo, el.querySelectorAll<HTMLElement>('.t-duo'), 'contain'],
      [sections.phones, el.querySelectorAll<HTMLElement>('.t-sec'), 'cover'],
    ];
    let frame = 0;
    const tick = () => {
      frame = 0;
      const vh = scroller instanceof HTMLElement ? scroller.clientHeight : innerHeight;
      const top0 = scroller instanceof HTMLElement ? scroller.getBoundingClientRect().top : 0;
      for (const [sec, items, range] of groups) {
        if (!sec) continue;
        const r = sec.getBoundingClientRect();
        const top = r.top - top0;
        const p =
          range === 'exit' ? -top / r.height : range === 'contain' ? -top / Math.max(1, r.height - vh) : (vh - top) / (vh + r.height);
        const d = `${-Math.min(0.999, Math.max(0, p))}s`;
        items.forEach((i) => (i.style.animationDelay = d));
      }
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    tick();
    scroller.addEventListener('scroll', on, { passive: true });
    addEventListener('resize', on);
    return () => {
      scroller.removeEventListener('scroll', on);
      removeEventListener('resize', on);
      cancelAnimationFrame(frame);
      el.classList.remove('fx', 'sdjs');
    };
  }, [root]);
}

function scrollParent(el: HTMLElement): HTMLElement | Window {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return window;
}

const STYLES = String.raw`
.sc { position: relative; width: 100%; color: var(--text); font-family: var(--f-body); overflow-x: clip;
  background: radial-gradient(120% 60% at 70% 0%, color-mix(in srgb, var(--cool) 26%, transparent), transparent 60%), var(--void); }
.sc *, .sc *::before, .sc *::after { box-sizing: border-box; }
.sc h1, .sc h2, .sc h3 { font-family: var(--f-display); font-weight: 700; margin: 0; letter-spacing: -0.01em; line-height: 0.92; }
.sc em { font-style: normal; color: var(--gold); }
.sc p { margin: 0; }
.sc b { font-family: var(--f-body-bold); font-weight: 700; color: var(--text); }
.sc img { display: block; width: 100%; height: auto; }
.sc .kicker, .sc .chip { font-family: var(--f-label); text-transform: uppercase; letter-spacing: 0.22em; font-size: 12px; color: var(--action); }

/* devices: a bezel drawn in CSS around a real capture */
.sc .dev { position: relative; border-radius: 34px; padding: 9px; background: linear-gradient(160deg, var(--line-bright), var(--ink-deep) 40%, var(--ink-deep) 70%, var(--line));
  box-shadow: 0 40px 80px -20px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.08) inset; }
.sc .dev img { border-radius: 26px; }
.sc .dev .seam { position: absolute; top: 9px; bottom: 9px; left: 50%; width: 3%; transform: translateX(-50%);
  background: linear-gradient(90deg, transparent, rgba(0,0,0,.35) 40%, rgba(255,255,255,.08) 50%, rgba(0,0,0,.35) 60%, transparent); }

/* ── hero ── */
.sc .hero { position: relative; min-height: 100svh; padding: 88px 24px 72px; display: flex; flex-direction: column; justify-content: center; }
.sc .hero-sky { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.sc .beam { position: absolute; top: -10%; width: 38%; height: 120%; filter: blur(2px); opacity: .5;
  background: linear-gradient(180deg, rgba(255,255,255,.16), transparent 70%); clip-path: polygon(45% 0, 55% 0, 100% 100%, 0 100%); }
.sc .b1 { left: 6%; transform: rotate(-14deg); }
.sc .b2 { right: 4%; transform: rotate(16deg); opacity: .35; }
.sc .hero-turf { position: absolute; left: 0; right: 0; bottom: 0; height: 34%; perspective: 520px; pointer-events: none; overflow: hidden; opacity: .55;
  -webkit-mask-image: linear-gradient(180deg, transparent, rgba(0,0,0,.35) 45%, #000); mask-image: linear-gradient(180deg, transparent, rgba(0,0,0,.35) 45%, #000); }
.sc .turf-plane { position: absolute; left: -40%; right: -40%; top: 0; height: 220%; transform: rotateX(68deg); transform-origin: 50% 0;
  background:
    repeating-linear-gradient(0deg, rgba(255,255,255,.18) 0 2px, transparent 2px 9%),
    repeating-linear-gradient(0deg, var(--turf-lit) 0 9%, var(--turf-deep) 9% 18%);
}
.sc .hero-grid { position: relative; width: 100%; max-width: 1240px; margin: 0 auto; display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.25fr); gap: 40px; align-items: center; }
.sc .chip { display: inline-flex; align-items: center; gap: 10px; padding: 7px 14px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--action) 45%, transparent);
  background: color-mix(in srgb, var(--action) 10%, transparent); font-size: 11px; }
.sc .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--action); animation: sc-live 1.8s infinite; }
@keyframes sc-live { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--action) 60%, transparent); } 70%, 100% { box-shadow: 0 0 0 9px transparent; } }
.sc h1 { font-size: clamp(56px, 7.2vw, 118px); margin: 20px 0 20px; text-transform: uppercase; }
.sc h1 em { -webkit-text-stroke: 2px var(--gold); color: transparent; }
.sc .lede { font-size: clamp(15px, 1.25vw, 18px); line-height: 1.6; color: var(--silver); max-width: 34em; }
.sc .cta-row { display: flex; align-items: center; gap: 18px; margin-top: 30px; flex-wrap: wrap; }
.sc .cta-row.center { justify-content: center; }
.sc .cta { position: relative; display: inline-flex; align-items: center; gap: 12px; padding: 18px 26px; border-radius: 999px; overflow: hidden;
  background: var(--action); color: var(--on-action); font-family: var(--f-label); font-size: 17px; letter-spacing: .08em; text-transform: uppercase; text-decoration: none;
  box-shadow: 0 18px 50px -12px color-mix(in srgb, var(--action) 70%, transparent); transition: transform .2s, background .2s; }
.sc .cta::after { content: ''; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.45) 50%, transparent 70%); transform: translateX(-120%); animation: sc-sheen 4.5s 1.2s infinite; }
@keyframes sc-sheen { 0%, 75% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
.sc .cta:hover { background: var(--action-bright); transform: translateY(-2px); }
.sc .cta:focus-visible, .sc .ghost:focus-visible { outline: 3px solid var(--gold); outline-offset: 3px; }
.sc .cta svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.sc .cta .arr { transition: transform .2s; }
.sc .cta:hover .arr { transform: translateX(4px); }
.sc .fine { font-size: 13px; line-height: 1.5; color: var(--faint); }
.sc .hero-foot { display: flex; align-items: center; gap: 18px; margin-top: 26px; flex-wrap: wrap; }
.sc .qr { display: flex; align-items: center; gap: 14px; padding: 12px 18px 12px 12px; border-radius: 18px; border: 1px solid var(--line); background: color-mix(in srgb, var(--ink) 80%, transparent); }
.sc .qr img { width: 84px; height: 84px; padding: 6px; background: var(--text); border-radius: 10px; }
.sc .qr p { font-size: 13px; line-height: 1.45; color: var(--dim); max-width: 15em; }
.sc .ghost { appearance: none; cursor: pointer; padding: 14px 22px; border-radius: 999px; border: 1px solid var(--line-bright); background: transparent; color: var(--text);
  font-family: var(--f-label); font-size: 15px; letter-spacing: .1em; text-transform: uppercase; transition: border-color .2s, background .2s; }
.sc .ghost:hover { border-color: var(--action); background: color-mix(in srgb, var(--action) 10%, transparent); }
.sc .hero-devices { position: relative; aspect-ratio: 1.15; }
.sc .hero-devices .duo-open { position: absolute; right: 0; top: 6%; width: 86%; border-radius: 30px; transform: perspective(1400px) rotateY(-14deg) rotateX(4deg); }
.sc .hero-devices .phone { position: absolute; left: 0; bottom: -2%; width: 30%; transform: perspective(1200px) rotateY(10deg); }
.sc .tag { position: absolute; display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border-radius: 14px; border: 1px solid var(--line); font-size: 12px; color: var(--dim);
  background: color-mix(in srgb, var(--ink) 82%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); box-shadow: 0 18px 40px -16px rgba(0,0,0,.6); }
.sc .tag b { font-family: var(--f-label); font-size: 15px; letter-spacing: .06em; color: var(--gold); text-transform: uppercase; }
.sc .tag1 { left: 22%; top: -2%; }
.sc .tag2 { right: -2%; bottom: 8%; }
.sc .tag3 { left: 34%; bottom: -6%; }
.sc .tag2 b { color: var(--action); }
.sc .tag3 b { color: var(--text); }
.sc .scroll-cue { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); font-family: var(--f-label); font-size: 11px; letter-spacing: .3em; text-transform: uppercase; color: var(--faint); }
.sc .scroll-cue::after { content: ''; display: block; width: 1px; height: 26px; margin: 8px auto 0; background: linear-gradient(var(--faint), transparent); transform-origin: top; animation: sc-drip 2s infinite; }
@keyframes sc-drip { 0% { transform: scaleY(0); opacity: 1; } 60% { transform: scaleY(1); opacity: 1; } 100% { opacity: 0; } }

/* first paint, before any clock: the hero settles in */
.sc .hero-copy > * { animation: sc-rise .9s cubic-bezier(.2,.7,.2,1) both; }
.sc .hero-copy > :nth-child(2) { animation-delay: .08s; } .sc .hero-copy > :nth-child(3) { animation-delay: .16s; }
.sc .hero-copy > :nth-child(4) { animation-delay: .24s; } .sc .hero-copy > :nth-child(5) { animation-delay: .32s; }
@keyframes sc-rise { from { opacity: 0; translate: 0 28px; } }

/* ── duo ── */
.sc .duo { position: relative; padding-top: 12vh; }
.sc .duo-head, .sc .ph-head { text-align: center; padding: 0 24px; }
.sc .duo-head h2, .sc .ph-head h2, .sc .close h2 { font-size: clamp(44px, 6vw, 88px); margin-top: 14px; text-transform: uppercase; }
.sc .duo-track { position: relative; }
.sc .duo-stage { position: relative; display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, .75fr); align-items: center; gap: 40px;
  max-width: 1240px; margin: 0 auto; padding: 8vh 24px; }
.sc .duo-words { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; overflow: hidden; }
.sc .duo-words span { grid-area: 1 / 1; font-family: var(--f-display); font-size: clamp(110px, 20vw, 300px); text-transform: uppercase; line-height: 1;
  color: transparent; -webkit-text-stroke: 1.5px color-mix(in srgb, var(--line-bright) 55%, transparent); opacity: 0; }
.sc .duo-floor { position: absolute; left: 10%; right: 30%; bottom: 8%; height: 26%; border-radius: 50%;
  background: radial-gradient(closest-side, color-mix(in srgb, var(--cool) 40%, transparent), transparent); filter: blur(6px); }
.sc .duo-scene { position: relative; height: min(70svh, 640px); perspective: 1600px; }
.sc .pose { position: absolute; left: 50%; top: 50%; translate: -50% -50%; transform-style: preserve-3d; }
.sc .pose.closed { height: 100%; aspect-ratio: 600 / 1304; width: auto; }
.sc .pose.closed img { height: 100%; width: auto; }
.sc .pose.book { width: min(100%, 860px); }
.sc .pose.table { width: min(62%, 430px); perspective: 900px; perspective-origin: 50% 20%; }
.sc .dev-half { position: relative; overflow: hidden; padding: 9px; background: linear-gradient(160deg, var(--line-bright), var(--ink-deep) 45%); box-shadow: 0 30px 60px -20px rgba(0,0,0,.65); }
.sc .dev-half img { border-radius: 24px; }
.sc .half.hi { border-radius: 32px 32px 4px 4px; padding-bottom: 0; aspect-ratio: 900 / 640; }
.sc .half.hi img { border-radius: 24px 24px 0 0; }
.sc .half.lo { border-radius: 4px 4px 32px 32px; padding-top: 0; aspect-ratio: 900 / 640; transform-origin: 50% 0; }
.sc .half.lo img { border-radius: 0 0 24px 24px; translate: 0 -50%; }
.sc .half.lo::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(0,0,0,.4), rgba(0,0,0,0) 30%, rgba(255,255,255,.05)); }
.sc .half.hi::after { content: ''; position: absolute; left: 6%; right: 6%; bottom: 0; height: 4px; border-radius: 4px;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); }
.sc .duo-steps { list-style: none; margin: 0; padding: 0; position: relative; min-height: 15em; }
.sc .duo-steps li { position: absolute; inset: 0 0 auto 0; }
.sc .duo-steps h3 { font-size: clamp(34px, 3.4vw, 50px); margin: 12px 0 14px; }
.sc .duo-steps p:not(.kicker) { color: var(--silver); line-height: 1.6; font-size: 16px; max-width: 26em; }
.sc .duo-rail { position: absolute; right: 24px; bottom: 5vh; width: min(320px, 40%); }
.sc .duo-rail .lbls { display: flex; justify-content: space-between; font-family: var(--f-label); font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: var(--faint); margin-bottom: 8px; }
.sc .duo-rail .bar { height: 2px; background: var(--line); border-radius: 2px; overflow: hidden; }
.sc .duo-rail .bar i { display: block; height: 100%; background: linear-gradient(90deg, var(--action), var(--gold)); transform-origin: 0 50%; }

/* ── phones ── */
.sc .phones { position: relative; padding: 18vh 24px 10vh; overflow: hidden; }
.sc .nums { position: absolute; inset: 6vh 0 auto; display: flex; flex-direction: column; align-items: center; gap: 0; pointer-events: none; }
.sc .nums span { font-family: var(--f-display); font-size: clamp(60px, 11vw, 170px); line-height: .95; text-transform: uppercase; white-space: nowrap;
  color: transparent; -webkit-text-stroke: 1.5px color-mix(in srgb, var(--line-bright) 40%, transparent); }
.sc .ph-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(18px, 3vw, 48px); max-width: 1100px; margin: 10vh auto 0; }
.sc .ph-row figure { margin: 0; }
.sc .ph-row figcaption { margin-top: 20px; font-size: 15px; line-height: 1.55; color: var(--dim); }
.sc .ph-row figcaption b { font-family: var(--f-label); font-size: 18px; letter-spacing: .04em; color: var(--text); }

/* ── close ── */
.sc .close { text-align: center; padding: 14vh 24px 16vh;
  background: radial-gradient(70% 60% at 50% 100%, color-mix(in srgb, var(--action) 18%, transparent), transparent 70%); }

/* ── static (reduced motion, no script): readable top to bottom ── */
.sc:not(.fx) .duo-stage { grid-template-columns: 1fr; }
.sc:not(.fx) .duo-words, .sc:not(.fx) .duo-rail, .sc:not(.fx) .duo-floor { display: none; }
.sc:not(.fx) .duo-scene { height: auto; display: grid; gap: 32px; perspective: none; }
.sc:not(.fx) .pose { position: relative; left: auto; top: auto; translate: none; margin: 0 auto; }
.sc:not(.fx) .pose.closed { height: 520px; }
.sc:not(.fx) .duo-steps { min-height: 0; display: grid; gap: 28px; }
.sc:not(.fx) .duo-steps li { position: static; }

/* ── motion ── */
.sc.fx .duo-track { height: 460svh; }
.sc.fx .duo-stage { position: sticky; top: 0; height: 100svh; }
.sc.sd { timeline-scope: --hero, --duo, --phones; }
.sc.sd [data-tl=hero] { view-timeline: --hero block; }
.sc.sd [data-tl=duo] { view-timeline: --duo block; }
.sc.sd [data-tl=phones] { view-timeline: --phones block; }
.sc.sd [class*="t-hero"] { animation-timeline: --hero; animation-range: exit 0% exit 100%; animation-duration: auto; }
.sc.sd .t-duo { animation-timeline: --duo; animation-range: contain 0% contain 100%; animation-duration: auto; }
.sc.sd .t-sec { animation-timeline: --phones; animation-range: cover 0% cover 100%; animation-duration: auto; }
.sc.sdjs [class*="t-hero"], .sc.sdjs .t-duo, .sc.sdjs .t-sec { animation-duration: 1s; animation-play-state: paused; animation-delay: 0s; }
.sc.fx [class*="t-hero"], .sc.fx .t-duo, .sc.fx .t-sec { animation-timing-function: linear; animation-fill-mode: both; }

.sc.fx .t-hero-sky { animation-name: x-h-sky; }
.sc.fx .t-hero-turf { animation-name: x-h-turf; }
.sc.fx .t-hero-copy { animation-name: x-h-copy; }
.sc.fx .t-hero-duo { animation-name: x-h-duo; }
.sc.fx .t-hero-phone { animation-name: x-h-phone; }
.sc.fx .t-hero-tag1 { animation-name: x-h-tag1; }
.sc.fx .t-hero-tag2 { animation-name: x-h-tag2; }
.sc.fx .t-hero-tag3 { animation-name: x-h-tag3; }
@keyframes x-h-sky { to { transform: translate3d(0, 18vh, 0); } }
@keyframes x-h-turf { to { transform: translate3d(0, 8vh, 0); opacity: .4; } }
@keyframes x-h-copy { to { transform: translate3d(0, -8vh, 0); opacity: .1; } }
@keyframes x-h-duo { from { transform: perspective(1400px) rotateY(-14deg) rotateX(4deg); } to { transform: perspective(1400px) translate3d(-2vw, -14vh, 0) rotateY(-4deg) rotateX(10deg); } }
@keyframes x-h-phone { from { transform: perspective(1200px) rotateY(10deg); } to { transform: perspective(1200px) translate3d(0, -30vh, 0) rotateY(2deg); } }
@keyframes x-h-tag1 { to { transform: translate3d(0, -42vh, 0); } }
@keyframes x-h-tag2 { to { transform: translate3d(0, -56vh, 0); } }
@keyframes x-h-tag3 { to { transform: translate3d(0, -36vh, 0); } }

/* the three poses: closed 0-30, open 36-62, tabletop 70-100 */
.sc.fx .pose.closed { animation-name: x-closed; }
.sc.fx .pose.book { animation-name: x-book; }
.sc.fx .pose.table { animation-name: x-table; }
.sc.fx .half.lo { animation-name: x-fold; }
@keyframes x-closed {
  0% { opacity: 0; transform: translate3d(0, 6vh, 0) rotateY(-18deg) scale(.92); }
  10%, 26% { opacity: 1; transform: none; }
  34%, 100% { opacity: 0; transform: rotateY(70deg) scale(.9); } }
@keyframes x-book {
  0%, 27% { opacity: 0; transform: rotateY(-60deg) scale(.82); }
  37%, 60% { opacity: 1; transform: none; }
  68%, 100% { opacity: 0; transform: rotateX(40deg) scale(.9); } }
@keyframes x-table {
  0%, 62% { opacity: 0; transform: translate3d(0, 8vh, 0) scale(.9); }
  72%, 100% { opacity: 1; transform: translate3d(0, -6%, 0) rotateX(6deg); } }
@keyframes x-fold { 0%, 70% { transform: rotateX(0deg); } 84%, 100% { transform: rotateX(-20deg); } }

.sc.fx .duo-words .w1 { animation-name: x-w1; } .sc.fx .duo-words .w2 { animation-name: x-w2; } .sc.fx .duo-words .w3 { animation-name: x-w3; }
@keyframes x-w1 { 0% { opacity: 0; translate: 6vw 0; } 8%, 26% { opacity: 1; } 34%, 100% { opacity: 0; translate: -6vw 0; } }
@keyframes x-w2 { 0%, 28% { opacity: 0; translate: 6vw 0; } 38%, 58% { opacity: 1; translate: 0 0; } 66%, 100% { opacity: 0; translate: -6vw 0; } }
@keyframes x-w3 { 0%, 62% { opacity: 0; translate: 6vw 0; } 72%, 100% { opacity: 1; translate: 0 0; } }
.sc.fx .duo-floor { animation-name: x-floor; }
@keyframes x-floor { 0% { transform: scale(.6); opacity: .4; } 40% { transform: scale(1.15); opacity: 1; } 75%, 100% { transform: scale(.9); opacity: .9; } }

.sc.fx .duo-steps .s1 { animation-name: x-s1; } .sc.fx .duo-steps .s2 { animation-name: x-s2; } .sc.fx .duo-steps .s3 { animation-name: x-s3; }
@keyframes x-s1 { 0%, 24% { opacity: 1; transform: none; } 30%, 100% { opacity: 0; transform: translate3d(0, -28px, 0); } }
@keyframes x-s2 { 0%, 30% { opacity: 0; transform: translate3d(0, 28px, 0); } 37%, 58% { opacity: 1; transform: none; } 64%, 100% { opacity: 0; transform: translate3d(0, -28px, 0); } }
@keyframes x-s3 { 0%, 64% { opacity: 0; transform: translate3d(0, 28px, 0); } 72%, 100% { opacity: 1; transform: none; } }
.sc.fx .duo-rail .l1 { animation-name: x-l1; } .sc.fx .duo-rail .l2 { animation-name: x-l2; } .sc.fx .duo-rail .l3 { animation-name: x-l3; }
@keyframes x-l1 { 0%, 28% { color: var(--text); } 32%, 100% { color: var(--faint); } }
@keyframes x-l2 { 0%, 30% { color: var(--faint); } 36%, 62% { color: var(--text); } 66%, 100% { color: var(--faint); } }
@keyframes x-l3 { 0%, 64% { color: var(--faint); } 70%, 100% { color: var(--text); } }
.sc.fx .duo-rail .bar i { animation-name: x-bar; }
@keyframes x-bar { from { transform: scaleX(.02); } to { transform: scaleX(1); } }

.sc.fx .nums .n1 { animation-name: x-n1; } .sc.fx .nums .n2 { animation-name: x-n2; } .sc.fx .nums .n3 { animation-name: x-n3; }
@keyframes x-n1 { from { transform: translate3d(-8vw, 0, 0); } to { transform: translate3d(8vw, 0, 0); } }
@keyframes x-n2 { from { transform: translate3d(10vw, 0, 0); } to { transform: translate3d(-10vw, 0, 0); } }
@keyframes x-n3 { from { transform: translate3d(-12vw, 0, 0); } to { transform: translate3d(5vw, 0, 0); } }
.sc.fx .drift-a { animation-name: x-d1; } .sc.fx .drift-b { animation-name: x-d2; } .sc.fx .drift-c { animation-name: x-d3; } .sc.fx .drift-d { animation-name: x-d4; }
@keyframes x-d1 { from { transform: translate3d(0, 5vh, 0); } to { transform: translate3d(0, -5vh, 0); } }
@keyframes x-d2 { from { transform: translate3d(0, 10vh, 0); } to { transform: translate3d(0, -10vh, 0); } }
@keyframes x-d3 { from { transform: translate3d(0, 22vh, 0); } to { transform: translate3d(0, -22vh, 0); } }
@keyframes x-d4 { from { transform: translate3d(0, 34vh, 0); } to { transform: translate3d(0, -34vh, 0); } }

/* ── narrow: one column, the device above its words ── */
@media (max-width: 860px) {
  .sc .hero { padding: 76px 20px 64px; }
  .sc .hero-grid { grid-template-columns: 1fr; gap: 36px; }
  .sc .hero-devices { aspect-ratio: 1.2; margin: 0 4%; }
  .sc .tag { font-size: 11px; padding: 8px 11px; } .sc .tag b { font-size: 13px; }
  .sc .tag3 { display: none; }
  .sc .duo-stage { grid-template-columns: 1fr; gap: 18px; align-content: center; padding: 10px 20px 8vh; }
  .sc .duo-scene { height: 48svh; }
  .sc .pose.book { width: 100%; }
  .sc .pose.table { width: min(68%, 320px); }
  .sc .cta { padding: 17px 22px; font-size: 15px; letter-spacing: .05em; gap: 10px; }
  .sc .duo-steps { min-height: 12em; }
  .sc .duo-steps h3 { font-size: 30px; margin: 8px 0 10px; }
  .sc .duo-steps p:not(.kicker) { font-size: 15px; }
  .sc .duo-rail { left: 20px; right: 20px; width: auto; bottom: 3vh; }
  .sc .ph-row { grid-template-columns: 1fr; max-width: 360px; gap: 56px; }
  .sc.fx .drift-c, .sc.fx .drift-d { animation-name: x-d2; }
}
/* the QR is for a computer; a phone already is the phone */
@media (hover: none), (pointer: coarse), (max-width: 700px) { .sc .qr { display: none; } }
`;
