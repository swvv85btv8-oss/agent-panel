import { ReactNode, createContext, useContext, useMemo, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { LIBRARY_GROUPS, LibraryKey } from '@dialer/shared';

/** Where each library collection lives in the nav, and what it is called. */
export const LIBRARY_ROUTES: Record<LibraryKey, { title: string; path: string; singular: string }> = {
  leads: { title: 'Lead Lists', path: '/library/lead-lists', singular: 'lead list' },
  disposition: { title: 'Dispositions', path: '/library/dispositions', singular: 'disposition set' },
  csat: { title: 'Surveys', path: '/library/surveys', singular: 'survey' },
  script: { title: 'Agent Scripts', path: '/library/agent-scripts', singular: 'agent script' },
  quick: { title: 'Transfer Directory', path: '/library/transfer-directories', singular: 'transfer directory' },
  pause: { title: 'Pause Codes', path: '/library/pause-codes', singular: 'pause code set' },
  skill: { title: 'Skill Lists', path: '/library/skill-lists', singular: 'skill list' },
  dnd: { title: 'DND', path: '/library/dnd', singular: 'DND list' },
};

/* ------------------------------------------------------------- shell slots */

interface ShellSlots {
  rail: ReactNode;
  setRail: (node: ReactNode) => void;
  crumb: ReactNode;
  setCrumb: (node: ReactNode) => void;
  footer: ReactNode;
  setFooter: (node: ReactNode) => void;
  railMini: boolean;
  toggleRail: () => void;
}

const ShellContext = createContext<ShellSlots | null>(null);

export function useShell(): ShellSlots {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside <Shell>');
  return ctx;
}

export function Shell({ children }: { children: ReactNode }) {
  const [rail, setRail] = useState<ReactNode>(null);
  const [crumb, setCrumb] = useState<ReactNode>(null);
  const [footer, setFooter] = useState<ReactNode>(null);
  const [railMini, setRailMini] = useState(false);

  const value = useMemo<ShellSlots>(
    () => ({
      rail,
      setRail,
      crumb,
      setCrumb,
      footer,
      setFooter,
      railMini,
      toggleRail: () => setRailMini((v) => !v),
    }),
    [rail, crumb, footer, railMini],
  );

  return (
    <ShellContext.Provider value={value}>
      <div className="app">
        <a className="skip" href="#main">
          Skip to content
        </a>
        <header className="hdr">
          <Link to="/" className="logo" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="mark" aria-hidden="true" />
            Ace<em>fone</em>
          </Link>
          <nav className="crumb" aria-label="Breadcrumb">
            {crumb}
          </nav>
          <div className="right">
            <button className="hdrbtn ghost" type="button">
              ☎ Click to Call
            </button>
            <button className="iconpill" type="button" aria-label="Help">
              ?
            </button>
            <div className="acct">
              <b>SMFG India</b>
              <span>TACN5274310</span>
            </div>
            <div className="avatar" aria-hidden="true">
              SL
            </div>
          </div>
        </header>
        <div className="body">
          <nav
            className={`rail ${railMini ? 'mini' : ''}`}
            aria-label="Configuration"
            id="nav-rail"
          >
            <button
              className="railtog"
              onClick={() => setRailMini((v) => !v)}
              aria-expanded={!railMini}
              aria-controls="nav-rail"
              aria-label={railMini ? 'Expand menu' : 'Collapse menu'}
            >
              {railMini ? '»' : '«'}
            </button>
            {rail ?? <DefaultRail />}
          </nav>
          <main className="main" id="main" tabIndex={-1}>
            {children}
          </main>
        </div>
        <div className="ftr">{footer ?? <DefaultFooter />}</div>
      </div>
    </ShellContext.Provider>
  );
}

function DefaultFooter() {
  return (
    <div className="st">
      Lead lists and inbound queues belong to a campaign. Everything in Library is shared.
    </div>
  );
}

/** The library nav: four groups, using the same words as the campaign form. */
export function DefaultRail() {
  return (
    <>
      <div className="heading">Campaigns</div>
      {/* NavLink sets aria-current="page" on the active link by itself. */}
      <NavLink to="/campaigns" className={({ isActive }) => `nav ${isActive ? 'on' : ''}`}>
        <span className="chip" aria-hidden="true">
          ▤
        </span>
        <span>All campaigns</span>
      </NavLink>
      <div className="heading" style={{ marginTop: 22 }}>
        Library
      </div>
      <div className="sub">Reusable pieces. Set up once, use in any campaign.</div>
      {LIBRARY_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="gh">{group.title}</div>
          {group.keys.map((key) => {
            const route = LIBRARY_ROUTES[key];
            return (
              <NavLink
                key={key}
                to={route.path}
                className={({ isActive }) => `nav ${isActive ? 'on' : ''}`}
              >
                <span className="chip" aria-hidden="true">
                  {route.title[0]}
                </span>
                <span>{route.title}</span>
              </NavLink>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function BackLink({ label, onClick, to }: { label: string; onClick?: () => void; to?: string }) {
  if (to) {
    return (
      <Link className="backlink" to={to}>
        <span>← {label}</span>
      </Link>
    );
  }
  return (
    <button className="backlink" onClick={onClick} type="button">
      <span>← {label}</span>
    </button>
  );
}
