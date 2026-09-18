import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LibraryKey } from '@dialer/shared';
import { api } from '../../lib/api';
import { Drawer, IconButton } from '../primitives';

/**
 * INLINE CREATION.
 *
 * Every library dropdown in a campaign carries `+ New`. Together with the seeded
 * defaults this is what lets a new account publish a working campaign without ever
 * visiting the library — the central usability goal of the restructure.
 *
 * Objects that carry real structure (dispositions, surveys, lead lists, DND, transfer
 * directories) get a full page rather than a cramped drawer, so `+ New` creates the
 * object, selects it, and navigates — returning here afterwards.
 */
const FULL_PAGE: Partial<Record<LibraryKey, { endpoint: string; route: string; body?: object }>> = {
  disposition: { endpoint: '/disposition-sets', route: '/library/dispositions' },
  csat: { endpoint: '/surveys', route: '/library/surveys' },
  leads: { endpoint: '/lead-lists', route: '/library/lead-lists' },
  dnd: { endpoint: '/dnd-lists', route: '/library/dnd' },
  quick: { endpoint: '/transfer-directories', route: '/library/transfer-directories' },
};

const SIMPLE: Partial<Record<LibraryKey, { endpoint: string; label: string }>> = {
  pause: { endpoint: '/pause-code-sets', label: 'pause code set' },
  skill: { endpoint: '/skill-lists', label: 'skill list' },
  script: { endpoint: '/agent-scripts', label: 'agent script' },
};

export function useInlineCreate(campaignId: string, onLibraryChanged?: () => void) {
  const nav = useNavigate();
  const [drawer, setDrawer] = useState<{ lib: LibraryKey; onDone: (id: string) => void } | null>(null);
  const [pendingSurveyType, setPendingSurveyType] = useState<((t: 'voice' | 'web') => void) | null>(
    null,
  );

  const start = (lib: LibraryKey, onDone: (id: string) => void) => {
    const full = FULL_PAGE[lib];
    if (full) {
      // A survey's type is immutable, so it must be chosen before the object exists.
      if (lib === 'csat') {
        setPendingSurveyType(() => async (type: 'voice' | 'web') => {
          const created = await api.post<{ id: string }>(full.endpoint, { name: '', type });
          onLibraryChanged?.();
          onDone(created.id);
          setPendingSurveyType(null);
          nav(`${full.route}/${created.id}?from=/campaigns/${campaignId}`);
        });
        return;
      }
      api.post<{ id: string }>(full.endpoint, { name: '' }).then((created) => {
        onLibraryChanged?.();
        onDone(created.id);
        nav(`${full.route}/${created.id}?from=/campaigns/${campaignId}`);
      });
      return;
    }
    if (SIMPLE[lib]) setDrawer({ lib, onDone });
  };

  const element = drawer ? (
    <SimpleCreateDrawer
      lib={drawer.lib}
      onClose={() => setDrawer(null)}
      onCreated={(id) => {
        // Refresh the dropdown options first, so the new id has an option to select.
        onLibraryChanged?.();
        drawer.onDone(id);
        setDrawer(null);
      }}
    />
  ) : pendingSurveyType ? (
    <SurveyTypeDrawer onClose={() => setPendingSurveyType(null)} onPick={pendingSurveyType} />
  ) : null;

  return { start, element };
}

function SimpleCreateDrawer({
  lib,
  onClose,
  onCreated,
}: {
  lib: LibraryKey;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const cfg = SIMPLE[lib]!;
  const [name, setName] = useState('');
  const [codes, setCodes] = useState<string[]>(['', '', '']);
  const [touched, setTouched] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      setTouched(true);
      return;
    }
    const created = await api.post<{ id: string }>(cfg.endpoint, {
      name: name.trim(),
      codes: codes.map((c) => c.trim()).filter(Boolean),
    });
    onCreated(created.id);
  };

  return (
    <Drawer
      title={`New ${cfg.label}`}
      sub="Created here and selected in the campaign straight away — no need to leave this page."
      onClose={onClose}
      footer={
        <>
          <button className="btn sec" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="btn pri" onClick={save} type="button">
            Create and select
          </button>
        </>
      }
    >
      <div className="f" style={{ marginBottom: 18 }}>
        <label htmlFor="inline-name">
          Name<span className="req">*</span>
        </label>
        <input
          id="inline-name"
          value={name}
          className={touched && !name.trim() ? 'bad' : ''}
          placeholder="e.g. Collections outcomes"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="f">
        <label>Entries</label>
        {codes.map((c, i) => (
          <div className="itemrow" key={i}>
            <input
              value={c}
              placeholder={`Entry ${i + 1}`}
              aria-label={`Entry ${i + 1}`}
              onChange={(e) => setCodes(codes.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <IconButton
              icon="x"
              label={`Remove entry ${i + 1}`}
              onClick={() => setCodes(codes.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <button className="addlink" style={{ paddingLeft: 0 }} onClick={() => setCodes([...codes, ''])} type="button">
          + Add entry
        </button>
      </div>
    </Drawer>
  );
}

export function SurveyTypeDrawer({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (type: 'voice' | 'web') => void;
}) {
  return (
    <Drawer
      title="What kind of survey?"
      sub="The two work differently, so they ask for different settings. You cannot change this later."
      onClose={onClose}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <button className="tplc" type="button" onClick={() => onPick('voice')}>
          <h4>Voice CSAT</h4>
          <p>
            Played to the customer over the phone after the agent hangs up. They answer with keypad
            digits.
          </p>
          <span className="tg">recordings &amp; DTMF</span>
        </button>
        <button className="tplc" type="button" onClick={() => onPick('web')}>
          <h4>Web survey</h4>
          <p>
            A form the agent fills in on screen. Questions can be dropdowns, checkboxes, free text or
            dates.
          </p>
          <span className="tg">questions &amp; answers</span>
        </button>
      </div>
    </Drawer>
  );
}
