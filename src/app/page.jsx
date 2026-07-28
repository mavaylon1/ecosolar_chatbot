'use client'

import { NAVY } from '../components/ChatWidget/theme.js'

// Served at `/` — this is the Vercel test site described in DEPLOYMENT.md
// Section 1: "a Vercel-hosted test site, using the exact same embedding
// mechanism production will use." It stands in for the client's real
// ecosolarusa.com (a WordPress/Elementor site, Section 2 — not this repo)
// so the widget can be proven out end-to-end on a real deployed URL before
// anyone touches WordPress.
//
// Layout is adapted from servers_vercel/demo-sites/public/modern-listings.html
// (a sibling project in this monorepo) with the property-listing grid/filter
// machinery removed and copy reskinned to EcoSolar USA (see
// src/data/docs/company-info.md for source facts). What's kept from that
// template: the sticky nav, the card-grid visual language, and the general
// "real-looking local-business site" shape.
//
// The chatbot itself is loaded via <iframe src="/embed/ecosolarusa">, the
// same technique demo/index.html uses and NOT a direct <ChatWidget />
// import — see src/components/ChatWidget/ChatWidget.jsx and
// src/app/README.md: that component is only ever reached by iframing the
// embed route, never imported elsewhere, so this page proves the exact same
// integration path a real client site will use. Relative src (vs.
// demo/index.html's hardcoded localhost:3000) means this works unmodified
// in local dev and in any Vercel deployment of this same app.
export default function Home() {
  return (
    <>
      <style>{`
        .eco-page { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f9f7; color: #1c2230; min-height: 100vh; }
        .eco-nav { background: ${NAVY}; padding: 0 2rem; height: 60px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 200; box-shadow: 0 2px 8px rgba(0,0,0,.15); }
        .eco-logo { color: #fff; font-size: 1.25rem; font-weight: 700; letter-spacing: -.02em; display: flex; align-items: center; gap: .5rem; }
        .eco-logo span { font-weight: 300; opacity: .85; }
        .eco-nav-links { display: flex; gap: 1.75rem; list-style: none; margin: 0; padding: 0; }
        .eco-nav-links a { color: rgba(255,255,255,.85); text-decoration: none; font-size: .875rem; font-weight: 500; }
        .eco-nav-links a:hover { color: #fff; }
        .eco-nav-cta { padding: .5rem 1.1rem; background: #fff; color: ${NAVY}; border: none; border-radius: 999px; font-weight: 700; font-size: .8rem; cursor: pointer; }

        .eco-promo { background: #123fa8; color: #fff; text-align: center; font-size: .8rem; font-weight: 600; padding: .5rem 1rem; letter-spacing: .01em; }

        .eco-hero { max-width: 1080px; margin: 0 auto; padding: 4.5rem 2rem 3.5rem; display: grid; grid-template-columns: 1.1fr .9fr; gap: 2.5rem; align-items: center; }
        @media (max-width: 860px) { .eco-hero { grid-template-columns: 1fr; padding: 3rem 1.5rem; } }
        .eco-eyebrow { font-size: .75rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: ${NAVY}; margin-bottom: .75rem; }
        .eco-hero h1 { font-size: 2.5rem; line-height: 1.15; margin: 0 0 1rem; }
        .eco-hero p { color: #5b6270; font-size: 1.05rem; line-height: 1.65; max-width: 480px; }
        .eco-hero-cta { margin-top: 1.5rem; display: flex; gap: .75rem; flex-wrap: wrap; }
        .eco-btn-primary { background: ${NAVY}; color: #fff; border: none; border-radius: 999px; padding: .8rem 1.6rem; font-size: .9rem; font-weight: 700; cursor: pointer; }
        .eco-btn-secondary { background: #fff; color: ${NAVY}; border: 1.5px solid ${NAVY}; border-radius: 999px; padding: .8rem 1.6rem; font-size: .9rem; font-weight: 700; cursor: pointer; }
        .eco-hero-panel { background: linear-gradient(135deg, #123fa8, ${NAVY}); border-radius: 20px; padding: 2rem; color: #fff; }
        .eco-hero-panel .stat { display: flex; justify-content: space-between; padding: .75rem 0; border-bottom: 1px solid rgba(255,255,255,.15); font-size: .9rem; }
        .eco-hero-panel .stat:last-child { border-bottom: none; }
        .eco-hero-panel .stat strong { font-size: 1.1rem; }

        .eco-section { max-width: 1080px; margin: 0 auto; padding: 3rem 2rem; }
        .eco-section h2 { font-size: 1.5rem; margin: 0 0 .5rem; }
        .eco-section .sub { color: #5b6270; font-size: .9rem; margin-bottom: 2rem; max-width: 560px; }

        .eco-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.25rem; }
        .eco-card { background: #fff; border: 1px solid #e4e6ec; border-radius: 14px; padding: 1.5rem; }
        .eco-card .icon { font-size: 1.75rem; margin-bottom: .75rem; }
        .eco-card h3 { font-size: 1.05rem; margin: 0 0 .5rem; }
        .eco-card p { color: #5b6270; font-size: .875rem; line-height: 1.6; margin: 0; }

        .eco-why { background: #fff; border-top: 1px solid #e4e6ec; border-bottom: 1px solid #e4e6ec; }
        .eco-why-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; }
        .eco-why-list li { display: flex; gap: .75rem; font-size: .875rem; color: #333a48; line-height: 1.5; }
        .eco-why-list li .dot { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: ${NAVY}; color: #fff; font-size: .7rem; display: flex; align-items: center; justify-content: center; margin-top: 1px; }

        .eco-contact { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.5rem; }
        .eco-contact div { font-size: .875rem; }
        .eco-contact .label { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: ${NAVY}; margin-bottom: .35rem; }
        .eco-contact .value { color: #333a48; line-height: 1.5; }

        .eco-testsite-banner { position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999; background: rgba(10, 20, 40, .94); backdrop-filter: blur(10px); border-top: 1px solid rgba(26,86,219,.3); padding: .55rem 1.5rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; font-size: .68rem; color: rgba(220,228,245,.65); line-height: 1.4; }
        .eco-testsite-banner strong { color: #6f9dff; letter-spacing: .04em; }
        .eco-testsite-banner button { flex-shrink: 0; background: none; border: 1px solid rgba(111,157,255,.35); color: rgba(220,228,245,.55); border-radius: 4px; padding: .25rem .6rem; cursor: pointer; font-size: .65rem; white-space: nowrap; }

        .eco-chat-frame { position: fixed; bottom: 0; right: 0; width: 480px; height: 740px; max-width: 100vw; max-height: 100vh; border: none; background: transparent; z-index: 1000; }
      `}</style>

      <div className="eco-page">
        <nav className="eco-nav">
          <div className="eco-logo">☀️ EcoSolar<span>USA</span></div>
          <ul className="eco-nav-links">
            <li><a href="#services">Residential</a></li>
            <li><a href="#services">Commercial</a></li>
            <li><a href="#services">Battery Backup</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
          <button className="eco-nav-cta">Get Free Quote</button>
        </nav>

        <div className="eco-promo">
          $1,000 cash rebate when you install solar — plus $500 for every referral. Offer active until further notice.
        </div>

        <section className="eco-hero">
          <div>
            <div className="eco-eyebrow">Central Southern California · Est. 2015</div>
            <h1>Custom solar solutions, built to actually lower your bill.</h1>
            <p>
              EcoSolar USA designs and installs residential and commercial solar
              systems and battery backup, backed by an industry-leading 25-year
              bumper-to-bumper warranty. We handle the paperwork, our installers
              get it right the first time, and maintenance after install is on us.
            </p>
            <div className="eco-hero-cta">
              <button className="eco-btn-primary">Get Free Quote</button>
              <button className="eco-btn-secondary">Call (714) 265-9077</button>
            </div>
          </div>
          <div className="eco-hero-panel">
            <div className="stat"><span>Warranty coverage</span><strong>25 yrs</strong></div>
            <div className="stat"><span>Panel lifetime efficiency</span><strong>+70%</strong></div>
            <div className="stat"><span>BBB rating</span><strong>A+</strong></div>
            <div className="stat"><span>Languages spoken</span><strong>EN · ES · VI</strong></div>
          </div>
        </section>

        <section className="eco-section" id="services">
          <h2>Services</h2>
          <p className="sub">Complete, customized solar — from a first design conversation through post-install maintenance.</p>
          <div className="eco-grid">
            <div className="eco-card">
              <div className="icon">🏠</div>
              <h3>Residential Solar</h3>
              <p>Custom-designed systems sized to your home's actual usage, installed by our own experienced crews — not subcontracted out.</p>
            </div>
            <div className="eco-card">
              <div className="icon">🏢</div>
              <h3>Commercial Solar</h3>
              <p>Larger-scale installations for businesses, with the same paperwork handling and 25-year warranty as our residential systems.</p>
            </div>
            <div className="eco-card">
              <div className="icon">🔋</div>
              <h3>Battery Backup</h3>
              <p>Battery systems paired with your solar install for power when the grid goes down, not just savings when it doesn't.</p>
            </div>
          </div>
        </section>

        <section className="eco-why">
          <div className="eco-section">
            <h2>Why choose EcoSolar USA</h2>
            <p className="sub">Honesty, transparency, and professionalism — from the first quote to the last shingle.</p>
            <ul className="eco-why-list">
              <li><span className="dot">✓</span>Panels rated 70% more efficient over their lifetime than any other panel ever produced</li>
              <li><span className="dot">✓</span>Industry-leading 25-year bumper-to-bumper warranty, vs. the industry-standard 10–12 years</li>
              <li><span className="dot">✓</span>Complimentary post-installation maintenance included</li>
              <li><span className="dot">✓</span>We handle all the paperwork to get your system install-ready</li>
              <li><span className="dot">✓</span>A+ rated by the Better Business Bureau</li>
              <li><span className="dot">✓</span>Multilingual team — English, Spanish, and Vietnamese spoken in-office</li>
            </ul>
          </div>
        </section>

        <section className="eco-section" id="contact">
          <h2>Contact</h2>
          <p className="sub">Have a question first? The chat in the corner is a good place to start — ask it anything on this page.</p>
          <div className="eco-contact">
            <div>
              <div className="label">Sales office &amp; showroom</div>
              <div className="value">13902 Harbor Blvd, Unit 2A<br />Garden Grove, CA 92843</div>
            </div>
            <div>
              <div className="label">Phone</div>
              <div className="value">(714) 265-9077</div>
            </div>
            <div>
              <div className="label">Email</div>
              <div className="value">info@ecosolarusa.com</div>
            </div>
            <div>
              <div className="label">Hours</div>
              <div className="value">Monday–Friday, 9am–5pm</div>
            </div>
          </div>
        </section>
      </div>

      {/* The one line of integration a real client site needs — same
          mechanism demo/index.html uses, pointed at this deployment's own
          embed route via a relative path instead of a hardcoded domain. */}
      <iframe
        className="eco-chat-frame"
        src="/embed/ecosolarusa"
        title="EcoSolar USA chat"
      />

      <div className="eco-testsite-banner" id="eco-testsite-banner">
        <span>
          <strong>VERCEL TEST SITE</strong> &mdash; this page stands in for ecosolarusa.com
          (a WordPress/Elementor site, see DEPLOYMENT.md Section 2) so the chatbot can be
          proven out on a real deployed URL first. The chat widget below is the exact
          same <code>/embed/ecosolarusa</code> route a real client site will iframe.
        </span>
        <button onClick={() => document.getElementById('eco-testsite-banner').style.display = 'none'}>Got it</button>
      </div>
    </>
  )
}
