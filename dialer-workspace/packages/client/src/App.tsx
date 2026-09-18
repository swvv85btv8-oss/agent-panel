import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import CampaignsList from './pages/CampaignsList';
import CampaignConfig from './pages/CampaignConfig';
import QueueEditor from './pages/QueueEditor';
import LeadListsList from './pages/LeadListsList';
import LeadListRecords from './pages/LeadListRecords';
import DispositionEditor from './pages/DispositionEditor';
import SurveyEditor from './pages/SurveyEditor';
import DndEditor from './pages/DndEditor';
import TransferEditor from './pages/TransferEditor';
import {
  DispositionsList,
  DndLists,
  SimpleLibraryList,
  SurveysList,
  TransferDirectories,
} from './pages/LibraryLists';

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/campaigns" replace />} />

        {/* Campaigns, and the queues they own. A queue is only ever reached through
            its campaign, because it does not exist independently of one. */}
        <Route path="/campaigns" element={<CampaignsList />} />
        <Route path="/campaigns/:id" element={<CampaignConfig />} />
        <Route path="/campaigns/:id/queues/:qid" element={<QueueEditor />} />

        {/* The shared library: four groups, using the same words as the campaign form. */}
        <Route path="/library/lead-lists" element={<LeadListsList />} />
        <Route path="/library/lead-lists/:id" element={<LeadListRecords />} />
        <Route path="/library/dispositions" element={<DispositionsList />} />
        <Route path="/library/dispositions/:id" element={<DispositionEditor />} />
        <Route path="/library/surveys" element={<SurveysList />} />
        <Route path="/library/surveys/:id" element={<SurveyEditor />} />
        <Route path="/library/dnd" element={<DndLists />} />
        <Route path="/library/dnd/:id" element={<DndEditor />} />
        <Route path="/library/transfer-directories" element={<TransferDirectories />} />
        <Route path="/library/transfer-directories/:id" element={<TransferEditor />} />
        <Route
          path="/library/agent-scripts"
          element={
            <SimpleLibraryList
              libKey="script"
              endpoint="/agent-scripts"
              note="On-screen talk tracks shown during a call. A richer editor comes later."
            />
          }
        />
        <Route
          path="/library/pause-codes"
          element={
            <SimpleLibraryList
              libKey="pause"
              endpoint="/pause-code-sets"
              note="Reasons agents give when going unavailable."
            />
          }
        />
        <Route
          path="/library/skill-lists"
          element={
            <SimpleLibraryList
              libKey="skill"
              endpoint="/skill-lists"
              note="Agent skills used by outbound skill-based routing."
            />
          }
        />

        <Route path="*" element={<div className="wrap">Not found.</div>} />
      </Routes>
    </Shell>
  );
}
